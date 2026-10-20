// Квитанции клиенту (docs/backbone-architecture.md §6.1, §5: Outbox(Retry(5, receipts))).
// Квитанция — проекция журнала (О15): события заявок с сайта после курсора магазина
// превращаются в письма исходящих; доставка — отдельно от перехода (П35), с повтором.
//
// Когда пишем:
//   received (с сайта или из чата)    — «получено, номер, ответим до …, ссылка на путь»;
//   переход в тип waiting_client      — «ждём вашего ответа»;
//   переход в тип done                — «заявка выполнена»;
//   переход в тип refused             — «заявка закрыта».
// Переходы внутри одного типа и переносы при удалении колонки клиенту не пишем.
// Нет почты (только телефон) — квитанция «пропущена» с причиной, а не тишина.
//
// В письме покупателю — только наш текст (решение пользователя 20.10.2026: письма уходят
// через наш ящик для рассылки): фраза — по типу колонки, а не её название, которое правит
// сотрудник магазина; имя файла заявки — тоже нет. Свободный текст магазина в письме —
// только название магазина, его задаёт админ. Форма витрины открыта всем, и в ней можно
// указать чужой адрес — поэтому не больше perAddress.letters писем на один адрес за
// perAddress.hours в магазине, сверх — «пропущена» с причиной.
//
// Той же проекцией — письмо менеджеру о новой заявке (ShopNotice): одно событие
// даёт до двух писем, ключ против дублей — «событие + адресат» (audience).

const KIND_BY_TYPE = { waiting_client: 'waiting', done: 'done', refused: 'refused' };
const CHANNELS = new Set(['site', 'chat']); // заявки с витрины и из разговора с ассистентом — у них есть окно статуса

// Что говорим покупателю на переходе — по смыслу колонки, одними словами для всех магазинов.
const PHRASES = {
  waiting: {
    subject: (n) => `Заявка №${n}: ждём вашего ответа`,
    text: (n) => `По заявке №${n} ждём вашего ответа или решения — подробности менеджер пришлёт отдельным письмом. Вопрос можно задать ответом на это письмо.`,
  },
  done: {
    subject: (n) => `Заявка №${n} выполнена`,
    text: (n) => `Заявка №${n} выполнена. Если что-то не так — ответьте на это письмо.`,
  },
  refused: {
    subject: (n) => `Заявка №${n} закрыта`,
    text: (n) => `Заявка №${n} закрыта. Если это ошибка — ответьте на это письмо.`,
  },
};

class Receipts {
  constructor({ repository, journal, mailbox, statusUrl, deadlineOf, notice = null, perAddress = null, maxAttempts = 5, batch = 20, clock = () => new Date() }) {
    this.repository = repository;
    this.journal = journal;
    this.mailbox = mailbox;       // send({ to, subject, body, shop, replyTo }) → { from } — с какого адреса ушло
    this.statusUrl = statusUrl;   // token → абсолютная ссылка на окно статуса
    this.deadlineOf = deadlineOf; // (магазин, момент) → «17.10 в 15:00» | null
    this.notice = notice;         // письмо менеджеру магазина: kindOf(e), letter(...)
    this.perAddress = perAddress; // { letters, hours }: писем покупателю на один адрес за окно; null — без счёта
    this.maxAttempts = maxAttempts;
    this.batch = batch;
    this.clock = clock;
  }

  kindOf(e) {
    if (e.stream !== 'order') return null;
    if (e.type === 'received') return CHANNELS.has(e.data.channel) ? 'received' : null;
    if (e.type !== 'moved' || e.cause === 'column_removed') return null;
    if (e.data.fromType === e.data.toType) return null;
    return KIND_BY_TYPE[e.data.toType] || null;
  }

