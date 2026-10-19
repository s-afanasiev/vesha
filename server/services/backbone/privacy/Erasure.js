// Удаление данных покупателя (152-ФЗ, ст. 21; docs/backbone-handover.md §6) — один узел
// на два повода: запрос покупателя (кабинет: найти заявки по контакту → «Удалить данные
// покупателя») и срок хранения (раз в сутки по таймеру — Retention — и кнопкой в кабинете).
// Что считать ПДн и чем заменить — Anonymizer. Где они лежат и кто их стирает:
//   заявки, строки черновика, синонимы, письма (адрес, тема, тело) и журнал — репозиторий,
//     одной транзакцией вместе с событием personal_data_erased (кто, когда, сколько — без
//     самих данных);
//   переписка ассистента — территория chat-engine: разговоры гостя этих заявок и те, из
//     которых пришли заявки (DialogueRepository.forget);
//   письма файлами .eml, пока нет SMTP, — почтальон (mailbox.forget).
// Порядок — сага с безопасным повтором (П27, П36): разговоры и файлы ищутся по ключу гостя
// и контакту из заявок, поэтому они — первыми, транзакция заявок — последней; сбой
// посередине оставляет заявки с данными, повтор доделывает остальное.

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

const ms = (at) => new Date(at).getTime(); // pg отдаёт Date, двойник — строку ISO
const NONE = { orders: 0, numbers: [], dialogues: 0, letters: 0, files: 0 };

class Erasure {
  constructor({ repository, journal, anonymizer, keepYears, visitorKeyOf, dialogues = null, mailbox = null, batch = 100, clock = () => new Date() }) {
    this.repository = repository;   // заявки, строки, синонимы, письма, журнал — одной транзакцией
    this.journal = journal;
    this.anonymizer = anonymizer;   // что в строках — ПДн и чем заменить
    this.keepYears = keepYears;     // срок хранения из политики ПДн
    this.visitorKeyOf = visitorKeyOf; // (магазин, гость) → ключ разговора ассистента
    this.dialogues = dialogues;     // разговоры ассистента: forget({ prefix, visitorKeys, ids, idleBefore })
    this.mailbox = mailbox;         // письма-файлы: forget({ shop, contacts, numbers }) → сколько удалено
    this.batch = batch;             // заявок на транзакцию автоочистки
    this.clock = clock;
  }

  // Граница срока хранения: всё, что раньше, — старше keepYears лет.
  cutoff() {
    const at = new Date(this.clock().getTime());
    at.setUTCFullYear(at.getUTCFullYear() - this.keepYears);
    return at;
  }

  // До какого дня хранятся данные заявки: срок — от заявки или от последней повторной
  // отправки того же списка (received_again: покупатель снова дал согласие).
  keepUntil(from) {
    const at = new Date(ms(from));
    at.setUTCFullYear(at.getUTCFullYear() + this.keepYears);
    return at.toISOString();
  }

  // Заявки магазина для экрана «Данные покупателей»: с днём, до которого хранятся данные.
  async ledger(shop) {
    const again = new Map(); // заявка → последняя повторная отправка
    for (const e of await this.journal.history(shop.id)) if (e.type === 'received_again') again.set(String(e.subject_id), e.at);
    return (await this.repository.orders(shop.id))
      .map((o) => ({ ...o, keep_until: o.erased_at ? null : this.keepUntil(again.get(String(o.id)) || o.created_at) }))
      .reverse();
  }

  // По запросу покупателя: выбранные заявки этого магазина; чужая или несуществующая —
  // «не найдена» (тот же ответ, что у остальных дверей костяка).
  async byRequest(shop, orderIds, actor) {
    const ids = [...new Set((orderIds || []).map(String))];
    if (!ids.length) throw fail('Не выбрано ни одной заявки', 400);
    const orders = await this.repository.ordersByIds(shop.id, ids);
    if (orders.length !== ids.length) throw fail('Заявка не найдена', 404);
    const left = orders.filter((o) => !o.erased_at);
    if (!left.length) throw fail('Данные этих заявок уже удалены', 400);
    return this.erase(shop, left, { actor, cause: 'request' });
  }

