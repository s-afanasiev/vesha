// Квитанции клиенту (docs/backbone-architecture.md §6.1, §5: Outbox(Retry(5, receipts))).
// Квитанция — проекция журнала (О15): события заявок с сайта после курсора магазина
// превращаются в письма исходящих; доставка — отдельно от перехода (П35), с повтором.
//
// Когда пишем:
//   received (с сайта)                — «получено, номер, ответим до …, ссылка на путь»;
//   переход в тип waiting_client      — «ждём вашего ответа: <колонка>»;
//   переход в тип done                — «готово: <колонка>»;
//   переход в тип refused             — «заявка закрыта».
// Переходы внутри одного типа и переносы при удалении колонки клиенту не пишем.
// Нет почты (только телефон) — квитанция «пропущена» с причиной, а не тишина.
//
// Той же проекцией — письмо менеджеру о новой заявке (ShopNotice): одно событие
// даёт до двух писем, ключ против дублей — «событие + адресат» (audience).

const KIND_BY_TYPE = { waiting_client: 'waiting', done: 'done', refused: 'refused' };

class Receipts {
  constructor({ repository, journal, mailbox, statusUrl, deadlineOf, notice = null, maxAttempts = 5, batch = 20 }) {
    this.repository = repository;
    this.journal = journal;
    this.mailbox = mailbox;       // send({ to, subject, body, shop, replyTo }) → Promise
    this.statusUrl = statusUrl;   // token → абсолютная ссылка на окно статуса
    this.deadlineOf = deadlineOf; // (магазин, момент) → «17.10 в 15:00» | null
    this.notice = notice;         // письмо менеджеру магазина: kindOf(e), letter(...)
    this.maxAttempts = maxAttempts;
    this.batch = batch;
  }

  kindOf(e) {
    if (e.stream !== 'order') return null;
    if (e.type === 'received') return e.data.channel === 'site' ? 'received' : null;
    if (e.type !== 'moved' || e.cause === 'column_removed') return null;
    if (e.data.fromType === e.data.toType) return null;
    return KIND_BY_TYPE[e.data.toType] || null;
  }

  // События после курсора → строки исходящих; курсор сдвигается в той же транзакции.
  async project(shop, columns) {
    const cursor = await this.repository.receiptsCursor(shop.id);
    const events = await this.journal.after(shop.id, cursor);
    if (!events.length) return 0;
    const titles = new Map(columns.map((c) => [c.id, c.title]));
    const rows = [];
    for (const e of events) {
      const kind = this.kindOf(e);
      const notice = this.notice ? this.notice.kindOf(e) : null;
      if (!kind && !notice) continue;
      const order = await this.repository.orderById(e.subject_id);
      if (!order) continue;
      if (kind && order.channel === 'site' && order.status_token) {
        rows.push(this.letter({ shop, order, event: e, kind, column: titles.get(e.data.to) || '' }));
      }
      if (notice) rows.push(this.notice.letter({ shop, order, event: e, kind: notice, column: titles.get(order.column_id) || '' }));
    }
    await this.repository.saveReceipts(shop.id, cursor, events[events.length - 1].id, rows);
    return rows.length;
  }

  letter({ shop, order, event, kind, column }) {
    const link = this.statusUrl(order.status_token);
    const n = order.number;
    const email = order.contact.includes('@');
    let subject;
    let body;
    if (kind === 'received') {
      const until = this.deadlineOf(shop, new Date(event.at).getTime());
      subject = `Заявка №${n} получена — ${shop.name}`;
      body = [
        'Здравствуйте!',
        `Мы получили вашу заявку №${n}.${until ? ` Ответим до ${until}.` : ''}`,
        event.data.refusal === 'scan'
          ? `Файл «${event.data.file || ''}» — скан или фото, текст из него мы прочитать не можем. Пришлите, пожалуйста, список текстом или таблицей xlsx в ответ на это письмо.`
          : null,
        `Путь заявки: ${link}`,
      ].filter(Boolean).join('\n\n');
    } else if (kind === 'waiting') {
      subject = `Заявка №${n}: ждём вашего ответа`;
      body = `По заявке №${n}: «${column}». Ждём вашего ответа.\n\nПуть заявки: ${link}`;
    } else if (kind === 'done') {
      subject = `Заявка №${n} готова`;
      body = `Заявка №${n}: «${column}».\n\nПуть заявки: ${link}`;
    } else {
      subject = `Заявка №${n} закрыта`;
      body = `Заявка №${n} закрыта. Если это ошибка — ответьте на это письмо.\n\nПуть заявки: ${link}`;
    }
    return {
      orderId: order.id, eventId: event.id, kind, audience: 'client',
      channel: email ? 'email' : 'none',
      address: email ? order.contact : '',
      replyTo: null,                // ответ клиента — на почту магазина (letter.js)
      subject, body: `${body}\n\n— ${shop.name}`,
      status: email ? 'pending' : 'skipped',
      lastError: email ? null : 'нет почты: квитанции по телефону — после MVP',
    };
  }

  // Доставка ожидающих: письмо ушло — sent; сбой — failed с повтором до maxAttempts.
  async deliver(shopOf) {
    const pending = await this.repository.pendingReceipts(this.maxAttempts, this.batch);
    let sent = 0;
    for (const r of pending) {
      try {
        await this.mailbox.send({ to: r.address, subject: r.subject, body: r.body, shop: await shopOf(r.shop_id), replyTo: r.reply_to || null });
        await this.repository.markReceipt(r.id, { status: 'sent' });
        sent++;
      } catch (err) {
        await this.repository.markReceipt(r.id, { status: 'failed', error: String(err.message || err) });
      }
    }
    return { pending: pending.length, sent };
  }
}

module.exports = { Receipts };