  // События после курсора → строки исходящих; курсор сдвигается в той же транзакции.
  async project(shop, columns) {
    const cursor = await this.repository.receiptsCursor(shop.id);
    const events = await this.journal.after(shop.id, cursor);
    if (!events.length) return 0;
    const titles = new Map(columns.map((c) => [c.id, c.title])); // название колонки — только менеджеру, не покупателю
    const rows = [];
    const sent = new Map(); // адрес покупателя → писем ему за окно: из базы и этой партии
    for (const e of events) {
      const kind = this.kindOf(e);
      const notice = this.notice ? this.notice.kindOf(e) : null;
      if (!kind && !notice) continue;
      const order = await this.repository.orderById(e.subject_id);
      if (!order) continue;
      if (kind && CHANNELS.has(order.channel) && order.status_token) {
        rows.push(await this.limited(shop, this.letter({ shop, order, event: e, kind }), sent));
      }
      if (notice) rows.push(this.notice.letter({ shop, order, event: e, kind: notice, column: titles.get(order.column_id) || '' }));
    }
    await this.repository.saveReceipts(shop.id, cursor, events[events.length - 1].id, rows);
    return rows.length;
  }

  // Не больше perAddress.letters писем покупателю на один адрес за perAddress.hours: в форме
  // витрины можно указать чужой адрес, и наш ящик не должен стать рассылкой на него.
  // Считаются письма, которые ушли или уйдут (пропущенные — нет).
  async limited(shop, row, sent) {
    if (!this.perAddress || row.status !== 'pending') return row;
    const { letters, hours } = this.perAddress;
    if (!sent.has(row.address)) {
      const since = new Date(this.clock().getTime() - hours * 60 * 60 * 1000);
      sent.set(row.address, await this.repository.lettersTo(shop.id, row.address, since));
    }
    const count = sent.get(row.address);
    if (count >= letters) {
      return { ...row, status: 'skipped', lastError: `на этот адрес за ${hours} ч уже ${letters} писем — больше не шлём, чтобы форма витрины не стала рассылкой` };
    }
    sent.set(row.address, count + 1);
    return row;
  }

  letter({ shop, order, event, kind }) {
    const link = this.statusUrl(order.status_token);
    const n = order.number;
    const email = !order.erased_at && order.contact.includes('@'); // данные покупателя удалены — писать некому
    let subject;
    let body;
    if (kind === 'received') {
      const until = this.deadlineOf(shop, new Date(event.at).getTime());
      subject = `Заявка №${n} получена — ${shop.name}`;
      body = [
        'Здравствуйте!',
        `Мы получили вашу заявку №${n}.${until ? ` Ответим до ${until}.` : ''}`,
        event.data.refusal === 'scan' // имя файла — текст отправителя, в письмо не берём
          ? 'Приложенный файл — скан или фото, текст из него мы прочитать не можем. Пришлите, пожалуйста, список текстом или таблицей xlsx в ответ на это письмо.'
          : null,
        `Путь заявки: ${link}`,
      ].filter(Boolean).join('\n\n');
    } else {
      const phrase = PHRASES[kind];
      subject = phrase.subject(n);
      body = `${phrase.text(n)}\n\nПуть заявки: ${link}`;
    }
    return {
      orderId: order.id, eventId: event.id, kind, audience: 'client',
      channel: email ? 'email' : 'none',
      address: email ? order.contact : '',
      replyTo: null,                // ответ клиента — на почту магазина (letter.js)
      subject, body: `${body}\n\n— ${shop.name}`,
      status: email ? 'pending' : 'skipped',
      lastError: email ? null : order.erased_at ? 'данные покупателя удалены' : 'нет почты: квитанции по телефону — после MVP',
    };
  }

  // Доставка ожидающих: письмо ушло — sent и с какого адреса (след для разбора жалоб);
  // сбой — failed с повтором до maxAttempts. shopId — только письма этого магазина (кнопка в его кабинете).
  async deliver(shopOf, { shopId = null } = {}) {
    const pending = await this.repository.pendingReceipts(this.maxAttempts, this.batch, shopId);
    let sent = 0;
    for (const r of pending) {
      try {
        const out = await this.mailbox.send({ to: r.address, subject: r.subject, body: r.body, shop: await shopOf(r.shop_id), replyTo: r.reply_to || null });
        await this.repository.markReceipt(r.id, { status: 'sent', from: (out && out.from) || null });
        sent++;
      } catch (err) {
        await this.repository.markReceipt(r.id, { status: 'failed', error: String(err.message || err) });
      }
    }
    return { pending: pending.length, sent };
  }
}

module.exports = { Receipts };