  // По сроку хранения: заявки, срок которых вышел, — пачками; затем разговоры ассистента
  // без движения дольше срока (гость писал, а заявку не отправил).
  async expired(shop, { actor = 'system' } = {}) {
    const before = this.cutoff();
    const due = [];
    for (const o of await this.repository.ordersBefore(shop.id, before)) {
      const again = (await this.journal.forSubject('order', o.id)).filter((e) => e.type === 'received_again').pop();
      if (!again || ms(again.at) < before.getTime()) due.push(o);
    }
    const report = { ...NONE, numbers: [] };
    for (let at = 0; at < due.length; at += this.batch) {
      const r = await this.erase(shop, due.slice(at, at + this.batch), { actor, cause: 'retention' });
      for (const k of ['orders', 'dialogues', 'letters', 'files']) report[k] += r[k];
      report.numbers.push(...r.numbers);
    }
    const idle = this.dialogues ? await this.dialogues.forget({ prefix: this.visitorKeyOf(shop, ''), idleBefore: before }) : [];
    if (idle.length) {
      await this.repository.appendEvents([this.event(shop, { ...NONE, dialogues: idle.length }, { actor, cause: 'retention' })]);
      report.dialogues += idle.length;
    }
    return report;
  }

  event(shop, facts, { actor, cause }) {
    return {
      stream: 'shop', scope: shop.id, subjectId: shop.id, type: 'personal_data_erased',
      data: { orders: facts.orders, numbers: facts.numbers, dialogues: facts.dialogues, letters: facts.letters, files: facts.files, reason: cause },
      actor, cause,
    };
  }

  async erase(shop, orders, { actor, cause }) {
    const ids = orders.map((o) => String(o.id));
    const numbers = orders.map((o) => o.number).sort((a, b) => a - b);
    const orderEvents = [];
    for (const id of ids) orderEvents.push(...await this.journal.forSubject('order', id));
    // переписка ассистента: разговор гостя этих заявок и разговор, из которого пришёл список
    const visitorKeys = [...new Set(orders.map((o) => o.client_key).filter(Boolean))].map((g) => this.visitorKeyOf(shop, g));
    const talks = [...new Set(orderEvents.map((e) => e.data && e.data.dialogue).filter(Boolean).map(String))];
    const dialogues = this.dialogues ? await this.dialogues.forget({ prefix: this.visitorKeyOf(shop, ''), visitorKeys, ids: talks }) : [];
    const chatEvents = [];
    for (const id of dialogues) chatEvents.push(...await this.journal.forSubject('chat', id));
    const files = this.mailbox && this.mailbox.forget
      ? await this.mailbox.forget({ shop, contacts: orders.map((o) => o.contact).filter(Boolean), numbers })
      : 0;
    const plan = this.anonymizer.plan({
      orders,
      lines: await this.repository.lines(shop.id),
      events: [...orderEvents, ...chatEvents],
      synonyms: await this.repository.synonyms(shop.id),
    });
    const { letters } = await this.repository.eraseOrders(shop.id, plan,
      (facts) => [this.event(shop, { orders: ids.length, numbers, dialogues: dialogues.length, letters: facts.letters, files }, { actor, cause })]);
    return { orders: ids.length, numbers, dialogues: dialogues.length, letters, files };
  }
}

// Срок хранения по таймеру: раз в сутки тот же узел обходит все магазины. Сбой магазина —
// в лог, остальные идут дальше (П24); таймер не держит процесс (unref).
class Retention {
  constructor({ shops, erasure, everyHours, firstMinutes, log = console }) {
    this.shops = shops;             // () → все магазины экземпляра
    this.erasure = erasure;
    this.everyMs = everyHours * 60 * 60 * 1000;
    this.firstMs = firstMinutes * 60 * 1000;
    this.log = log;
    this.timer = null;
  }

  async run(actor = 'system') {
    const done = [];
    for (const shop of await this.shops()) {
      try {
        const r = await this.erasure.expired(shop, { actor });
        if (r.orders || r.dialogues) done.push(`${shop.slug}: заявок ${r.orders}, разговоров ${r.dialogues}`);
      } catch (err) {
        this.log.error(`backbone: срок хранения ПДн — магазин ${shop.slug} не обработан`, err);
      }
    }
    if (done.length) this.log.log(`backbone: срок хранения ПДн — обезличено: ${done.join('; ')}`);
    return done;
  }

  start() {
    if (this.timer) return this.timer;
    const tick = () => this.run().catch((err) => this.log.error('backbone: срок хранения ПДн не проверен', err));
    setTimeout(tick, this.firstMs).unref();
    this.timer = setInterval(tick, this.everyMs);
    this.timer.unref();
    return this.timer;
  }
}

module.exports = { Erasure, Retention };
