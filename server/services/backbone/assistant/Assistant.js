// Ассистент магазина (docs/backbone-architecture.md §4, §6.4) — дверь сценариев
// разговора на витрине. Посетитель пишет; три вопроса — наличие и цена, статус своей
// заявки, часы работы — ассистент закрывает сам по фактам магазина (AutoAnswers +
// ShopFacts); список предлагает отправить заявкой (ChatIntake → BackboneDesk);
// остальное ждёт менеджера — ему черновик модели по кнопке, без контактов клиента.
//
// Хозяева истины: разговор — ядро chat-engine (ChatDesk), заявки — дверь костяка
// (BackboneDesk), события разговора — журнал магазина, поток chat (О15):
//   assistant_answered — ассистент ответил сам (kind, refs — артикулы и номера заявок);
//   assistant_deferred — вопрос ждёт менеджера (reason: other | not_in_catalog);
//   list_offered / list_sent — список из разговора предложен / отправлен заявкой;
//   manager_replied — менеджер ответил (своим текстом, черновиком, с правкой).
// Разговор магазина — ключ посетителя «<id магазина>:<гость>»: у каждого магазина
// свои разговоры, а гость витрины — тот же клиент, что прислал заявку с сайта (О20).

const { hoursText } = require('../shops/ShopForm');

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CHANNEL = 'web'; // канал chat-engine: виджет на сайте

class Assistant {
  constructor({
    desk, chatDesk, replyDeskOf, factsOf, answers, intake, repository, journal, statusPath,
    limits = { messages: 30, windowMin: 10 }, clock = () => new Date(),
  }) {
    this.desk = desk;               // BackboneDesk: магазин, заявки собеседника, приём из чата
    this.chatDesk = chatDesk;       // ChatDesk ядра chat-engine: разговоры и сообщения
    this.replyDeskOf = replyDeskOf; // (магазин, кто нажал) → ChatDesk с черновиком в персоне магазина
    this.factsOf = factsOf;         // (магазин, ключ клиента) → ShopFacts
    this.answers = answers;         // автоответы: наличие, статус, часы
    this.intake = intake;           // ChatIntake: список из разговора → заявка
    this.repository = repository;   // запись событий разговора в журнал магазина
    this.journal = journal;
    this.statusPath = statusPath;   // токен → ссылка на окно статуса
    this.limits = limits;           // сообщений посетителя за окно минут
    this.clock = clock;
    this.hits = new Map();          // ключ посетителя → моменты сообщений
  }

  keyOf(shop, guest) {
    return `${shop.id}:${guest}`;
  }

  // ---------- сторона посетителя: виджет витрины ----------

  // Сообщение посетителя → ответ ассистента (или ожидание менеджера) → разговор целиком.
  async hear(slug, guest, { text, externalId } = {}) {
    const shop = await this.shopFor(slug, guest);
    const got = await this.chatDesk.receiveVisitorMessage({
      channel: CHANNEL, visitorKey: this.keyOf(shop, guest), text, externalId,
    });
    if (!got.duplicate) await this.respond(shop, guest, got.dialogue, got.message);
    return this.talk(shop, guest);
  }

  async conversation(slug, guest) {
    if (!guest) return { messages: [], offer: null };
    return this.talk(await this.desk.shop(slug), guest);
  }

  // Согласие → заявка из списка, который посетитель написал в этом разговоре.
  async sendList(slug, guest, form = {}) {
    const shop = await this.shopFor(slug, guest);
    const { dialogue, messages } = await this.chatDesk.visitorDialogue({ channel: CHANNEL, visitorKey: this.keyOf(shop, guest) });
    const message = dialogue && messages.find((m) => m.id === String(form.message || '') && m.role === 'visitor');
    if (!message) throw fail('Сообщение со списком не найдено в этом разговоре', 404);
    const read = this.intake.read(form, message.text);
    const { order, duplicate } = await this.desk.receiveFromChat(shop.slug, read, { clientKey: String(guest), dialogueId: dialogue.id });
    const link = this.statusPath(order.status_token);
    const reply = await this.say(dialogue, duplicate
      ? `Этот список с этого контакта уже у нас — заявка №${order.number}, второй раз не заводим. Путь заявки: ${link}`
      : `Заявка №${order.number} принята. Посчитаем наличие и упаковку и ответим в рабочее время (${hoursText(shop.hours)}). Путь заявки — по ссылке, сохраните её: ${link}`);
    const name = String(form.name || '').trim();
    if (name) await this.chatDesk.updateCard(dialogue.id, { visitorName: name });
    await this.note(shop, dialogue.id, 'list_sent', { message: message.id, number: order.number, duplicate, reply: reply.id });
    return { number: order.number, duplicate, status: link };
  }

