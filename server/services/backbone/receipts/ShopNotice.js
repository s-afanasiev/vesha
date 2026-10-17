// Письмо менеджеру о новой заявке (docs/backbone-handover.md §7): та же проекция
// журнала, что квитанции клиенту (Receipts), — курсор, повтор без дублей, доставка
// отдельно от перехода (П35). Адрес — почта магазина (reply_to); нет почты — письмо
// «пропущено» с причиной, а заявка всё равно на доске.
//
// Когда пишем (заявка пришла снаружи — не заведена менеджером вручную):
//   received        — «новая заявка»: клиент, контакт, срок ответа из квитанции,
//                     первые строки списка, ссылка на кабинет;
//   received_again  — тот же список с того же контакта ещё раз: клиент ждёт ответа
//                     или заказывает повторно, а новая заявка не заведена — без письма
//                     это молча легло бы в старую карточку.
// Ответ на письмо уходит клиенту (Reply-To — его почта), если он оставил почту.

const { address } = require('./letter');

class ShopNotice {
  constructor({ cabinetUrl, deadlineOf, lines = 5, lineLength = 160 }) {
    this.cabinetUrl = cabinetUrl;   // slug магазина → абсолютная ссылка на его кабинет
    this.deadlineOf = deadlineOf;   // (магазин, момент) → «17.10 в 15:00» | null — то, что обещано клиенту
    this.lines = lines;             // сколько строк списка показать в письме
    this.lineLength = lineLength;
  }

  kindOf(e) {
    if (e.stream !== 'order' || !e.data.channel || e.data.channel === 'manual') return null;
    if (e.type === 'received') return 'received';
    if (e.type === 'received_again') return 'again';
    return null;
  }

  // Почта клиента для Reply-To — только та, что пройдёт в заголовок; иначе ответ — магазину.
  replyTo(contact) {
    try { return address(contact); } catch { return null; }
  }

  // Начало списка: непустые строки текста заявки, длинные — с многоточием.
  head(text) {
    const all = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const cut = (l) => (l.length > this.lineLength ? `${l.slice(0, this.lineLength - 1)}…` : l);
    const shown = all.slice(0, this.lines).map(cut);
    return all.length > shown.length ? [...shown, `… и ещё строк: ${all.length - shown.length}`] : shown;
  }

  letter({ shop, order, event, kind, column }) {
    const n = order.number;
    const link = this.cabinetUrl(shop.slug);
    const contact = String(order.contact || '');
    const replyTo = contact.includes('@') ? this.replyTo(contact) : null;
    const who = `Клиент: ${order.client}\nКонтакт: ${contact || '—'}`;
    let subject;
    let body;
    if (kind === 'received') {
      const until = this.deadlineOf(shop, new Date(event.at).getTime());
      subject = `Новая заявка №${n} — ${order.client}`;
      body = [
        `Новая заявка №${n} с сайта.`,
        `${who}${until ? `\nОтветить до: ${until} — это обещано клиенту в квитанции` : ''}`,
        `Список:\n${this.head(order.text).join('\n')}`,
        event.data.refusal === 'scan'
          ? `Файл «${event.data.file || ''}» — скан или фото: клиента попросили прислать список текстом.`
          : null,
        `Заявка на доске: ${link}`,
        replyTo ? 'Ответ на это письмо уйдёт клиенту.' : null,
      ].filter(Boolean).join('\n\n');
    } else {
      subject = `Заявка №${n}: тот же список пришёл ещё раз`;
      body = [
        `Клиент прислал тот же список ещё раз — новую заявку не заводили, это заявка №${n}${column ? `, она сейчас в колонке «${column}»` : ''}.`,
        'Клиент ждёт ответа — или, если заявка уже закрыта, заказывает повторно.',
        who,
        `Заявка на доске: ${link}`,
        replyTo ? 'Ответ на это письмо уйдёт клиенту.' : null,
      ].filter(Boolean).join('\n\n');
    }
    const to = shop.reply_to || '';
    return {
      orderId: order.id, eventId: event.id, kind, audience: 'shop',
      channel: to ? 'email' : 'none',
      address: to,
      replyTo,
      subject, body,
      status: to ? 'pending' : 'skipped',
      lastError: to ? null : 'у магазина нет почты: укажите её в кабинете — «Магазины» → «Изменить»',
    };
  }
}

module.exports = { ShopNotice };
