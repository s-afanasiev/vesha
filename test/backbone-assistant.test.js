const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { SiteIntake, contentKey } = require('../server/services/backbone/site/SiteIntake');
const { StatusPage } = require('../server/services/backbone/site/StatusPage');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { WorkingHours } = require('../server/services/backbone/measures/WorkingHours');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');
const { RuleLines } = require('../server/services/backbone/invoice/Lines');
const { Match } = require('../server/services/backbone/invoice/Match');
const { Catalogs, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { ChatDesk } = require('../server/services/chat-engine/ChatDesk');
const { ReplySuggester } = require('../server/services/chat-engine/ReplySuggester');
const { Funnel } = require('../server/services/chat-engine/Funnel');
const { Assistant } = require('../server/services/backbone/assistant/Assistant');
const { ShopFacts } = require('../server/services/backbone/assistant/ShopFacts');
const { AutoAnswers, StatusAnswer, HoursAnswer, StockAnswer } = require('../server/services/backbone/assistant/AutoAnswers');
const { ChatIntake } = require('../server/services/backbone/assistant/ChatIntake');
const { ShopPersona, replyModel, withoutContacts } = require('../server/services/backbone/assistant/ShopPersona');
const { MemoryDialogues } = require('../server/services/backbone/assistant/MemoryDialogues');
const { Measures } = require('../server/services/backbone/measures/Measures');

const SHOP = 'chat-shop';
const FIXTURE = path.join(__dirname, '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv');
const LIST = 'Болт М10х50 — 200 шт\nГайка М10 — 200 шт';
const msk = (iso) => new Date(`${iso}+03:00`);

// Костяк в памяти: магазин с каталогом-фикстурой, витрина, квитанции, ассистент.
function makeShop({ now = msk('2026-10-16T12:00:00'), model = null } = {}) {
  let clockNow = now;
  const clock = () => clockNow;
  const journal = new MemoryJournal({ clock });
  const repository = new MemoryRepository(journal);
  const sent = [];
  const receipts = new Receipts({
    repository, journal,
    mailbox: { send: async (m) => { sent.push(m); } },
    statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`,
    deadlineOf: () => '16.10 в 13:00',
  });
  const catalogs = new Catalogs({
    repository,
    indexOf: () => new CatalogIndex({ attributes: hardwareAttributes }),
    fixtureOf: () => new CsvFeed(FIXTURE),
  });
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: {
      [SHOP]: { name: 'Крепёж у дома', niche: 'hardware', hours: { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' } },
      'other-shop': { name: 'Другой', niche: 'hardware' },
    },
    catalogs,
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    statusPage: new StatusPage(),
    receipts,
    clock,
  });
  const dialogues = new MemoryDialogues({ clock });
  const funnel = new Funnel();
  const seen = []; // что ушло модели черновика
  const llm = model || { forActor: () => ({ complete: async (messages) => { seen.push(messages); return { text: 'Здравствуйте! Доставку по городу обсудим — уточните адрес объекта.' }; } }) };
  const statusPath = (t) => `/backbone/status.html?t=${t}`;
  const assistant = new Assistant({
    desk,
    chatDesk: new ChatDesk({ repository: dialogues, suggester: null, funnel }),
    replyDeskOf: (shop, user) => new ChatDesk({
      repository: dialogues,
      suggester: new ReplySuggester({ repository: new ShopPersona(dialogues, shop), completeChat: replyModel(llm, user), funnel }),
      funnel,
    }),
    factsOf: async (shop, clientKey) => {
      const catalog = await catalogs.of(shop);
      return new ShopFacts({
        shop, catalog,
        match: new Match(catalog.index, { defaultCoating: 'zn' }),
        orders: () => desk.clientOrders(shop.slug, clientKey),
        hours: new WorkingHours({ tz: shop.tz || 'Europe/Moscow', ...(shop.hours || {}) }),
        clock,
      });
    },
    answers: new AutoAnswers([new StatusAnswer({ statusPath }), new HoursAnswer(), new StockAnswer({ limit: 5 })]),
    intake: new ChatIntake(new RuleLines()),
    repository, journal, statusPath,
    limits: { messages: 30, windowMin: 10 },
    clock,
  });
  return { desk, assistant, journal, repository, dialogues, sent, seen, setNow: (d) => { clockNow = d; } };
}

const lastShopText = (talk) => [...talk.messages].reverse().find((m) => !m.mine).text;
const chatEvents = (journal) => journal.events.filter((e) => e.stream === 'chat');

// ---------- автоответ: наличие и цена из каталога магазина ----------

test('assistant: «есть ли М10х50?» — price and availability from the shop catalog, every number with its article', async () => {
  const { assistant, journal } = makeShop();
  const talk = await assistant.hear(SHOP, 'guest-a', { text: 'Есть ли М10х50?' });
  const reply = lastShopText(talk);
  assert.match(reply, /Болт DIN 933 М10×50 кл\. 8\.8 оцинк\. — 5,52 ₽ за шт, упаковка 25 шт, в наличии \(арт\. B933-10x50-ZN\)/);
  assert.match(reply, /нерж\. A2 — 17,85 ₽ за шт.*\(арт\. B933-10x50-A2\)/);
  assert.doesNotMatch(reply, /375|175/, 'остаток наружу — только «есть / нет», как на витрине');
  assert.doesNotMatch(reply, /М10×40|М10×60/, 'другие длины противоречат размеру — их нет');
  const [e] = chatEvents(journal);
  assert.equal(e.type, 'assistant_answered');
  assert.equal(e.data.kind, 'stock');
  assert.deepEqual(e.data.refs.map((r) => r.sku), ['B933-10x50-ZN', 'B933-10x50-A2', 'DP-10x50'], 'дюбель 10×50 без резьбы — после болтов М10×50');

  const coated = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'почём болт м10х50 нержавейка?' }));
  assert.match(coated, /B933-10x50-A2/);
  assert.doesNotMatch(coated, /B933-10x50-ZN/, 'названное покрытие отсекает оцинковку');

  const none = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'есть болт М99х999?' }));
  assert.match(none, /не нашёл/);
  assert.equal(chatEvents(journal).pop().data.reason, 'not_in_catalog');
});

// ---------- автоответ: статус заявки — только своему клиенту (О20) ----------

test('assistant: «где заявка 1?» — only to its own client; a foreign or missing number is indistinguishable', async () => {
  const { desk, assistant } = makeShop();
  const mine = await desk.receiveFromSite(SHOP, { contact: 'a@client.test', text: LIST, consent: 'on' }, null, { clientKey: 'guest-a' });
  const theirs = await desk.receiveFromSite(SHOP, { contact: 'b@client.test', text: 'Шайба М10 — 100 шт', consent: 'on' }, null, { clientKey: 'guest-b' });
  assert.deepEqual([mine.order.number, theirs.order.number], [1, 2]);

  const own = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'Где заявка 1?' }));
  assert.match(own, /Заявка №1 — «Заявка получена»/);
  assert.ok(own.includes(`/backbone/status.html?t=${mine.order.status_token}`), 'ссылка на окно статуса своей заявки');

  const foreign = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'где заявка 2?' }));
  const missing = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'где заявка 42?' }));
  assert.match(foreign, /Заявку №2 среди ваших не вижу/);
  assert.ok(!foreign.includes(theirs.order.status_token), 'чужая ссылка не утекает');
  assert.equal(foreign.replace('№2', '№N'), missing.replace('№42', '№N'), 'чужая и несуществующая — один и тот же ответ');

  const list = lastShopText(await assistant.hear(SHOP, 'guest-b', { text: 'что с моей заявкой?' }));
  assert.match(list, /Ваша заявка:\n• Заявка №2/);
  assert.doesNotMatch(list, /№1/);
  assert.match(lastShopText(await assistant.hear(SHOP, 'guest-c', { text: 'где моя заявка?' })), /Ваших заявок пока не вижу/);
  assert.deepEqual(await desk.clientOrders(SHOP, null), [], 'без ключа клиента — никаких заявок');
});

test('assistant: status follows the board — the client sees the step, not who moved it', async () => {
  const { desk, assistant } = makeShop();
  const { order } = await desk.receiveFromSite(SHOP, { contact: 'a@client.test', text: LIST, consent: 'on' }, null, { clientKey: 'guest-a' });
  const columns = await desk.columns(SHOP);
  await desk.moveOrder(SHOP, order.id, columns.find((c) => c.type === 'waiting_client').id, { actor: 'manager' });
  const reply = lastShopText(await assistant.hear(SHOP, 'guest-a', { text: 'статус заказа №1' }));
  assert.match(reply, /Заявка №1 — «Ждём вашего ответа» \(Вопрос клиенту\), с 16\.10 в 12:00/);
});

// ---------- автоответ: часы работы ----------

test('assistant: working hours from the shop description — open now or when it opens', async () => {
  const { assistant, setNow } = makeShop({ now: msk('2026-10-16T12:00:00') }); // пятница
  assert.match(lastShopText(await assistant.hear(SHOP, 'guest-h', { text: 'Во сколько вы работаете?' })), /Работаем пн–сб 09:00–19:00 \(время московское\)\. Сейчас открыто/);
  setNow(msk('2026-10-17T20:00:00')); // суббота вечером
  assert.match(lastShopText(await assistant.hear(SHOP, 'guest-h', { text: 'работаете в воскресенье?' })), /Сейчас закрыто, откроемся 19\.10 в 09:00/);
});

// ---------- ChatIntake: список из разговора — та же заявка, что с сайта ----------

test('chat intake: a list is recognised by the same rules as the invoice; questions are not lists', () => {
  const intake = new ChatIntake(new RuleLines());
  assert.equal(intake.listOf('есть ли М10х50?'), null);
  assert.equal(intake.listOf('где заявка 42?'), null);
  assert.deepEqual(intake.listOf('Болт М10х50 — 200 шт'), { lines: 1 });
  assert.deepEqual(intake.listOf(`Мне нужно:\n${LIST}`), { lines: 2 });
  assert.throws(() => intake.read({ contact: 'a@client.test' }, LIST), /согласие/);
  assert.throws(() => intake.read({ contact: 'позвоните', consent: 'on' }, LIST), /почту или телефон/);
  const read = intake.read({ contact: 'A@Client.test', consent: 'on' }, `Мне нужно:\n${LIST}`);
  assert.equal(read.draft.channel, 'chat');
  assert.equal(read.contentKey, contentKey('a@client.test', LIST), 'вступление «Мне нужно:» не меняет ключ');
});

test('assistant: the same list on the site and in the chat is one order; the second channel is received_again', async () => {
  const { desk, assistant, journal, repository, sent } = makeShop();
  const site = await desk.receiveFromSite(SHOP, { contact: 'buyer@client.test', text: LIST, consent: 'on' }, null, { clientKey: 'guest-a' });

  const offered = await assistant.hear(SHOP, 'guest-z', { text: `Здравствуйте! Нужно:\n${LIST}` });
  assert.match(lastShopText(offered), /Похоже на список: позиций — 2\. Отправить его заявкой\?/);
  assert.ok(offered.offer, 'виджет показывает форму «отправить заявкой»');
  await assert.rejects(assistant.sendList(SHOP, 'guest-z', { message: offered.offer.message, contact: 'buyer@client.test' }), /согласие/);
  await assert.rejects(assistant.sendList(SHOP, 'guest-other', { message: offered.offer.message, contact: 'x@y.test', consent: 'on' }), /не найдено/);

  const r = await assistant.sendList(SHOP, 'guest-z', { message: offered.offer.message, contact: 'Buyer@Client.test', consent: 'on' });
  assert.deepEqual([r.number, r.duplicate], [site.order.number, true]);
  assert.equal((await repository.orders((await desk.shop(SHOP)).id)).length, 1, 'одна заявка, не дубль');
  const again = journal.events.find((e) => e.type === 'received_again');
  assert.equal(again.data.channel, 'chat');
  assert.match(lastShopText(await assistant.conversation(SHOP, 'guest-z')), /уже у нас — заявка №1/);
  assert.equal((await assistant.conversation(SHOP, 'guest-z')).offer, null, 'отправленный список больше не предлагается');

  // новый список из чата — новая заявка, квитанция на почту, клиент чата видит её статус
  const fresh = await assistant.hear(SHOP, 'guest-z', { text: 'Шайба DIN 125 М10 — 300 шт\nГайка М8 — 100 шт' });
  const made = await assistant.sendList(SHOP, 'guest-z', { message: fresh.offer.message, contact: 'z@client.test', consent: 'on', name: 'ИП Зуев' });
  assert.deepEqual([made.number, made.duplicate], [2, false]);
  const received = journal.events.find((e) => e.type === 'received' && e.data.channel === 'chat');
  assert.equal(received.data.number, 2);
  assert.ok(sent.some((m) => m.to === 'z@client.test' && /Заявка №2 получена/.test(m.subject)), 'квитанция «получено» — и заявке из чата');
  assert.match(lastShopText(await assistant.hear(SHOP, 'guest-z', { text: 'где заявка 2?' })), /Заявка №2 — «Заявка получена»/);

  // обратный порядок: сначала чат, потом тот же список с сайта — та же заявка
  const back = await desk.receiveFromSite(SHOP, { contact: 'z@client.test', text: 'шайба din 125 м10 — 300 шт\nгайка м8 — 100 шт', consent: 'on' });
  assert.deepEqual([back.order.number, back.duplicate], [2, true]);
});

// ---------- остальное — менеджеру: черновик модели без контактов ----------

test('assistant: other questions wait for the manager; the draft prompt carries the shop persona and no contacts', async () => {
  const { assistant, journal, seen } = makeShop();
  const first = await assistant.hear(SHOP, 'guest-d', { text: 'Привезёте на объект? Мой телефон +7 (900) 123-45-67, почта ivan@stroy.test' });
  assert.match(lastShopText(first), /Передал вопрос менеджеру/);
  const second = await assistant.hear(SHOP, 'guest-d', { text: 'Объект за городом, 15 км' });
  assert.equal(second.messages.filter((m) => !m.mine).length, 1, 'уведомление — один раз на серию вопросов');
  assert.deepEqual(chatEvents(journal).map((e) => e.type), ['assistant_deferred', 'assistant_deferred']);

  const [d] = await assistant.dialogues(SHOP);
  assert.equal(d.deferred, 2);
  const proposed = await assistant.proposeReply(SHOP, d.id, { email: 'manager@shop.test' });
  assert.equal(proposed.ok, true);
  const prompt = JSON.stringify(seen[0]);
  assert.match(prompt, /магазина «Крепёж у дома»/);
  assert.match(prompt, /\[телефон\].*\[почта\]/);
  assert.doesNotMatch(prompt, /900|ivan@stroy/);
  assert.equal((await assistant.conversation(SHOP, 'guest-d')).messages.length, 3, 'черновик посетителю не виден');

  await assistant.approveDraft(SHOP, d.id, proposed.draft.id, { text: '', actor: 'manager@shop.test' });
  assert.match(lastShopText(await assistant.conversation(SHOP, 'guest-d')), /Доставку по городу обсудим/);
  assert.deepEqual(chatEvents(journal).pop().data.how, 'draft');
  await assert.rejects(assistant.approveDraft(SHOP, d.id, proposed.draft.id, { actor: 'manager@shop.test' }), /уже обработан/);
});

test('assistant: a dialogue of another shop is not found; the visitor rate is limited', async () => {
  const { assistant } = makeShop();
  await assistant.hear('other-shop', 'guest-o', { text: 'есть ли гайка м10?' });
  const [foreign] = await assistant.dialogues('other-shop');
  assert.deepEqual(await assistant.dialogues(SHOP), []);
  await assert.rejects(assistant.reply(SHOP, foreign.id, 'привет', 'manager'), /не найден/);

  const { assistant: busy } = makeShop();
  busy.limits = { messages: 2, windowMin: 10 };
  await busy.hear(SHOP, 'guest-r', { text: 'часы работы?' });
  await busy.hear(SHOP, 'guest-r', { text: 'часы работы?' });
  await assert.rejects(busy.hear(SHOP, 'guest-r', { text: 'часы работы?' }), (err) => err.status === 429);
});

test('measures: the share of chat questions the assistant answered without the manager comes from the journal', async () => {
  const { assistant, journal } = makeShop();
  await assistant.hear(SHOP, 'guest-m', { text: 'есть ли М10х50?' });
  await assistant.hear(SHOP, 'guest-m', { text: 'часы работы?' });
  await assistant.hear(SHOP, 'guest-m', { text: 'а скидку дадите?' });
  await assistant.hear(SHOP, 'guest-m', { text: `Мне нужно:
${LIST}` }); // предложение заявки — не вопрос
  const measures = new Measures(new WorkingHours(), {});
  const { assistant: a } = measures.report(journal.events, { now: Date.now(), mode: 'shadow' });
  assert.deepEqual(a.shadow, { auto: 2, manager: 1, share: 2 / 3 });
  assert.deepEqual(a.help, { auto: 0, manager: 0, share: null });
});

test('without contacts: phones and e-mails are cut, sizes and quantities stay', () => {
  assert.equal(withoutContacts('звоните 8 900 123-45-67 или +79001234567'), 'звоните [телефон] или [телефон]');
  assert.equal(withoutContacts('почта: Snab@Stroy-Kursk.ru'), 'почта: [почта]');
  assert.equal(withoutContacts('Болт М10х50 — 2 000 шт, саморез 4,2х19 — 1000 шт'), 'Болт М10х50 — 2 000 шт, саморез 4,2х19 — 1000 шт');
});

// ---------- Postgres: публичные ручки ассистента на каталоге выгрузки магазина ----------

test('postgres: assistant answers from the shop\'s uploaded catalog; one order for the same list from site and chat', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['026_backbone_assistant.sql']);
    if (!rows.length) return t.skip('миграция 026 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const { backboneDesk } = require('../server/services/backbone');
  const slug = `t-asst-${Date.now().toString(36)}`;
  const shop = await backboneDesk.openShop({ slug, name: 'Тест ассистента', niche: 'hardware' }, 'test');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.guest = req.get('x-guest') ? { id: req.get('x-guest') } : null; next(); });
  app.use('/api/backbone-public', require('../server/routes/backbonePublic'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/backbone-public/shops/${slug}`;
  const call = async (p, guest, body) => {
    const init = { method: body ? 'POST' : 'GET', headers: { 'x-guest': guest } };
    if (body instanceof FormData) init.body = body;
    else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, init);
    return { ...(await r.json()), code: r.status };
  };
  const guestA = `ga-${Date.now()}`;
  const guestB = `gb-${Date.now()}`;
  try {
    // каталог магазина — его выгрузка (версия 1), а не фикстура демо
    await db.query(`INSERT INTO backbone_catalog_items (shop_id, sku, name, item_group, unit, pack, price, stock, position) VALUES
      ($1, 'KK-B10x50', 'Болт DIN 933 М10×50 кл. 8.8 оцинк.', 'Болты', 'шт', 25, 15.40, 1200, 1),
      ($1, 'KK-B10x50-A2', 'Болт DIN 933 М10×50 нерж. A2', 'Болты', 'шт', 25, 31.00, 0, 2)`, [shop.id]);
    await db.query('UPDATE backbone_shops SET catalog_version = 1 WHERE id = $1', [shop.id]);

    const stock = await call('/assistant/messages', guestA, { text: 'есть ли М10х50?' });
    assert.equal(stock.code, 200, stock.error);
    const answer = stock.messages[stock.messages.length - 1].text;
    assert.match(answer, /15,40 ₽ за шт.*в наличии \(арт\. KK-B10x50\)/);
    assert.match(answer, /31,00 ₽ за шт.*под заказ \(арт\. KK-B10x50-A2\)/);

    const form = new FormData();
    form.set('contact', 'buyer@pg.test'); form.set('text', LIST); form.set('consent', 'on');
    const site = await call('/orders', guestA, form);
    assert.equal(site.code, 200, site.error);

    const offered = await call('/assistant/messages', guestB, { text: `Мне нужно:\n${LIST}` });
    assert.ok(offered.offer);
    const chat = await call('/assistant/orders', guestB, { message: offered.offer.message, contact: 'buyer@pg.test', consent: 'on' });
    assert.deepEqual([chat.number, chat.duplicate], [site.number, true]);
    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM backbone_orders WHERE shop_id = $1', [shop.id]);
    assert.equal(n, 1);

    const foreign = await call('/assistant/messages', guestB, { text: `где заявка ${site.number}?` });
    assert.match(foreign.messages[foreign.messages.length - 1].text, /среди ваших не вижу/);
    const own = await call('/assistant/messages', guestA, { text: `где заявка ${site.number}?` });
    assert.match(own.messages[own.messages.length - 1].text, new RegExp(`Заявка №${site.number} — «Заявка получена»`));
  } finally {
    server.close();
    await db.query('DELETE FROM chat_engine_dialogues WHERE visitor_key LIKE $1', [`${shop.id}:%`]);
    await db.query('DELETE FROM journal_events WHERE scope = $1', [shop.id]);
    await db.query('DELETE FROM backbone_shops WHERE id = $1', [shop.id]);
  }
});