  // Разговор для виджета: только сообщения посетителя и магазина (черновики не видны)
  // и неотправленное предложение «отправить список заявкой».
  async talk(shop, guest) {
    const { dialogue, messages } = await this.chatDesk.visitorDialogue({ channel: CHANNEL, visitorKey: this.keyOf(shop, guest) });
    if (!dialogue) return { messages: [], offer: null };
    const events = await this.journal.forSubject('chat', dialogue.id);
    const sent = new Set(events.filter((e) => e.type === 'list_sent').map((e) => e.data.message));
    const offered = events.filter((e) => e.type === 'list_offered' && !sent.has(e.data.message)).pop();
    return {
      messages: messages.map((m) => ({ id: m.id, mine: m.role === 'visitor', text: m.text, at: m.created_at })),
      offer: offered ? { message: offered.data.message, lines: offered.data.lines } : null,
    };
  }

  // Решение по сообщению: список → предложение заявки; вопрос из трёх → ответ по фактам;
  // остальное → менеджеру (уведомление посетителю — один раз на серию вопросов).
  async respond(shop, guest, dialogue, message) {
    const list = this.intake.listOf(message.text);
    if (list) {
      const reply = await this.say(dialogue, `Похоже на список: позиций — ${list.lines}. Отправить его заявкой? Укажите почту или телефон для ответа — менеджер проверит наличие и упаковку и пришлёт счёт.`);
      return this.note(shop, dialogue.id, 'list_offered', { message: message.id, lines: list.lines, reply: reply.id });
    }
    const answer = await this.answers.of(message.text, await this.factsOf(shop, String(guest)));
    if (answer) {
      const reply = await this.say(dialogue, answer.text);
      if (answer.toManager) {
        return this.note(shop, dialogue.id, 'assistant_deferred', { message: message.id, kind: answer.kind, reason: answer.toManager, reply: reply.id });
      }
      return this.note(shop, dialogue.id, 'assistant_answered', { message: message.id, kind: answer.kind, refs: answer.refs, reply: reply.id });
    }
    const last = (await this.journal.forSubject('chat', dialogue.id)).pop();
    const reply = last && last.type === 'assistant_deferred'
      ? null
      : await this.say(dialogue, `Передал вопрос менеджеру — ответ придёт сюда же в рабочее время (${hoursText(shop.hours)}). Сам я сразу отвечаю о наличии и цене позиции, о вашей заявке и о часах работы.`);
    return this.note(shop, dialogue.id, 'assistant_deferred', { message: message.id, reason: 'other', reply: reply ? reply.id : null });
  }

  async say(dialogue, text) {
    return (await this.chatDesk.managerSends(dialogue.id, text, 'assistant')).message;
  }

  async note(shop, dialogueId, type, data, actor = 'assistant') {
    await this.repository.appendEvents([{
      stream: 'chat', scope: shop.id, subjectId: dialogueId, type, data, actor, cause: actor === 'assistant' ? 'auto' : 'manager',
    }]);
  }

