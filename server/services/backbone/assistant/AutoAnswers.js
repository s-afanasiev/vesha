// Автоответы ассистента (docs/backbone-architecture.md §4: auto: ['stock', 'status',
// 'hours'], §6.4): три вопроса ассистент закрывает сам — правилами по фактам магазина,
// без модели (П30: без модели ассистент работает). Каждое число ответа — со ссылкой на
// позицию (артикул) или заявку (номер), О18; ссылки уходят в журнал (refs).
//
// Реестр (П16): ответчики по порядку; первый, кто узнал вопрос, отвечает. Ответчик,
// который вопрос не узнал, возвращает null — вопрос идёт дальше, в конце — менеджеру.
// «Такой позиции в каталоге нет» — тоже ответ из фактов, но с передачей менеджеру
// (toManager): он может предложить замену.

const money = (n) => `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const amount = (n) => String(n).replace('.', ',');
const STOCK_WORDS = { true: 'в наличии', false: 'под заказ', null: 'наличие уточняйте' };
// Слова вопроса о наличии и цене — не часть наименования позиции.
const STOCK_CUE = /(?<![а-яё])(?:а\s+)?(?:есть\s+ли|есть|имеются|имеется|в\s+наличии|наличие|почем|почём|по\s+чем|сколько\s+стоит|сколько\s+стоят|стоимость|цена|цены|у\s+вас|продаете|продаёте|подскажите|скажите|пожалуйста|нужен|нужна|нужно|нужны)(?![а-яё])/gi;

function when(iso, tz) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso)).replace(', ', ' в ');
}

// «Где заявка 42?», «что с моей заявкой», «статус заказа №5».
class StatusAnswer {
  constructor({ statusPath, shown = 3 }) {
    this.kind = 'status';
    this.statusPath = statusPath; // токен → ссылка на окно статуса
    this.shown = shown;           // сколько своих заявок перечислить без номера
  }

  async answer(text, facts) {
    const t = text.toLowerCase();
    if (!/заявк|заказ(?!ать|ыва|ал)/.test(t)) return null; // «заказать болты» — не о заявке
    const m = t.match(/(?:№|номер|заявк[а-я]*|заказ[а-я]*)\s*№?\s*(\d{1,7})(?!\d|[.,]\d|\s*[×xх*]\s*\d)/); // 42 — номер, 4,2х19 — размер
    if (!m && !/где|статус|что с|как там|готов|мо[яюей]|наш/.test(t)) return null;
    if (m) {
      const number = Number(m[1]);
      const order = await facts.order(number);
      if (!order) {
        // чужая и несуществующая заявка неразличимы: ассистент не подтверждает чужой номер (О20)
        return {
          text: `Заявку №${number} среди ваших не вижу. Я показываю только заявки, отправленные из этого браузера — с витрины или в этом чате. Если отправляли с другого устройства — путь заявки по ссылке из письма-квитанции.`,
          refs: [],
        };
      }
      return { text: `${this.line(order, facts)}. Весь путь заявки — по ссылке: ${this.statusPath(order.token)}`, refs: [{ order: order.number }] };
    }
    const mine = await facts.orders();
    if (!mine.length) {
      return { text: 'Ваших заявок пока не вижу. Пришлите список здесь или формой «Заявка списком» — сообщу номер и ссылку на путь заявки.', refs: [] };
    }
    const shown = mine.slice(0, this.shown);
    return {
      text: [
        shown.length > 1 ? 'Ваши заявки:' : 'Ваша заявка:',
        ...shown.map((o) => `• ${this.line(o, facts)} — ${this.statusPath(o.token)}`),
        ...(mine.length > shown.length ? [`и ещё ${mine.length - shown.length} — спросите по номеру`] : []),
      ].join('\n'),
      refs: shown.map((o) => ({ order: o.number })),
    };
  }

  line(order, facts) {
    return `Заявка №${order.number} — «${order.step}»${order.note ? ` (${order.note})` : ''}${order.at ? `, с ${when(order.at, facts.shop.tz)}` : ''}`;
  }
}

// «Во сколько открываетесь?», «работаете в субботу?», «часы работы».
class HoursAnswer {
  constructor() {
    this.kind = 'hours';
  }

  async answer(text, facts) {
    const t = text.toLowerCase();
    if (!/во сколько|до скольки|со скольки|час(?:ы|ов|ам)? работы|режим работы|график|работаете|открыт|закрыт|выходн|в субботу|в воскресенье/.test(t)) return null;
    const h = facts.hours();
    const zone = h.tz === 'Europe/Moscow' ? 'время московское' : `часовой пояс ${h.tz}`;
    const now = h.open
      ? 'Сейчас открыто — менеджер ответит здесь же.'
      : h.opensAt
        ? `Сейчас закрыто, откроемся ${when(h.opensAt, h.tz)}. Список можно прислать сейчас — заявку примем, ответим в рабочее время.`
        : 'Сейчас закрыто.';
    return { text: `Работаем ${h.text} (${zone}). ${now}`, refs: [] };
  }
}

// «Есть ли М10х50?», «почём саморез 4,2х19?» — позиции каталога с ценой и наличием.
class StockAnswer {
  constructor({ cue = STOCK_CUE, limit = 5 } = {}) {
    this.kind = 'stock';
    this.cue = cue;     // слова вопроса — не часть наименования: «есть ли», «почём», «у вас»
    this.limit = limit; // сколько позиций назвать
  }

  async answer(text, facts) {
    const phrase = text.replace(this.cue, ' ').replace(/[?!]+/g, ' ').trim();
    const found = facts.positions(phrase, { limit: this.limit });
    if (!found) return null;
    if (!found.items.length) {
      return { text: 'В каталоге магазина такой позиции не нашёл. Передал вопрос менеджеру — он ответит здесь же.', refs: [], toManager: 'not_in_catalog' };
    }
    const lines = found.items.map((i) => `• ${i.name} — ${money(i.price)} за ${i.unit}${i.pack > 1 ? `, упаковка ${amount(i.pack)} ${i.unit}` : ''}, ${STOCK_WORDS[i.inStock]} (арт. ${i.sku})`);
    const more = found.total - found.items.length;
    return {
      text: [
        'По каталогу магазина:',
        ...lines,
        ...(more > 0 ? [`и ещё ${more} — уточните тип, покрытие или класс`] : []),
        'Нужное количество пришлите списком «наименование — количество» — оформлю заявку.',
      ].join('\n'),
      refs: found.items.map((i) => ({ sku: i.sku, price: i.price })),
    };
  }
}

class AutoAnswers {
  constructor(answerers) {
    this.answerers = answerers; // по порядку: первый, кто узнал вопрос, отвечает
  }

  get kinds() {
    return this.answerers.map((a) => a.kind);
  }

  // → { kind, text, refs, toManager? } | null — вопрос не из трёх
  async of(text, facts) {
    for (const a of this.answerers) {
      const reply = await a.answer(text, facts);
      if (reply) return { kind: a.kind, ...reply };
    }
    return null;
  }
}

module.exports = { AutoAnswers, StatusAnswer, HoursAnswer, StockAnswer };
