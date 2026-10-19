// Точка сборки компонентных экземпляров костяка (docs/ui-components.md §1).
// Данные и правила — только через дверь BackboneDesk (П28): колонки доски — от
// источника при каждом запросе, перенос — desk.moveOrder, конструктор — desk.configure,
// новая заявка — desk.createOrder. Журнал и каталог — таблицы table@1.
// Шаг 2 — экран черновика: заявки с кнопкой «Разобрать» (desk.parseOrder), строки
// черновиков с правкой менеджера (desk.review) и синонимы магазина.
// Шаг 3 — счёт: выгрузка в xlsx для 1С, «счёт отправлен» (помощь), «приложить счёт
// из 1С» (тень); экран замеров: «до / после» и недели (desk.measures, desk.switchMode).
// Шаг 4 — квитанции клиенту: исходящие письма с кнопкой «Отправить ожидающие»
// (desk.sendReceipts); заявки с сайта — бейдж «с сайта» на доске. В той же таблице —
// письма менеджеру о новой заявке (адресат «магазин»).
// Шаг 6 — магазин без правки кода: экземпляры собираются на магазин (forShop(slug),
// /api/backbone/s/<slug>/c), кабинет — таблица магазинов с «Завести магазин»
// (cabinet, /api/backbone/c); экран каталога: файл выгрузки → сопоставление колонок
// → «Загрузить каталог» (подмена целиком только при успехе), брак — списком.
// Сотрудники магазина: в кабинете — «Добавить сотрудника» у магазина и список
// сотрудников с «Убрать сотрудника» (desk.addStaff, desk.removeStaff).
// Шаг 5 — экран ассистента: разговоры магазина и сообщения; черновик менеджеру по
// кнопке (assistant.proposeReply), отправить, править, отклонить; свой ответ.
// Разбор заявки (18.10.2026): тумблер «Выключен / Сравнение / Помощь» (switch@1,
// desk.switchMode), «До и после» простыми словами (OwnerBrief) и карточка заявки
// «две колонки» (extract@1, desk.orderCard) — текст покупателя слева, как понял
// помощник справа; в «Сравнении» черновик открывается «глазом» только после счёта менеджера.
// 19.10.2026: три колонки — текст покупателя, механический разбор (бесплатно, сразу при
// поступлении) и нейросеть по кнопке с советом «стоит распознать»; «Взять как нейросеть»,
// у строки «выбрать» — 3 лучших варианта с отличием, «ещё N» и «Спросить клиента».
// Монтируется в server/routes/backbone.js (за границей ShopAccess: кабинет — админ,
// магазин — админ или его сотрудник).

const config = require('../../config');
const { Components } = require('../../components');
const { Kanban } = require('../../components/kanban');
const { Table } = require('../../components/table');
const { Switch } = require('../../components/switch');
const { Extract } = require('../../components/extract');
const { backboneDesk, assistant, board, catalogFile, demoRequest, TEMPLATES } = require('./index');
const { TYPE_NAMES } = require('./board/Board');
const { NICHE_NAMES } = require('./board/templates');
const { hoursText } = require('./shops/ShopForm');
const { OwnerBrief, minutes: minutesText, seconds: secondsText } = require('./measures/OwnerBrief');
const { sameLine } = require('./invoice/FinalInvoice');

const actorOf = (user) => (user && (user.email || user.id)) || 'admin';
// Кабинет магазина — там, где его открыла точка входа (Vesha или сборка магазина).
const cabinetOf = (slug) => `${config.backboneCabinetPath}?shop=${encodeURIComponent(slug)}`;

// Событие журнала — строкой для человека; колонки — по текущим названиям,
// удалённая колонка остаётся своим id.
function describe(e, titles) {
  const d = e.data || {};
  const col = (id) => (id ? `«${titles.get(id) || id}»` : '—');
  switch (e.type) {
    case 'board_created': return `доска создана из шаблона «${d.niche}»: ${(d.columns || []).length} колонок`;
    case 'received': return `заявка №${d.number} принята в ${col(d.column)}${d.channel === 'site' ? ' — с сайта' : ''}${d.channel === 'chat' ? ' — из чата ассистента' : ''}${d.refusal === 'scan' ? `, файл «${d.file}» — скан, нужен текст` : ''}`;
    case 'received_again': return `заявка №${d.number}: тот же список пришёл ещё раз${d.channel === 'chat' ? ' из чата' : d.channel === 'site' ? ' с сайта' : ''} — не дубль`;
    case 'assistant_answered': return `ассистент ответил сам: ${ASKS[d.kind] || d.kind}${(d.refs || []).length ? ` — ${d.refs.map((r) => (r.sku ? r.sku : `№${r.order}`)).join(', ')}` : ''}`;
    case 'assistant_deferred': return `вопрос в чате ждёт менеджера${d.reason === 'not_in_catalog' ? ': позиции нет в каталоге' : ''}`;
    case 'list_offered': return `в чате список из ${d.lines} поз. — предложено отправить заявкой`;
    case 'list_sent': return `список из чата → заявка №${d.number}${d.duplicate ? ' (уже была — не дубль)' : ''}`;
    case 'manager_replied': return `менеджер ответил в чате${{ draft: ' черновиком', edited: ' черновиком с правкой', own: '' }[d.how] || ''}`;
    case 'moved': return `заявка №${d.number}: ${col(d.from)} → ${col(d.to)}${e.cause === 'column_removed' ? ' (колонку удалили)' : ''}`;
    case 'column_added': return `колонка ${col(d.column)} добавлена, тип «${TYPE_NAMES[d.columnType] || d.columnType}»`;
    case 'column_renamed': return `колонка «${d.from}» переименована в «${d.to}»`;
    case 'column_retyped': return `колонка ${col(d.column)}: тип «${TYPE_NAMES[d.from] || d.from}» → «${TYPE_NAMES[d.to] || d.to}»`;
    case 'column_moved': return `колонка ${col(d.column)} переставлена: ${d.from + 1} → ${d.to + 1}`;
    case 'column_recolored': return `колонка ${col(d.column)}: цвет ${d.to || 'по умолчанию'}`;
    case 'column_limited': return `колонка ${col(d.column)}: лимит ${d.to || 'снят'}`;
    case 'column_removed': return `колонка «${d.title}» удалена${d.cards ? `, ${d.cards} карт. → ${col(d.moveTo)}` : ''}`;
    case 'parsed': return `заявка №${d.number} разобрана: ${d.lines} строк (правила ${d.rule}, модель ${d.model}${d.raw ? `, не разобрано ${d.raw}` : ''}${d.verify ? `, проверить ${d.verify}` : ''})${(d.failures || []).length ? ` · ${d.failures.join(', ')}` : ''}`;
    case 'draft_ready': return `черновик №${d.number}: ${d.accepted} принято, ${d.ask} выбрать, ${d.missing} нет в каталоге, ${d.questions} вопросов · ${money(d.sum)} ₽`;
    case 'parse_failed': return `заявка №${d.number} не разобрана: ${d.reason}`;
    case 'invoice_exported': return `черновик №${d.number} выгружен в xlsx: в счёт ${d.lines} строк на ${money(d.sum)} ₽${d.left ? `, не вошло ${d.left}` : ''}`;
    case 'invoice_sent': return d.mode === 'shadow'
      ? `тень, заявка №${d.number}: счёт из 1С приложен — совпало ${d.matched} из ${d.final} строк, в черновике ${d.draft}; точность ${ratio(d.accuracy)}`
      : `счёт по заявке №${d.number} отправлен: без правки ${d.right} из ${d.base} строк`;
    case 'shop_opened': return `магазин «${d.name}» заведён: адрес ${d.slug}, ниша «${NICHE_NAMES[d.niche] || d.niche}», ${hoursText(d.hours)}, режим — ${MODES[d.mode] || d.mode}`;
    case 'shop_changed': return `магазин изменён: «${d.name}», ${hoursText(d.hours)}, почта ${d.replyTo || '—'}`;
    case 'staff_added': return `сотрудник ${d.email} добавлен: входит в кабинет магазина`;
    case 'staff_removed': return `сотрудник ${d.email} убран: кабинет магазина ему закрыт`;
    case 'catalog_loaded': return `каталог из «${d.file}» загружен: ${d.loaded} позиций${d.rejected ? `, не загружено строк ${d.rejected}` : ''} — версия ${d.version}`;
    case 'catalog_refused': return `каталог не подменён («${d.file}»): ${d.reason}`;
    case 'mode_changed': return `разбор заявок: ${MODES[d.from]} → ${MODES[d.to]} — ${d.reason}${d.unmeasured ? ' (включено без полной меры)' : ''}`;
    case 'model_parsed': return `заявка №${d.number} распознана нейросетью: ${d.lines.length} строк — ${d.accepted} принято, ${d.ask} выбрать, ${d.missing} нет в каталоге${d.invoice ? `; с вашим счётом совпало ${d.invoice.matched} из ${d.invoice.base}` : ''}`;
    case 'client_asked': return `черновик №${d.number}, строка ${d.line}: вопрос клиенту — ${d.question}`;
    case 'reviewed': return `черновик №${d.number}, строка ${d.line}: ${VERDICTS[d.verdict] || d.verdict}${d.via === 'model' ? ' как у нейросети' : ''}${d.verdict === 'replaced' ? ` ${d.from || '—'} → ${d.to}` : ''}${d.verdict === 'edited' ? ` ${d.from ?? '—'} → ${d.to}` : ''}${d.synonym ? ` · синоним «${d.synonym}»` : ''}`;
    default: return e.type;
  }
}