  // Магазин и частота: не больше limits.messages сообщений посетителя за окно (П27).
  async shopFor(slug, guest) {
    if (!guest) throw fail('Нет ключа посетителя', 400);
    const shop = await this.desk.shop(slug);
    const key = this.keyOf(shop, guest);
    const now = this.clock().getTime();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.limits.windowMin * 60_000);
    if (recent.length >= this.limits.messages) throw fail('Слишком много сообщений подряд — подождите несколько минут', 429);
    recent.push(now);
    this.hits.set(key, recent);
    return shop;
  }

  // ---------- сторона менеджера: экран «Ассистент» в кабинете ----------

  // Разговоры магазина со сводкой из журнала: сколько ответил сам, сколько ждали менеджера, заявки.
  async dialogues(slug) {
    const shop = await this.desk.shop(slug);
    const prefix = `${shop.id}:`;
    const { dialogues } = await this.chatDesk.board();
    const counts = new Map();
    for (const e of await this.chatEvents(shop)) {
      const c = counts.get(e.subject_id) || { answered: 0, deferred: 0, orders: [] };
      if (e.type === 'assistant_answered') c.answered += 1;
      if (e.type === 'assistant_deferred') c.deferred += 1;
      if (e.type === 'list_sent') c.orders.push(e.data.number);
      counts.set(e.subject_id, c);
    }
    return dialogues
      .filter((d) => d.visitor_key.startsWith(prefix))
      .map((d) => ({ ...d, ...(counts.get(d.id) || { answered: 0, deferred: 0, orders: [] }) }));
  }

  // Сообщения последних разговоров магазина; ответы ассистента помечены по журналу.
  async messages(slug, { dialogues: last = 20 } = {}) {
    const shop = await this.desk.shop(slug);
    const auto = new Map(); // id сообщения-ответа → событие ассистента
    for (const e of await this.chatEvents(shop)) if (e.data.reply && e.actor === 'assistant') auto.set(e.data.reply, e);
    const out = [];
    for (const d of (await this.dialogues(slug)).slice(0, last)) {
      const { messages } = await this.chatDesk.history(d.id);
      for (const m of messages) out.push({ dialogue: d, message: m, auto: auto.get(m.id) || null });
    }
    return out.sort((a, b) => new Date(b.message.created_at) - new Date(a.message.created_at));
  }

  async chatEvents(shop) {
    return (await this.journal.history(shop.id)).filter((e) => e.stream === 'chat');
  }

  // Разговор — только своего магазина: чужой id — «не найден».
  async own(slug, dialogueId) {
    const shop = await this.desk.shop(slug);
    const { dialogue, messages } = await this.chatDesk.history(dialogueId);
    if (!dialogue.visitor_key.startsWith(`${shop.id}:`)) throw fail('Разговор не найден', 404);
    return { shop, dialogue, messages };
  }

  // Черновик модели: персона магазина, квота того, кто нажал; сбой — результат, а не исключение.
  async proposeReply(slug, dialogueId, user) {
    const { shop } = await this.own(slug, dialogueId);
    return this.replyDeskOf(shop, user).proposeReply(dialogueId);
  }

  async reply(slug, dialogueId, text, actor) {
    const { shop } = await this.own(slug, dialogueId);
    const { message } = await this.chatDesk.managerSends(dialogueId, text, actor);
    await this.note(shop, dialogueId, 'manager_replied', { how: 'own', reply: message.id }, actor);
    return message;
  }

  // Отправить черновик как есть или с правкой.
  async approveDraft(slug, dialogueId, draftId, { text, actor }) {
    const { shop } = await this.ownDraft(slug, dialogueId, draftId);
    const edited = Boolean(String(text || '').trim());
    const draft = await this.chatDesk.approveDraft(draftId, { text: edited ? text : undefined, actor });
    await this.note(shop, dialogueId, 'manager_replied', { how: edited ? 'edited' : 'draft', draft: draft.id }, actor);
    return draft;
  }

  async rejectDraft(slug, dialogueId, draftId, actor) {
    await this.ownDraft(slug, dialogueId, draftId);
    return this.chatDesk.rejectDraft(draftId, actor);
  }

  async ownDraft(slug, dialogueId, draftId) {
    const own = await this.own(slug, dialogueId);
    const draft = own.messages.find((m) => m.id === draftId && m.role === 'draft');
    if (!draft) throw fail('Это не черновик — выберите строку «черновик»', 400);
    if (draft.state !== 'open') throw fail('Черновик уже обработан или устарел', 409);
    return own;
  }
}

module.exports = { Assistant };
