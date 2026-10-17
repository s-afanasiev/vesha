const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { SiteIntake, contactOf } = require('../server/services/backbone/site/SiteIntake');
const { StatusPage } = require('../server/services/backbone/site/StatusPage');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { WorkingHours } = require('../server/services/backbone/measures/WorkingHours');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');

const SHOP = 'site-shop';
const HOURS = { tz: 'Europe/Moscow', days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' };
const LIST = 'Болт М10х50 — 200 шт\nГайка М10 — 200 шт';
const FORM = { name: 'ООО Стройка', contact: 'Buyer@Example.ru', text: LIST, consent: 'on' };

function makeDesk() {
  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const sent = [];
  const receipts = new Receipts({
    repository,
    journal,
    mailbox: { send: async (m) => { sent.push(m); } },
    statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`,
    deadlineOf: () => '17.10 в 15:00',
  });
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { [SHOP]: { name: 'Крепёж', niche: 'hardware' } },
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    statusPage: new StatusPage(),
    receipts,
  });
  return { desk, journal, repository, sent };
}

// ---------- рабочее время: «ответим до …» ----------

test('deadline counts working minutes: evening and weekend move the promise to the next working day', () => {
  const wh = new WorkingHours(HOURS);
  const msk = (iso) => new Date(`${iso}+03:00`).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(iso(wh.deadline(msk('2026-10-16T14:00:00'), 60)), iso(msk('2026-10-16T15:00:00'))); // пятница днём
  assert.equal(iso(wh.deadline(msk('2026-10-16T18:30:00'), 60)), iso(msk('2026-10-17T09:30:00'))); // пятница вечером → суббота
  assert.equal(iso(wh.deadline(msk('2026-10-17T22:00:00'), 60)), iso(msk('2026-10-19T10:00:00'))); // суббота ночью → понедельник
});

// ---------- SiteIntake: форма витрины ----------

test('site intake: consent, contact and a list are required; phones are normalized; robots are refused', async () => {
  const intake = new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }));
  await assert.rejects(intake.read({ ...FORM, consent: '' }), /согласие/);
  await assert.rejects(intake.read({ ...FORM, contact: 'позвоните' }), /почту или телефон/);
  await assert.rejects(intake.read({ ...FORM, text: '  ' }), /Пришлите список/);
  await assert.rejects(intake.read({ ...FORM, website: 'http://spam' }), /не принята/);
  assert.deepEqual(contactOf('8 (900) 123-45-67'), { kind: 'phone', value: '+79001234567' });
  assert.deepEqual(contactOf('Buyer@Example.ru'), { kind: 'email', value: 'buyer@example.ru' });
  const read = await intake.read({ ...FORM, name: '' });
  assert.equal(read.draft.client, 'buyer@example.ru', 'без имени клиент — его контакт');
  assert.equal(read.draft.channel, 'site');
});

test('site intake: the same list with different spacing is the same content key; a scan is accepted with a named refusal', async () => {
  const intake = new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }));
  const a = await intake.read(FORM);
  const b = await intake.read({ ...FORM, text: `  болт м10х50 — 200 шт \n\n ГАЙКА м10 — 200 шт` });
  assert.equal(a.contentKey, b.contentKey);
  const c = await intake.read({ ...FORM, contact: 'other@example.ru' });
  assert.notEqual(a.contentKey, c.contentKey);
  const scan = await intake.read({ ...FORM, text: '' }, { name: 'список.jpg', data: Buffer.from('jpeg') });
  assert.equal(scan.refusal.code, 'scan');
  assert.match(scan.draft.text, /список\.jpg/);
  await assert.rejects(intake.read({ ...FORM, text: '' }, { name: 'список.docx', data: Buffer.from('x') }), /не разбираем/);
});

// ---------- дверь: заявка с сайта, дубль, квитанции, окно статуса ----------

test('a site order lands in the inbox with a status link, a received event and a receipt letter', async () => {
  const { desk, journal, sent } = makeDesk();
  const { order, duplicate } = await desk.receiveFromSite(SHOP, FORM);
  assert.equal(duplicate, false);
  assert.equal(order.column_id, 'new');
  assert.equal(order.channel, 'site');
  assert.ok(order.status_token && order.status_token.length >= 20);
  assert.ok(order.consent_at);
  const [received] = await journal.forSubject('order', order.id);
  assert.equal(received.type, 'received');
  assert.equal(received.data.channel, 'site');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'buyer@example.ru');
  assert.match(sent[0].subject, /Заявка №1 получена/);
  assert.match(sent[0].body, /Ответим до 17\.10 в 15:00/);
  assert.match(sent[0].body, new RegExp(`status\\.html\\?t=${order.status_token}`));
});

test('the same list from the same contact is one order: received_again, no second receipt', async () => {
  const { desk, journal, sent } = makeDesk();
  const first = await desk.receiveFromSite(SHOP, FORM);
  const again = await desk.receiveFromSite(SHOP, { ...FORM, text: LIST.toUpperCase() });
  assert.equal(again.duplicate, true);
  assert.equal(again.order.id, first.order.id);
  assert.equal((await desk.orders(SHOP)).length, 1);
  assert.deepEqual((await journal.forSubject('order', first.order.id)).map((e) => e.type), ['received', 'received_again']);
  assert.equal(sent.length, 1);
});

test('receipts follow type changes only; a phone contact gets a skipped receipt, not silence', async () => {
  const { desk, repository, sent } = makeDesk();
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  await desk.moveOrder(SHOP, order.id, 'parse', { actor: 'm' });     // inbox → working: молчим
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'm' });   // working → waiting_client: пишем
  await desk.moveOrder(SHOP, order.id, 'ask', { actor: 'm' });       // waiting → waiting: молчим
  await desk.moveOrder(SHOP, order.id, 'issued', { actor: 'm' });    // → done: пишем
  assert.deepEqual(sent.map((m) => m.subject.replace(/ —.*$/, '')), [
    'Заявка №1 получена', 'Заявка №1: ждём вашего ответа', 'Заявка №1 готова',
  ]);
  assert.match(sent[1].body, /«Счёт отправлен»/);

  const phone = await desk.receiveFromSite(SHOP, { ...FORM, contact: '+7 900 123-45-67', text: 'Шайба М8 — 100 шт' });
  const rows = (await desk.receiptsOf(SHOP)).filter((r) => r.order_id === phone.order.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'skipped');
  assert.match(rows[0].last_error, /нет почты/);
  assert.equal(sent.length, 3, 'по телефону письмо не уходит');
  assert.equal((await repository.receiptsCursor((await desk.shop(SHOP)).id)) > 0, true);
});

test('a failed letter is retried and marked; the transition itself is not rolled back', async () => {
  const { desk, sent } = makeDesk();
  let fail = true;
  desk.receipts.mailbox = { send: async (m) => { if (fail) throw new Error('SMTP недоступен'); sent.push(m); } };
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  assert.equal(order.number, 1, 'заявка принята, хотя письмо не ушло');
  let [r] = await desk.receiptsOf(SHOP);
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 1);
  fail = false;
  const result = await desk.sendReceipts(SHOP);
  assert.deepEqual([result.made, result.sent], [0, 1]);
  [r] = await desk.receiptsOf(SHOP);
  assert.equal(r.status, 'sent');
});

test('status window shows typed steps with dates and the column as a note — never contacts or text', async () => {
  const { desk } = makeDesk();
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  await desk.moveOrder(SHOP, order.id, 'parse', { actor: 'm' });
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'm' });
  const view = await desk.statusOf(order.status_token);
  assert.equal(view.title, 'Заявка №1');
  assert.deepEqual(view.steps.map((s) => [s.name, s.state]), [
    ['Заявка получена', 'done'], ['В работе', 'done'], ['Ждём вашего ответа', 'current'], ['Готово', 'next'],
  ]);
  assert.equal(view.steps[2].note, 'Счёт отправлен');
  assert.ok(view.steps[0].at && view.steps[2].at);
  assert.equal(view.exit, null);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('buyer@example.ru') && !json.includes('Болт'), 'окно не показывает контакт и текст');

  await desk.moveOrder(SHOP, order.id, 'refused', { actor: 'm' });
  const closed = await desk.statusOf(order.status_token);
  assert.equal(closed.exit.tone, 'refused');
  await assert.rejects(desk.statusOf('nope'), /не найдена/);
});

// ---------- публичный маршрут: каталог без базы, отказ формы до базы, частота ----------

test('public storefront: catalog search, form refused before the database, rate limit per address', async () => {
  const app = express();
  app.set('trust proxy', false);
  app.use(express.json());
  app.use('/api/backbone-public', require('../server/routes/backbonePublic'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/backbone-public`;
  try {
    const shop = await (await fetch(`${base}/shops/demo-krepezh`)).json();
    assert.ok(shop.name && shop.groups.length > 5);
    assert.equal((await fetch(`${base}/shops/nope`)).status, 404);
    const cat = await (await fetch(`${base}/shops/demo-krepezh/catalog?q=${encodeURIComponent('м10х50')}`)).json();
    assert.ok(cat.items.some((i) => i.sku === 'B933-10x50-ZN'));
    assert.ok(cat.items.every((i) => i.stock === undefined && typeof i.inStock === 'boolean'), 'остаток наружу — только «есть / нет»');

    const post = (body) => fetch(`${base}/shops/demo-krepezh/orders`, { method: 'POST', body });
    const noConsent = new FormData();
    noConsent.set('contact', 'a@b.ru');
    noConsent.set('text', 'Болт — 1 шт');
    const refused = await post(noConsent);
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /согласие/);
    let last;
    for (let i = 0; i < 6; i++) last = await post(noConsent);
    assert.equal(last.status, 429, 'шестая отправка подряд с одного адреса — отказ по частоте');
  } finally {
    server.close();
  }
});