const VERDICTS = { accepted: 'принята', replaced: 'позиция заменена', edited: 'количество' };
// Повод письма — по адресату: квитанция клиенту или письмо менеджеру магазина.
const KINDS = {
  client: { received: 'получена', waiting: 'ждём ответа', done: 'готово', refused: 'закрыта' },
  shop: { received: 'новая заявка', again: 'тот же список ещё раз' },
};
const MODES = { off: 'выключен', shadow: 'сравнение', help: 'помощь' };
// Положения тумблера разбора: как их видит менеджер.
const MODE_OPTIONS = [
  { value: 'off', name: 'Выключен', note: 'только доска' },
  { value: 'shadow', name: 'Сравнение', note: 'помощник разбирает тихо, черновик — после вашего счёта' },
  { value: 'help', name: 'Помощь', note: 'черновик сразу' },
];
const SWITCHED = {
  off: 'Разбор выключен: заявки только на доске',
  shadow: 'Сравнение: помощник разбирает тихо, черновик откроется после вашего счёта',
  help: 'Помощь: черновик к заявке — сразу',
};
const CHANNELS = { manual: 'вручную', site: 'с сайта', chat: 'из чата ассистента' };
const TONES = { accepted: 'ok', ask: 'ask', missing: 'miss' };
const brief = new OwnerBrief();
const STREAMS = { order: 'заявка', board: 'доска', shop: 'магазин', chat: 'разговор' };
const ASKS = { stock: 'наличие и цена', status: 'статус заявки', hours: 'часы работы' };
const AUTO_NAMES = { list_offered: 'список', list_sent: 'заявка', assistant_deferred: 'менеджеру' };
const DRAFT_STATES = { open: 'черновик', approved: 'черновик · отправлен', edited: 'черновик · отправлен с правкой', rejected: 'черновик · отклонён', superseded: 'черновик · устарел' };
const ratio = (x) => (x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));
const pct = (x) => (x == null ? null : `${Math.round(x * 100)} %`);
const mins = (x) => (x == null ? null : `${String(Math.round(x * 10) / 10).replace('.', ',')} мин`);
const day = (at) => new Date(at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
const accuracyText = (a) => (a.value == null ? null : `${ratio(a.value)} (${a.base} стр.)`);
const assistantText = (x) => (x.share == null ? null : `${pct(x.share)} (${x.auto} из ${x.auto + x.manager})`);
const conversionText = (c) => (c.value == null ? null : `${pct(c.value)} (${c.won} из ${c.won + c.lost})`);
function delta(before, after, kind) {
  if (before == null || after == null) return null;
  if (kind === 'pct') return `${after - before >= 0 ? '+' : ''}${Math.round((after - before) * 100)} п.п.`;
  return `${after - before >= 0 ? '+' : ''}${String(Math.round((after - before) * 10) / 10).replace('.', ',')}`;
}
const STATES = { accepted: '✓ принято', ask: '? выбрать', missing: '✗ нет в каталоге' };
const ORIGINS = { rule: 'правило', model: 'модель', raw: 'не разобрано' };
const money = (n) => (n == null ? '' : Number(n).toFixed(2));
const rub = (n) => `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`; // карточке — по-русски
const amount = (n, unit) => (n == null ? null : `${String(n).replace('.', ',')} ${unit || ''}`.trim());
const itemName = (catalog, sku) => {
  const item = sku && catalog.bySku(sku);
  return item ? `${sku} · ${item.name}` : sku || null;
};
const at = (t) => (t ? new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null);
const LOAD_STATUS = { pending: 'ждёт «Загрузить каталог»', loaded: 'загружен', refused: 'отказ' };

// Последний исход разбора заявки — словами; черновик виден только в «Помощи» и после счёта менеджера.
function statusOf(d, mode) {
  const e = d.outcome;
  if (d.sent) {
    return d.sent.data.mode === 'shadow'
      ? `ваш счёт приложен · совпало ${d.sent.data.matched} из ${d.sent.data.base}`
      : `счёт отправлен · без правки ${d.sent.data.right} из ${d.sent.data.base}`;
  }
  if (e && e.type === 'parse_failed') return `отказ: ${e.data.reason}${d.lines ? ' (черновик прежний)' : ''}`;
  if (mode === 'off') return 'разбор выключен';
  if (d.lines && mode === 'shadow') return 'сравнение: черновик откроется после вашего счёта';
  if (d.lines) return d.reviewed ? `черновик, правок ${d.reviewed}` : 'черновик';
  return 'не разобрана';
}

// Пояснение у тумблера на экране заявок (слова пользователя 19.10.2026): эксперимент или сразу помощь.
const EXPERIMENT = 'Предлагаем эксперимент: в «Сравнении» вы подбираете товар вручную, как обычно, а потом смотрите разницу и пользу от автоматики. Либо можете сразу включить «Помощь».';
const EXPLAIN = {
  off: EXPERIMENT,
  shadow: EXPERIMENT,
  help: 'Помощь: механика готовит черновик сразу при поступлении заявки и бесплатно; если заявка сложная, в её карточке — «Распознать нейросетью».',
};

// Одна строка под тумблером: с какого дня положение и сколько набрано для «Помощи».
function modeHint({ shop, days, shadowDays, current, minLines }) {
  if (shop.mode === 'off') return `с ${day(shop.mode_since)}: заявки только на доске, помощник их не читает`;
  if (shop.mode === 'help') return `с ${day(shop.mode_since)}: черновик к заявке — сразу, ваши правки рождают синонимы товаров`;
  const base = current.shadowAccuracy.base;
  return `с ${day(shop.mode_since)}, день ${days}${shadowDays ? ` из ${shadowDays}` : ''}; сравнено строк ${base}${base < minLines ? ` из нужных ${minLines}` : ' — для меры хватает'}`;
}

// Тумблер разбора: на экране заявок — коротко, на замерах — с «До и после» простыми словами.
function modeSwitch(slug, { withBrief }) {
  return Switch({
    title: withBrief ? 'До и после — простыми словами' : 'Разбор заявок помощником',
    state: async () => {
      const m = await backboneDesk.measures(slug);
      const said = withBrief ? brief.of(m) : { lines: [EXPLAIN[m.shop.mode]], cta: null };
      return { value: m.shop.mode, options: MODE_OPTIONS, hint: modeHint(m), lines: said.lines, ...(said.cta ? { cta: said.cta } : {}) };
    },
    set: async ({ value, confirm, user }) => {
      try {
        const r = await backboneDesk.switchMode(slug, value, actorOf(user), { confirm });
        return { message: `${SWITCHED[r.to]}${r.unmeasured ? ' — без полной меры, это отмечено в журнале' : ''}` };
      } catch (err) {
        if (err.warn) return { confirm: err.message }; // «Помощь» без меры — вопрос, а не запрет
        throw err;
      }
    },
  });
}

// Строка механического черновика → пункт колонки карточки: позиция, «просит → в счёт»,
// цвет, вопрос клиенту, варианты строки «выбрать» (3 лучших с отличием и «ещё N»),
// сверка со счётом менеджера.
function lineItem(l, catalog, { pair = null, alternatives = null } = {}) {
  const item = l.sku ? catalog.bySku(l.sku) : null;
  const sum = l.invoice_qty != null && l.price != null ? Math.round(l.invoice_qty * l.price * 100) / 100 : null;
  const want = amount(l.qty, l.unit);
  const invoice = amount(l.invoice_qty, item && item.unit);
  const option = (c) => ({ value: c.sku, text: `${c.sku} · ${c.name}`, note: c.differs || null });
  return {
    id: l.id,
    text: item ? item.name : `нет в каталоге: ${l.name}`,
    sub: [l.sku, want && `просит ${want}`, invoice && `в счёт ${invoice}`, sum != null && rub(sum)].filter(Boolean).join(' · ') || null,
    tone: TONES[l.state],
    tag: l.origin === 'model' ? 'понял по модели' : l.origin === 'raw' ? 'не разобрано' : null,
    note: [l.verify && `проверить: ${l.verify}`, l.question && `вопрос клиенту: ${l.question}`, l.review && `менеджер: ${VERDICTS[l.review]}`]
      .filter(Boolean).join(' · ') || null,
    anchors: l.anchors,
    choices: alternatives && alternatives.top.length ? alternatives.top.map(option) : null,
    more: alternatives && alternatives.more.length ? alternatives.more.map(option) : null,
    pair: pair ? pairOf(pair, catalog) : null,
  };
}

// Строка разбора нейросетью → пункт третьей колонки; сверка — с механикой на том же месте
// текста («Помощь») или со счётом менеджера («Сравнение» после счёта).
function modelItem(m, catalog, { base = null, invoicePair = null, takeable = false } = {}) {
  const item = m.sku ? catalog.bySku(m.sku) : null;
  const sum = m.invoiceQty != null && m.price != null ? Math.round(m.invoiceQty * m.price * 100) / 100 : null;
  const want = amount(m.qty, m.unit);
  const invoice = amount(m.invoiceQty, item && item.unit);
  let pair = invoicePair ? pairOf(invoicePair, catalog) : null;
  if (!invoicePair && base !== undefined) {
    if (!base) pair = { tone: 'diff', text: 'у механики этой строки нет' };
    else if (sameLine(base, m)) pair = { tone: 'same', text: 'так же, как механика' };
    else {
      const was = base.sku ? catalog.bySku(base.sku) : null;
      pair = { tone: 'diff', text: `механика: ${was ? was.name : base.origin === 'raw' ? 'не разобрала' : 'нет в каталоге'}${base.invoice_qty != null ? `, ${amount(base.invoice_qty, was && was.unit)}` : ''}` };
    }
  }
  return {
    id: `m:${m.position}`,
    text: item ? item.name : `нет в каталоге: ${m.name}`,
    sub: [m.sku, want && `просит ${want}`, invoice && `в счёт ${invoice}`, sum != null && rub(sum)].filter(Boolean).join(' · ') || null,
    tone: TONES[m.state],
    tag: m.origin === 'rule' ? 'нейросеть пропустила — как механика' : m.origin === 'raw' ? 'не разобрано' : null,
    note: [m.verify && `проверить: ${m.verify}`, m.question && `вопрос клиенту: ${m.question}`].filter(Boolean).join(' · ') || null,
    anchors: m.anchors,
    pair,
    actions: takeable ? ['take'] : [],
  };
}

function pairOf(pair, catalog) {
  if (pair.tone === 'same') return { tone: 'same', text: 'совпало с вашим счётом' };
  if (pair.tone === 'qty') {
    const item = catalog.bySku(pair.final.sku);
    return { tone: 'diff', text: `у вас другое количество: ${amount(pair.final.qty, item && item.unit)}` };
  }
  return { tone: 'diff', text: 'в вашем счёте этой строки нет' };
}

// строки только в счёте менеджера — под пунктами колонки
function onlyInInvoice(extra, catalog) {
  return extra.map((f) => {
    const item = catalog.bySku(f.sku);
    return { tone: 'diff', text: `только в вашем счёте: ${item ? item.name : f.sku} — ${amount(f.qty, item && item.unit)}` };
  });
}

// Вид карточки заявки по положению тумблера: источник и два прочтения — механика
// (бесплатно, сразу) и нейросеть (по кнопке); что видно, почему закрыто, какие действия.
async function orderView(slug, orderId) {
  const card = await backboneDesk.orderCard(slug, orderId);
  const { shop, order, sent } = card;
  const catalog = await backboneDesk.catalogOf(slug);
  const count = (lines, state) => lines.filter((l) => l.state === state).length;
  const helper = card.helperMs != null ? `черновик ${secondsText(card.helperMs)}` : null;
  const view = {
    title: `Заявка №${order.number} · ${order.client}`,
    facts: [
      { label: 'Контакт', value: order.contact || null },
      { label: 'Пришла', value: `${at(order.created_at)}, ${CHANNELS[order.channel] || order.channel}` },
      { label: 'Разбор', value: MODE_OPTIONS.find((o) => o.value === shop.mode).name },
    ],
    source: {
      title: 'Как прислал покупатель',
      lines: card.text,
      note: 'текст целиком; щёлкните строку разбора — здесь подсветится, откуда она',
    },
    results: [
      { id: 'rules', title: 'Механический разбор — бесплатно, без нейросети', state: 'open', items: [], actions: [] },
      { id: 'model', title: 'Нейросеть — по кнопке', state: 'closed', items: [], actions: [] },
    ],
  };
  const [rules, model] = view.results;
  const reading = card.reading;
  const help = shop.mode === 'help' && !sent;

  // ---- механика ----
  if (sent && sent.mode === 'shadow') {
    // «Сравнение» после счёта менеджера: черновик рядом с ним — «глазом», по желанию
    const pairs = card.pairs ? card.pairs.pairs : [];
    rules.state = 'peek';
    rules.reason = `Ваш счёт приложен: механика совпала в ${sent.matched} из ${sent.base} строк, точность ${pct(sent.accuracy) || '—'}.`;
    rules.peek = 'Показать черновик механики рядом с вашим счётом';
    rules.facts = [
      { label: 'Вы', value: card.managerMinutes != null ? `${minutesText(card.managerMinutes)} рабочего времени от заявки до счёта` : null },
      { label: 'Помощник', value: helper },
      { label: 'Совпало строк', value: `${sent.matched} из ${sent.base}` },
    ];
    rules.items = card.lines.map((l, i) => lineItem(l, catalog, { pair: pairs[i] }));
    rules.extra = card.pairs ? onlyInInvoice(card.pairs.extra, catalog) : [];
  } else if (!sent && shop.mode === 'off') {
    rules.state = 'closed';
    rules.reason = 'Разбор выключен — заявка только на доске. Включите «Сравнение» или «Помощь» на экране «Черновики счетов».';
  } else if (!sent && shop.mode === 'shadow') {
    rules.state = 'closed';
    rules.reason = `${card.drafted ? 'Помощник уже разобрал заявку тихо.' : 'Помощник разберёт заявку тихо.'} Черновик откроется, когда вы приложите свой счёт из 1С, — иначе замер «до» испортится. Сделайте счёт в 1С как обычно и нажмите «Мой счёт готов».`;
    rules.actions = card.drafted ? ['attach'] : ['parse', 'attach'];
  } else if (!card.drafted) {
    rules.state = 'closed';
    rules.reason = card.failure ? `Механика не разобрала заявку: ${card.failure}` : 'Заявка ещё не разобрана.';
    rules.actions = help ? ['parse'] : [];
  } else {
    // «Помощь»: черновик сразу; после «Счёт отправлен» — только чтение и выгрузка
    rules.items = card.lines.map((l) => lineItem(l, catalog, { alternatives: help ? card.choices.get(l.id) : null }));
    rules.facts = [
      { label: 'Принято', value: `${count(card.lines, 'accepted')} из ${card.lines.length}` },
      { label: 'Выбрать', value: count(card.lines, 'ask') || null },
      { label: 'Нет в каталоге', value: count(card.lines, 'missing') || null },
      { label: 'Вопросов клиенту', value: card.lines.filter((l) => l.question).length || null },
      { label: 'Сумма принятого', value: rub(card.lines.reduce((t, l) => t + (l.state === 'accepted' && l.invoice_qty != null && l.price != null ? l.invoice_qty * l.price : 0), 0)) },
      { label: 'Помощник', value: helper },
      { label: 'Счёт', value: sent ? `отправлен: без правки ${sent.right} из ${sent.base}${card.managerMinutes != null ? `, ${minutesText(card.managerMinutes)} от заявки` : ''}` : null },
    ];
    rules.actions = sent ? ['export'] : ['accept-green', 'pick', 'ask', 'replace', 'qty', 'export', 'sent'];
  }

  // ---- нейросеть ----
  const canRead = help || Boolean(sent && sent.mode === 'shadow'); // в «Сравнении» — только после счёта
  if (!reading) {
    model.reason = !sent && shop.mode === 'off' ? 'Разбор выключен.'
      : !sent && shop.mode === 'shadow' ? 'Нейросеть — после вашего счёта: иначе замер «до» испортится.'
        : sent && sent.mode === 'shadow' ? 'Сравните: распознайте нейросетью — увидите, насколько она ближе к вашему счёту, чем бесплатная механика. Одна заявка — один запрос к модели, контакты покупателя в модель не уходят.'
          : canRead ? (card.advice && card.advice.advise ? 'Одна заявка — один запрос к модели; контакты покупателя в модель не уходят.'
            : 'Механика справилась сама — нейросеть можно не звать. Если что-то выглядит не так — распознайте нейросетью: одна заявка — один запрос к модели.')
            : 'Счёт уже отправлен.';
    if (canRead) {
      model.actions = ['read-model'];
      if (card.advice && card.advice.advise) model.hint = card.advice.reason;
      else if (card.drafted === false || (card.failure && !card.lines.length)) model.hint = 'Механика не нашла товарных строк — попробуйте нейросеть.';
    }
    return view;
  }
  const differs = card.readingPairs.filter((p) => p.base && !sameLine(p.base, p.line)).length;
  const modelFacts = [
    { label: 'Принято', value: `${count(reading.lines, 'accepted')} из ${reading.lines.length}` },
    { label: 'Выбрать', value: count(reading.lines, 'ask') || null },
    { label: 'Нет в каталоге', value: count(reading.lines, 'missing') || null },
    { label: 'Нейросеть', value: `${secondsText(reading.ms)}` },
  ];
  if (sent && sent.mode === 'shadow') {
    const inv = reading.invoice || {};
    model.state = 'peek';
    model.reason = `Нейросеть против вашего счёта: совпало ${inv.matched ?? '—'} из ${inv.base ?? '—'} строк (механика — ${sent.matched} из ${sent.base}).`;
    model.peek = 'Показать разбор нейросети рядом с вашим счётом';
    model.facts = modelFacts;
    model.items = reading.lines.map((m, i) => modelItem(m, catalog, { invoicePair: card.readingInvoice ? card.readingInvoice.pairs[i] : null }));
    model.extra = card.readingInvoice ? onlyInInvoice(card.readingInvoice.extra, catalog) : [];
    return view;
  }
  model.state = 'open';
  model.facts = [...modelFacts, { label: 'Иначе, чем механика', value: differs || 'нет' }];
  model.items = card.readingPairs.map(({ line, base }) => modelItem(line, catalog, {
    base, takeable: help && Boolean(line.sku && base && !sameLine(base, line)),
  }));
  model.actions = help ? [...(differs ? ['take-all', 'take'] : []), 'read-model'] : [];
  return view;
}

const download = (slug, orderId) => `/api/backbone/s/${encodeURIComponent(slug)}/files/invoice/${orderId}.xlsx`;

// Итог «Мой счёт готов»: сколько совпало, и что черновик теперь можно открыть «глазом».
function attachedText(r, { inCard = false } = {}) {
  return `№${r.number}: ваш счёт приложен — совпало ${r.matched} из ${r.base} строк, точность ${pct(r.accuracy) || '—'}${r.unknown ? `; не узнано строк счёта: ${r.unknown}` : ''}.`
    + (inCard ? ' Нажмите «глаз» — черновик помощника встанет рядом с вашим счётом.' : ' Черновик помощника — в карточке заявки («Открыть»), кнопка «глаз».');
}

// Экземпляры одного магазина: всё — по его адресу (slug).
function shopComponents(slug) {
  return Components({
    'board': Kanban({
      columns: () => backboneDesk.columns(slug),
      columnKey: 'column',
      card: { title: 'title', snippet: 'snippet', time: 'created_at' },
      cards: async () => {
        const shop = await backboneDesk.shop(slug);
        const drafts = new Map((await backboneDesk.drafts(slug)).map((d) => [d.order.id, d]));
        return (await backboneDesk.orders(slug)).map((o) => {
          const d = drafts.get(o.id);
          const seen = d && d.lines && (shop.mode === 'help' || d.sent); // черновик скрыт до счёта менеджера
          const badges = o.contact && o.text ? [{ text: o.contact }] : [];
          if (o.channel === 'site') badges.unshift({ text: 'с сайта', kind: 'waiting' });
          if (o.channel === 'chat') badges.unshift({ text: 'из чата', kind: 'waiting' });
          if (seen) badges.push({ text: `черновик ${d.accepted}/${d.lines}`, kind: 'draft' });
          if (seen && d.questions) badges.push({ text: `вопросов ${d.questions}`, kind: 'waiting' });
          if (d && d.sent) badges.push({ text: 'счёт отправлен' });
          return { id: o.id, column: o.column_id, title: `№${o.number} · ${o.client}`, snippet: o.text || o.contact, created_at: o.created_at, badges };
        });
      },
      move: ({ cardId, to, user }) => backboneDesk.moveOrder(slug, cardId, to, { actor: actorOf(user), cause: 'drag' }),
      create: {
        label: 'Новая заявка',
        fields: [
          { key: 'client', label: 'Клиент', required: true },
          { key: 'contact', label: 'Контакт' },
          { key: 'text', label: 'Что нужно', multiline: true },
        ],
        run: ({ fields, user }) => backboneDesk.createOrder(slug, fields, actorOf(user)),
      },
      configure: {
        types: board.typeNames(),
        run: ({ op, user }) => backboneDesk.configure(slug, op, actorOf(user)),
      },
      // подробности карточки: контакт, канал и ссылка на карточку «две колонки»
      details: {
        read: async ({ cardId }) => {
          const { order, events } = await backboneDesk.history(slug, cardId);
          const columns = await backboneDesk.columns(slug);
          const titles = new Map(columns.map((c) => [c.id, c.title]));
          return {
            card: { title: `№${order.number} · ${order.client}`, subtitle: CHANNELS[order.channel] || order.channel },
            facts: [
              { label: 'Разбор заявки', value: 'открыть: как прислал покупатель и как понял помощник', href: `${cabinetOf(slug)}&page=order&order=${order.id}` },
              { label: 'Контакт', value: order.contact || '—' },
            ],
            journal: [...events].reverse().map((e) => ({ at: new Date(e.at).toISOString(), what: describe(e, titles), actor: e.actor, why: e.cause })),
          };
        },
      },
    }),

    'receipts': Table({
      rows: async () => (await backboneDesk.receiptsOf(slug)).map((r) => ({
        id: r.id,
        number: r.number,
        who: r.audience === 'shop' ? 'менеджер' : 'клиент',
        kind: (KINDS[r.audience] || KINDS.client)[r.kind] || r.kind,
        to: r.address || '—',
        subject: r.subject,
        status: { pending: 'ждёт', sent: 'отправлена', failed: `сбой ×${r.attempts}`, skipped: 'пропущена' }[r.status] || r.status,
        why: r.last_error || '',
        at: new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
      })),
      idKey: 'id',
      columns: [
        { key: 'number', name: 'Заявка', type: 'num', sortable: true },
        { key: 'who', name: 'Кому', sortable: true },
        { key: 'kind', name: 'Повод', sortable: true },
        { key: 'to', name: 'Адрес' },
        { key: 'subject', name: 'Тема' },
        { key: 'status', name: 'Статус', sortable: true },
        { key: 'why', name: 'Почему не ушла' },
        { key: 'at', name: 'Когда' },
      ],
      search: ['subject', 'to', 'status', 'who'],
      actions: [
        { id: 'send', name: 'Отправить ожидающие', run: async () => {
          const r = await backboneDesk.sendReceipts(slug);
          return { message: `новых писем ${r.made}, к отправке ${r.pending}, ушло ${r.sent}` };
        } },
      ],
    }),

    'journal': Table({
      rows: async () => {
        const [events, columns] = await Promise.all([backboneDesk.journalOf(slug, { limit: 300 }), backboneDesk.columns(slug)]);
        const titles = new Map(columns.map((c) => [c.id, c.title]));
        // удалённая колонка — по названию из события удаления
        for (const e of events) {
          if (e.type === 'column_removed' && !titles.has(e.data.column)) titles.set(e.data.column, e.data.title);
        }
        return events.map((e) => ({
          id: String(e.id),
          at: new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
          stream: STREAMS[e.stream] || e.stream,
          what: describe(e, titles),
          actor: e.actor,
          cause: e.cause,
        }));
      },
      idKey: 'id',
      columns: [
        { key: 'id', name: '№', type: 'num', sortable: true },
        { key: 'at', name: 'Когда' },
        { key: 'stream', name: 'Поток', sortable: true },
        { key: 'what', name: 'Событие' },
        { key: 'actor', name: 'Кто' },
        { key: 'cause', name: 'Почему' },
      ],
      search: ['what', 'actor', 'stream'],
    }),

    // ---------- шаг 2: экран черновика ----------

    'drafts': Table({
      rows: async () => {
        const shop = await backboneDesk.shop(slug);
        const hidden = shop.mode !== 'help';
        return (await backboneDesk.drafts(slug)).map((d) => {
          const has = d.lines > 0 && (!hidden || d.sent);
          return {
            id: d.order.id,
            number: d.order.number,
            client: d.order.client,
            card: `${cabinetOf(slug)}&page=order&order=${d.order.id}`,
            open: 'Открыть',
            status: statusOf(d, shop.mode),
            lines: has ? d.lines : null,
            accepted: has ? d.accepted : null,
            ask: has ? d.ask : null,
            missing: has ? d.missing : null,
            questions: has ? d.questions : null,
            reviewed: has ? d.reviewed : null,
            sum: has ? d.sum : null,
          };
        });
      },
      idKey: 'id',
      columns: [
        { key: 'number', name: '№', type: 'num', sortable: true },
        { key: 'client', name: 'Клиент', sortable: true },
        { key: 'card', name: 'Карточка', render: 'link', label: 'open' },
        { key: 'status', name: 'Разбор' },
        { key: 'lines', name: 'Строк', type: 'num', sortable: true },
        { key: 'accepted', name: 'Принято', type: 'num' },
        { key: 'ask', name: 'Выбрать', type: 'num' },
        { key: 'missing', name: 'Нет в каталоге', type: 'num' },
        { key: 'questions', name: 'Вопросов', type: 'num' },
        { key: 'reviewed', name: 'Правок', type: 'num' },
        { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
      ],
      search: ['client', 'status'],
      actions: [
        {
          id: 'parse', name: 'Разобрать', bulk: true, max: 5,
          run: async ({ ids, user }) => {
            const done = [];
            for (const id of ids) {
              try {
                const r = await backboneDesk.parseOrder(slug, id, { actor: actorOf(user), user });
                const notes = (r.failures || []).map((f) => f.detail).join('; ');
                done.push(r.ok ? `№${r.number}: ${r.summary}${notes ? ` (${notes})` : ''}` : `№${r.number}: ${r.message}`);
              } catch (err) {
                done.push(String(err.message || err));
              }
            }
            return { message: done.join(' · ') };
          },
        },
        {
          id: 'export', name: 'Выгрузить в xlsx для 1С', bulk: true, max: 1,
          run: async ({ ids, user }) => {
            const r = await backboneDesk.exportInvoice(slug, ids[0], actorOf(user));
            return {
              ...r,
              message: `№${r.number}: в счёт ${r.included} строк на ${money(r.sum)} ₽${r.left ? `, не вошло ${r.left} — лист «Вопросы и пропуски»` : ''}`,
              download: `/api/backbone/s/${encodeURIComponent(slug)}/files/invoice/${r.orderId}.xlsx`,
            };
          },
        },
        {
          id: 'sent', name: 'Счёт отправлен', bulk: true, max: 1,
          run: async ({ ids, user }) => {
            const r = await backboneDesk.invoiceSent(slug, ids[0], actorOf(user));
            return { ...r, message: `№${r.number}: счёт отправлен, без правки ${r.right} из ${r.base} строк` };
          },
        },
        {
          id: 'attach', name: 'Мой счёт готов', bulk: true, max: 1,
          fields: [{ key: 'invoice', label: 'Строки вашего счёта из 1С', required: true, multiline: true, placeholder: 'скопируйте табличную часть счёта в 1С и вставьте сюда' }],
          run: async ({ ids, body, user }) => {
            const r = await backboneDesk.attachInvoice(slug, ids[0], body.invoice, { actor: actorOf(user), user });
            return { ...r, message: attachedText(r) };
          },
        },
        {
          id: 'demo', name: 'Демо-заявка на 20 строк',
          run: async ({ user }) => {
            const order = await backboneDesk.createOrder(slug, {
              client: 'ООО «СтройМонтаж» (демо)', contact: 'snab@example.ru', text: demoRequest(),
            }, actorOf(user));
            return { message: `Заявка №${order.number} создана и разобрана механикой — откройте её карточку («Открыть»)` };
          },
        },
      ],
    }),

    'lines': Table({
      rows: async () => {
        const catalog = await backboneDesk.catalogOf(slug);
        return (await backboneDesk.managerLines(slug)).map((l) => {
          const item = l.sku ? catalog.bySku(l.sku) : null;
          return {
            id: l.id,
            order: l.number,
            orderTag: `№${l.number}`,
            pos: l.position,
            source: l.source,
            item: itemName(catalog, l.sku),
            confidence: l.confidence,
            stateId: l.state,
            state: `${STATES[l.state]}${l.review ? ' · менеджер' : ''}`,
            candidates: l.state === 'accepted' ? null
              : l.candidates.map((c, i) => `${i + 1}) ${c.sku} ${String(c.score).replace('.', ',')}`).join(' · ') || null,
            want: amount(l.qty, l.unit),
            invoice: amount(l.invoice_qty, item && item.unit),
            price: l.price,
            sum: l.invoice_qty != null && l.price != null ? Math.round(l.invoice_qty * l.price * 100) / 100 : null,
            question: l.question,
            origin: `${ORIGINS[l.origin]}${l.verify ? ` · ${l.verify}` : ''}`,
          };
        });
      },
      idKey: 'id',
      columns: [
        { key: 'order', name: 'Заявка', type: 'num', sortable: true },
        { key: 'pos', name: 'Стр.', type: 'num', sortable: true },
        { key: 'source', name: 'Как написал клиент' },
        { key: 'item', name: 'Позиция' },
        { key: 'confidence', name: 'Уверенность', type: 'num', sortable: true },
        { key: 'state', name: 'Состояние', sortable: true },
        { key: 'candidates', name: 'Кандидаты' },
        { key: 'want', name: 'Просит' },
        { key: 'invoice', name: 'В счёт' },
        { key: 'price', name: 'Цена, ₽', type: 'num' },
        { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
        { key: 'question', name: 'Вопрос клиенту' },
        { key: 'origin', name: 'Кто разобрал' },
      ],
      search: ['orderTag', 'source', 'item', 'state', 'question'],
      select: {
        presets: [
          { id: 'ask', name: 'Все «выбрать»', where: (r) => r.stateId === 'ask' },
          { id: 'missing', name: 'Все «нет в каталоге»', where: (r) => r.stateId === 'missing' },
          { id: 'questions', name: 'С вопросом', where: (r) => !!r.question },
        ],
      },
      actions: [
        {
          id: 'accept', name: 'Принять', bulk: true, max: 200,
          run: async ({ ids, user }) => {
            const r = await backboneDesk.review(slug, ids, { verdict: 'accepted' }, actorOf(user));
            return { ...r, message: `Принято строк: ${r.lines}${r.synonyms ? `, новых синонимов: ${r.synonyms}` : ''}` };
          },
        },
        {
          id: 'replace', name: 'Заменить позицию', bulk: true, max: 1,
          fields: [{ key: 'sku', label: 'Артикул или № кандидата', required: true, placeholder: 'SW-3.5x35-YZ или 2' }],
          run: async ({ ids, body, user }) => {
            const r = await backboneDesk.review(slug, ids, { verdict: 'replaced', sku: body.sku }, actorOf(user));
            return { ...r, message: 'Позиция заменена — синоним записан: в следующей заявке эта фраза найдётся сама' };
          },
        },
        {
          id: 'qty', name: 'Количество', bulk: true, max: 1,
          fields: [{ key: 'qty', label: 'Сколько в счёт (в единице позиции)', required: true, placeholder: '50' }],
          run: async ({ ids, body, user }) => {
            const r = await backboneDesk.review(slug, ids, { verdict: 'edited', qty: body.qty }, actorOf(user));
            return { ...r, message: 'Количество исправлено, упаковка и остаток пересчитаны' };
          },
        },
      ],
    }),

    // ---------- шаг 3: замеры из журнала ----------

    'summary': Table({
      rows: async () => {
        const { shop, report, decision, days, shadowDays } = await backboneDesk.measures(slug);
        const b = report.before;
        const a = report.after;
        const silent = report.silence;
        const row = (id, metric, before, after, d = null, note = null) => ({ id, metric, before, after, delta: d, note });
        return [
          row('mode', 'Разбор заявок',
            shop.mode === 'shadow' ? `сравнение с ${day(shop.mode_since)}, ${shadowDays ? `день ${days} из ${shadowDays}` : 'без срока'}` : null,
            shop.mode === 'help' ? `помощь с ${day(shop.mode_since)}` : null, null,
            shop.mode === 'off' ? `выключен с ${day(shop.mode_since)}`
              : decision ? `${decision.ok ? 'мера для помощи набрана' : 'мера для помощи не набрана'}: ${decision.reason}` : 'вернуться в «Сравнение» можно всегда — это новая база «до»'),
          row('orders', 'Заявок', String(b.orders), String(a.orders)),
          row('reply1h', 'Ответ в течение часа рабочего времени', pct(b.replyWithinHour), pct(a.replyWithinHour), delta(b.replyWithinHour, a.replyWithinHour, 'pct'),
            'ответ — счёт или перенос в «ждём клиента», «готово», «отказ»'),
          row('reply', 'До первого ответа, медиана', mins(b.replyMinutes), mins(a.replyMinutes), delta(b.replyMinutes, a.replyMinutes), 'минуты рабочего времени магазина'),
          row('invoice', 'До счёта, медиана', mins(b.invoiceMinutes), mins(a.invoiceMinutes), delta(b.invoiceMinutes, a.invoiceMinutes), 'главный эффект инструмента'),
          row('manager', 'Минуты менеджера на заявку, медиана', null, mins(a.managerMinutes), null, 'в сравнении менеджер работает в 1С — видно только время до счёта'),
          row('helper', 'Помощник: разбор заявки, медиана', b.helperMs == null ? null : secondsText(b.helperMs), a.helperMs == null ? null : secondsText(a.helperMs), null, 'сколько шёл разбор — правила и модель'),
          row('accuracy', 'Точность черновика', accuracyText(b.shadowAccuracy), accuracyText(a.untouched), null,
            'сравнение: черновик против счёта менеджера; помощь: строки без правки; мера для помощи — 0,8'),
          row('missing', 'Нет в каталоге, доля строк', pct(b.missingShare), pct(a.missingShare), delta(b.missingShare, a.missingShare, 'pct'), 'полнота каталога и синонимов'),
          row('questions', 'Вопросы клиенту, доля строк', pct(b.questionShare), pct(a.questionShare), delta(b.questionShare, a.questionShare, 'pct')),
          row('conversion', 'Конверсия: выдано / (выдано + отказ)', conversionText(b.conversion), conversionText(a.conversion),
            delta(b.conversion.value, a.conversion.value, 'pct')),
          row('b2b', 'B2B-заявки: от 5 строк или от организации', pct(b.b2b), pct(a.b2b), null, 'масштаб q для карточки 08'),
          row('silence', 'Тишина сейчас', null, null, null,
            [silent.inbox.length ? `входящие дольше часа: №${silent.inbox.join(', №')}` : '', silent.waitingClient.length ? `ждём клиента дольше 2 дн.: №${silent.waitingClient.join(', №')}` : '']
              .filter(Boolean).join('; ') || 'нет'),
          row('assistant', 'Ассистент ответил сам, доля вопросов в чате', assistantText(report.assistant.shadow), assistantText(report.assistant.help),
            delta(report.assistant.shadow.share, report.assistant.help.share, 'pct'), 'сам — наличие и цена, статус своей заявки, часы; остальное ждало менеджера'),
        ];
      },
      idKey: 'id',
      columns: [
        { key: 'metric', name: 'Метрика' },
        { key: 'before', name: 'Сравнение (до)' },
        { key: 'after', name: 'Помощь (после)' },
        { key: 'delta', name: 'Разница' },
        { key: 'note', name: 'Пояснение' },
      ],
    }),

    // ---------- разбор заявки: тумблер, «До и после», карточка «две колонки» ----------

    'mode': modeSwitch(slug, { withBrief: false }),
    'mode-brief': modeSwitch(slug, { withBrief: true }),

    'order-card': Extract({
      title: 'Заявка: как прислал покупатель и как понял помощник',
      legend: { ok: 'принято', ask: 'выбрать', miss: 'нет в каталоге' },
      view: ({ key }) => orderView(slug, key),
      actions: [
        {
          id: 'parse', name: 'Разобрать',
          run: async ({ key, user }) => {
            const r = await backboneDesk.parseOrder(slug, key, { actor: actorOf(user), user });
            if (!r.ok) return { message: `Не разобрано: ${r.message}` };
            const shop = await backboneDesk.shop(slug);
            return { message: shop.mode === 'help' ? r.summary : 'Помощник разобрал заявку тихо — черновик откроется после вашего счёта' };
          },
        },
        {
          id: 'attach', name: 'Мой счёт готов', primary: true,
          fields: [{ key: 'invoice', label: 'Строки вашего счёта из 1С', required: true, multiline: true, placeholder: 'скопируйте табличную часть счёта в 1С и вставьте сюда' }],
          run: async ({ key, body, user }) => ({
            message: attachedText(await backboneDesk.attachInvoice(slug, key, body.invoice, { actor: actorOf(user), user }), { inCard: true }),
          }),
        },
        {
          id: 'accept-green', name: 'Принять всё зелёное', primary: true,
          run: async ({ key, user }) => {
            const r = await backboneDesk.acceptConfident(slug, key, actorOf(user));
            return { message: `Принято строк: ${r.lines}` };
          },
        },
        {
          id: 'export', name: 'Выгрузить в 1С (xlsx)',
          run: async ({ key, user }) => {
            const r = await backboneDesk.exportInvoice(slug, key, actorOf(user));
            return { message: `В счёт ${r.included} строк на ${rub(r.sum)}${r.left ? `, не вошло ${r.left} — лист «Вопросы и пропуски»` : ''}`, download: download(slug, r.orderId) };
          },
        },
        {
          id: 'sent', name: 'Счёт отправлен',
          run: async ({ key, user }) => {
            const r = await backboneDesk.invoiceSent(slug, key, actorOf(user));
            return { message: `Счёт отправлен: без правки ${r.right} из ${r.base} строк` };
          },
        },
        {
          id: 'read-model', name: 'Распознать нейросетью', primary: true,
          run: async ({ key, user }) => {
            const r = await backboneDesk.readByModel(slug, key, { actor: actorOf(user), user });
            return { message: `Нейросеть: ${r.lines.length} строк — ${r.accepted} принято, ${r.ask} выбрать, ${r.missing} нет в каталоге${r.invoice ? `; с вашим счётом совпало ${r.invoice.matched} из ${r.invoice.base}` : ''}` };
          },
        },
        {
          id: 'take-all', name: 'Взять всё у нейросети', primary: true,
          run: async ({ key, user }) => {
            const r = await backboneDesk.takeAllModel(slug, key, actorOf(user));
            return { message: `Взято у нейросети строк: ${r.lines} — это ваши правки, синонимы записаны` };
          },
        },
        {
          id: 'take', name: 'Взять как нейросеть', scope: 'item',
          run: async ({ key, item, user }) => {
            await backboneDesk.takeModelLine(slug, key, String(item).replace(/^m:/, ''), actorOf(user));
            return { message: 'Строка взята у нейросети — синоним записан: механика найдёт её сама в следующий раз' };
          },
        },
        {
          id: 'ask', name: 'Спросить клиента', scope: 'item', tones: ['ask', 'miss'],
          run: async ({ key, item, user }) => {
            const r = await backboneDesk.askClient(slug, key, item, actorOf(user));
            return { message: `В вопросы клиенту: ${r.question}` };
          },
        },
        {
          id: 'pick', name: 'Выбрать', scope: 'item', tones: ['ask', 'miss'], choose: true,
          run: async ({ key, item, value, user }) => {
            const r = await backboneDesk.pickCandidate(slug, key, item, value, actorOf(user));
            return { message: `Выбрано ${value}${r.synonyms ? ' — синоним записан: в следующей заявке эта фраза найдётся сама' : ''}` };
          },
        },
        {
          id: 'replace', name: 'Заменить позицию', scope: 'item',
          fields: [{ key: 'sku', label: 'Артикул из каталога', required: true, placeholder: 'SW-3.5x35-YZ' }],
          run: async ({ key, item, body, user }) => {
            await backboneDesk.reviseLine(slug, key, item, { verdict: 'replaced', sku: body.sku }, actorOf(user));
            return { message: 'Позиция заменена — синоним записан: в следующей заявке эта фраза найдётся сама' };
          },
        },
        {
          id: 'qty', name: 'Количество', scope: 'item', tones: ['ok', 'ask'],
          fields: [{ key: 'qty', label: 'Сколько в счёт (в единице позиции)', required: true, placeholder: '50' }],
          run: async ({ key, item, body, user }) => {
            await backboneDesk.reviseLine(slug, key, item, { verdict: 'edited', qty: body.qty }, actorOf(user));
            return { message: 'Количество исправлено, упаковка и остаток пересчитаны' };
          },
        },
      ],
    }),

    'weeks': Table({
      rows: async () => (await backboneDesk.measures(slug)).report.weeks.map((w) => ({
        id: w.week,
        week: `с ${w.week.slice(8, 10)}.${w.week.slice(5, 7)}.${w.week.slice(0, 4)}`,
        mode: w.modes.map((m) => MODES[m] || m).join(' + '),
        orders: w.orders,
        reply1h: pct(w.replyWithinHour),
        reply: mins(w.replyMinutes),
        invoice: mins(w.invoiceMinutes),
        manager: mins(w.managerMinutes),
        shadow: accuracyText(w.shadowAccuracy),
        untouched: accuracyText(w.untouched),
        missing: pct(w.missingShare),
        questions: pct(w.questionShare),
        conversion: conversionText(w.conversion),
        b2b: pct(w.b2b),
      })),
      idKey: 'id',
      columns: [
        { key: 'week', name: 'Неделя' },
        { key: 'mode', name: 'Режим' },
        { key: 'orders', name: 'Заявок', type: 'num' },
        { key: 'reply1h', name: 'Ответ ≤ 1 ч' },
        { key: 'reply', name: 'До ответа' },
        { key: 'invoice', name: 'До счёта' },
        { key: 'manager', name: 'Менеджер' },
        { key: 'shadow', name: 'Точность (сравнение)' },
        { key: 'untouched', name: 'Без правки (помощь)' },
        { key: 'missing', name: 'Нет в каталоге' },
        { key: 'questions', name: 'Вопросы' },
        { key: 'conversion', name: 'Конверсия' },
        { key: 'b2b', name: 'B2B' },
      ],
    }),

    'synonyms': Table({
      rows: async () => {
        const catalog = await backboneDesk.catalogOf(slug);
        return (await backboneDesk.synonymsOf(slug)).map((s) => ({
          phrase: s.phrase,
          item: itemName(catalog, s.sku),
          example: s.example,
          hits: s.hits,
          by: s.created_by,
          at: new Date(s.updated_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        }));
      },
      idKey: 'phrase',
      columns: [
        { key: 'phrase', name: 'Фраза клиента', sortable: true },
        { key: 'item', name: 'Позиция', sortable: true },
        { key: 'example', name: 'Впервые в строке' },
        { key: 'hits', name: 'Подтверждений', type: 'num', sortable: true },
        { key: 'by', name: 'Кто' },
        { key: 'at', name: 'Когда' },
      ],
      search: ['phrase', 'item', 'example'],
    }),

    'catalog': Table({
      rows: async () => (await backboneDesk.catalogOf(slug)).items(),
      idKey: 'sku',
      columns: [
        { key: 'sku', name: 'Артикул', sortable: true },
        { key: 'name', name: 'Наименование', sortable: true },
        { key: 'group', name: 'Группа', sortable: true },
        { key: 'unit', name: 'Ед.' },
        { key: 'pack', name: 'Упак.', type: 'num', sortable: true },
        { key: 'price', name: 'Цена, ₽', type: 'num', sortable: true },
        { key: 'stock', name: 'Остаток', type: 'num', sortable: true },
      ],
      search: ['sku', 'name', 'group'],
    }),
    // ---------- шаг 6: каталог магазина из выгрузки ----------

    // Сопоставление «поле каталога ← колонка файла» ожидающей выгрузки; здесь же — файл и подмена.
    'catalog-fields': Table({
      rows: async () => {
        const load = await backboneDesk.pendingCatalog(slug);
        const columns = new Map(((load && load.columns) || []).map((c) => [c.index, c]));
        return catalogFile.fields.map((f) => {
          const index = load ? load.mapping[f.key] : null;
          const c = index == null ? null : columns.get(index);
          return {
            id: f.key,
            field: f.name,
            required: f.required ? 'обязательное' : '',
            column: c ? `${c.letter} · «${c.header || 'без шапки'}»` : (load ? 'не взято' : null),
            samples: c ? c.samples.join(' · ') : null,
          };
        });
      },
      idKey: 'id',
      columns: [
        { key: 'field', name: 'Поле каталога' },
        { key: 'required', name: '' },
        { key: 'column', name: 'Колонка файла' },
        { key: 'samples', name: 'Примеры значений' },
      ],
      actions: [
        {
          id: 'upload', name: 'Загрузить файл выгрузки',
          fields: [{ key: 'file', type: 'file', label: 'xlsx из 1С, МойСклад или прайс', accept: '.xlsx', required: true, maxBytes: 10 * 1024 * 1024 }],
          run: async ({ body, user }) => {
            const r = await backboneDesk.uploadCatalog(slug, body.file, actorOf(user));
            const byIndex = new Map(r.columns.map((c) => [c.index, c]));
            const taken = catalogFile.fields.filter((f) => r.mapping[f.key] != null).map((f) => `${f.name} ← ${byIndex.get(r.mapping[f.key]).letter}`);
            const left = catalogFile.fields.filter((f) => r.mapping[f.key] == null).map((f) => f.name);
            return {
              message: `«${r.fileName}»: шапка в строке ${r.headerRow}, строк под ней ${r.rows}. Сопоставлено: ${taken.join(', ')}`
                + `${left.length ? `; не нашли: ${left.join(', ')}` : ''}. Проверьте колонки и нажмите «Загрузить каталог».`,
            };
          },
        },
        {
          id: 'map', name: 'Указать колонку', bulk: true, max: 1,
          fields: [{ key: 'column', label: 'Колонка файла: буква, номер или название; «-» — не брать', required: true, placeholder: 'C' }],
          run: async ({ ids, body }) => {
            const r = await backboneDesk.mapCatalogField(slug, ids[0], body.column);
            const field = catalogFile.fields.find((f) => f.key === ids[0]).name;
            return { message: r.column ? `${field} ← ${r.column.letter} «${r.column.header}»` : `${field}: колонку не берём` };
          },
        },
        {
          id: 'commit', name: 'Загрузить каталог',
          run: async ({ user }) => {
            const r = await backboneDesk.commitCatalog(slug, actorOf(user));
            return {
              ...r,
              message: r.ok
                ? `Каталог подменён: ${r.loaded} позиций${r.rejected ? `, не загружено строк ${r.rejected} — список ниже` : ''}. Индекс и синонимы — от нового каталога.`
                : `Каталог не подменён: ${r.reason}. Прежний каталог работает; брак — списком ниже.`,
            };
          },
        },
      ],
    }),

    'catalog-columns': Table({
      rows: async () => {
        const load = await backboneDesk.pendingCatalog(slug);
        if (!load) return [];
        const fieldOf = new Map(catalogFile.fields.filter((f) => load.mapping[f.key] != null).map((f) => [load.mapping[f.key], f.name]));
        return load.columns.map((c) => ({
          id: c.letter, letter: c.letter, header: c.header, samples: c.samples.join(' · '), field: fieldOf.get(c.index) || null,
        }));
      },
      idKey: 'id',
      columns: [
        { key: 'letter', name: 'Колонка' },
        { key: 'header', name: 'Шапка' },
        { key: 'samples', name: 'Примеры' },
        { key: 'field', name: 'Поле каталога' },
      ],
    }),

    // Брак последней попытки: строка листа, причина, что в ней было.
    'catalog-rejects': Table({
      rows: async () => {
        const [last] = (await backboneDesk.catalogLoads(slug)).filter((l) => l.rejected || l.status !== 'pending');
        return ((last && last.rejects) || []).map((r) => ({ id: String(r.row), row: r.row, reason: r.reason, cells: r.cells }));
      },
      idKey: 'id',
      columns: [
        { key: 'row', name: 'Строка файла', type: 'num', sortable: true },
        { key: 'reason', name: 'Почему не загружена', sortable: true },
        { key: 'cells', name: 'Что в строке' },
      ],
      search: ['reason', 'cells'],
    }),

    'catalog-loads': Table({
      rows: async () => (await backboneDesk.catalogLoads(slug)).map((l) => ({
        id: l.id,
        at: at(l.created_at),
        file: l.file_name,
        status: l.status === 'pending' && l.reason ? 'ждёт: попытка не прошла' : LOAD_STATUS[l.status],
        rows: l.rows || null,
        loaded: l.loaded || null,
        rejected: l.rejected || null,
        reason: l.reason,
        actor: l.actor,
      })),
      idKey: 'id',
      columns: [
        { key: 'at', name: 'Когда' },
        { key: 'file', name: 'Файл' },
        { key: 'status', name: 'Статус' },
        { key: 'rows', name: 'Строк', type: 'num' },
        { key: 'loaded', name: 'Позиций', type: 'num' },
        { key: 'rejected', name: 'Не загружено', type: 'num' },
        { key: 'reason', name: 'Причина отказа' },
        { key: 'actor', name: 'Кто' },
      ],
    }),

    // ---------- шаг 5: ассистент ----------

    'chats': Table({
      rows: async () => (await assistant.dialogues(slug)).map((d) => ({
        id: d.id,
        who: d.visitor_name,
        last: d.last_text,
        ball: d.last_role === 'visitor' ? 'ждёт ответа' : 'ответ отправлен',
        answered: d.answered,
        deferred: d.deferred,
        drafts: Number(d.open_drafts) || null,
        orders: d.orders.length ? d.orders.map((n) => `№${n}`).join(', ') : null,
        at: at(d.last_incoming_at),
      })),
      idKey: 'id',
      columns: [
        { key: 'who', name: 'Собеседник', sortable: true },
        { key: 'last', name: 'Последнее сообщение' },
        { key: 'ball', name: 'Чей ход', sortable: true },
        { key: 'answered', name: 'Ответил сам', type: 'num' },
        { key: 'deferred', name: 'Ждали менеджера', type: 'num' },
        { key: 'drafts', name: 'Черновик', type: 'num' },
        { key: 'orders', name: 'Заявки из чата' },
        { key: 'at', name: 'Последнее входящее' },
      ],
      search: ['who', 'last'],
      actions: [
        {
          id: 'propose', name: 'Предложить ответ', bulk: true, max: 1,
          run: async ({ ids, user }) => {
            const r = await assistant.proposeReply(slug, ids[0], user);
            return { ...r, message: r.ok ? 'Черновик готов — строка «черновик» в сообщениях: отправить, править или отклонить' : `Черновик не получен: ${r.message}` };
          },
        },
        {
          id: 'reply', name: 'Ответить своим текстом', bulk: true, max: 1,
          fields: [{ key: 'text', label: 'Ответ клиенту', required: true, multiline: true }],
          run: async ({ ids, body, user }) => {
            await assistant.reply(slug, ids[0], body.text, actorOf(user));
            return { message: 'Ответ отправлен — клиент увидит его в виджете' };
          },
        },
      ],
    }),

    'chat-messages': Table({
      rows: async () => (await assistant.messages(slug)).map(({ dialogue, message: m, auto }) => ({
        id: `${dialogue.id}/${m.id}`,
        chat: `${dialogue.visitor_name} · ${dialogue.id.slice(0, 4)}`,
        who: m.role === 'visitor' ? 'клиент'
          : m.role === 'draft' ? DRAFT_STATES[m.state] || m.state
            : auto ? `ассистент · ${ASKS[auto.data.kind] || AUTO_NAMES[auto.type] || 'сам'}` : 'менеджер',
        text: m.text,
        at: at(m.created_at),
      })),
      idKey: 'id',
      columns: [
        { key: 'at', name: 'Когда' },
        { key: 'chat', name: 'Разговор', sortable: true },
        { key: 'who', name: 'Кто', sortable: true },
        { key: 'text', name: 'Текст' },
      ],
      search: ['chat', 'who', 'text'],
      actions: [
        {
          id: 'approve', name: 'Отправить черновик', bulk: true, max: 1,
          fields: [{ key: 'text', label: 'Правка — пусто: отправить как есть', multiline: true }],
          run: async ({ ids, body, user }) => {
            const [dialogueId, draftId] = String(ids[0]).split('/');
            const draft = await assistant.approveDraft(slug, dialogueId, draftId, { text: body.text, actor: actorOf(user) });
            return { message: draft.state === 'edited' ? 'Отправлено с правкой' : 'Черновик отправлен клиенту' };
          },
        },
        {
          id: 'reject', name: 'Отклонить черновик', bulk: true, max: 1,
          run: async ({ ids, user }) => {
            const [dialogueId, draftId] = String(ids[0]).split('/');
            await assistant.rejectDraft(slug, dialogueId, draftId, actorOf(user));
            return { message: 'Черновик отклонён' };
          },
        },
      ],
    }),
  });
}

// Экземпляры магазина строятся один раз на адрес: декларации — замыкания над slug.
const built = new Map();
function forShop(slug) {
  if (!built.has(slug)) built.set(slug, shopComponents(slug));
  return built.get(slug);
}

// ---------- кабинет: магазины ----------

const SHOP_FIELDS = [
  { key: 'name', label: 'Название', placeholder: 'Крепёж на Ленина' },
  { key: 'days', label: 'Дни работы', placeholder: 'пн–сб' },
  { key: 'time', label: 'Часы', placeholder: '09:00–19:00' },
  { key: 'email', label: 'Почта магазина для квитанций (ответ клиента)', placeholder: 'zakaz@shop.ru' },
];

const cabinet = Components({
  'shops': Table({
    rows: async () => {
      const out = [];
      for (const shop of await backboneDesk.shopList()) {
        const catalog = await backboneDesk.catalogOf(shop.slug);
        const { days, shadowDays } = await backboneDesk.measures(shop.slug);
        out.push({
          id: shop.slug,
          slug: shop.slug,
          name: shop.name,
          niche: NICHE_NAMES[shop.niche] || shop.niche,
          mode: shop.mode === 'shadow' ? `сравнение, день ${days}${shadowDays ? ` из ${shadowDays}` : ''}` : MODES[shop.mode] || shop.mode,
          hours: hoursText(shop.hours),
          email: shop.reply_to,
          catalog: shop.catalog_version ? `выгрузка, ${catalog.items().length} поз.` : catalog.items().length ? `фикстура, ${catalog.items().length} поз.` : 'не загружен',
          site: `/backbone/?shop=${encodeURIComponent(shop.slug)}`,
          cabinet: cabinetOf(shop.slug),
          created: at(shop.created_at),
        });
      }
      return out;
    },
    idKey: 'id',
    columns: [
      { key: 'slug', name: 'Адрес', sortable: true },
      { key: 'name', name: 'Название', sortable: true },
      { key: 'niche', name: 'Ниша' },
      { key: 'mode', name: 'Разбор заявок' },
      { key: 'hours', name: 'Часы работы' },
      { key: 'email', name: 'Почта для квитанций' },
      { key: 'catalog', name: 'Каталог' },
      { key: 'site', name: 'Витрина', render: 'link' },
      { key: 'cabinet', name: 'Кабинет', render: 'link' },
      { key: 'created', name: 'Заведён' },
    ],
    search: ['slug', 'name'],
    actions: [
      {
        id: 'open', name: 'Завести магазин',
        fields: [
          { key: 'slug', label: 'Адрес (slug): латиница, цифры, дефис', required: true, placeholder: 'krepezh-kursk' },
          { ...SHOP_FIELDS[0], required: true },
          { key: 'niche', label: 'Ниша', required: true, options: Object.keys(TEMPLATES).map((k) => ({ value: k, name: NICHE_NAMES[k] || k })) },
          ...SHOP_FIELDS.slice(1),
        ],
        run: async ({ body, user }) => {
          const shop = await backboneDesk.openShop(body, actorOf(user));
          return {
            slug: shop.slug,
            message: `Магазин «${shop.name}» заведён, разбор — «Сравнение»: витрина /backbone/?shop=${shop.slug}, кабинет ${cabinetOf(shop.slug)}. Дальше — экран «Каталог»: загрузите выгрузку.`,
          };
        },
      },
      {
        id: 'change', name: 'Изменить', bulk: true, max: 1,
        fields: SHOP_FIELDS.map((f) => (f.key === 'email' ? { ...f, label: `${f.label}; «-» — убрать` } : f)),
        run: async ({ ids, body, user }) => {
          const shop = await backboneDesk.changeShop(ids[0], body, actorOf(user));
          return { message: `«${shop.name}»: ${hoursText(shop.hours)}, почта ${shop.reply_to || '—'}` };
        },
      },
      {
        id: 'staff', name: 'Добавить сотрудника', bulk: true, max: 1,
        fields: [{ key: 'email', label: 'Почта сотрудника — с ней он зарегистрируется сам', required: true, placeholder: 'manager@shop.ru' }],
        run: async ({ ids, body, user }) => {
          const { shop, email } = await backboneDesk.addStaff(ids[0], body.email, actorOf(user));
          return {
            message: `${email} — сотрудник «${shop.name}». Пусть зарегистрируется на сайте с этой почтой и откроет кабинет ${cabinetOf(shop.slug)}`,
          };
        },
      },
    ],
  }),

  // Сотрудники: почта входит в кабинет только своего магазина; убранный теряет вход сразу.
  'staff': Table({
    rows: async () => (await backboneDesk.staffList()).map((s) => ({
      id: `${s.slug}:${s.email}`, // в адресе магазина двоеточия нет — граница пары однозначна
      shop: `${s.slug} · ${s.name}`,
      email: s.email,
      by: s.added_by,
      at: at(s.added_at),
    })),
    idKey: 'id',
    columns: [
      { key: 'shop', name: 'Магазин', sortable: true },
      { key: 'email', name: 'Почта сотрудника', sortable: true },
      { key: 'by', name: 'Кто добавил' },
      { key: 'at', name: 'Когда' },
    ],
    search: ['shop', 'email'],
    actions: [
      {
        id: 'remove', name: 'Убрать сотрудника', bulk: true, max: 20,
        run: async ({ ids, user }) => {
          const done = [];
          for (const id of ids) {
            const cut = id.indexOf(':');
            const { email } = await backboneDesk.removeStaff(id.slice(0, cut), id.slice(cut + 1), actorOf(user));
            done.push(email);
          }
          return { message: `Убраны: ${done.join(', ')} — кабинет магазина им закрыт` };
        },
      },
    ],
  }),
});

module.exports = { forShop, cabinet };
