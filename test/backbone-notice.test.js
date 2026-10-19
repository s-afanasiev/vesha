const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { SiteIntake } = require('../server/services/backbone/site/SiteIntake');
const { StatusPage } = require('../server/services/backbone/site/StatusPage');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { ShopNotice } = require('../server/services/backbone/receipts/ShopNotice');
const { letterOf } = require('../server/services/backbone/receipts/letter');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');

// Письмо менеджеру о новой заявке и политика ПДн витрины (docs/backbone-handover.md §7).

const SHOP = 'notice-shop';
const LIST = 'Болт М10х50 — 200 шт\nГайка М10 — 200 шт';
const FORM = { name: 'ООО Стройка', contact: 'Buyer@Example.ru', text: LIST, consent: 'on' };

function makeDesk({ replyTo = 'zakaz@shop.test' } = {}) {
  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const sent = [];
  const deadlineOf = () => '17.10 в 15:00';
  const receipts = new Receipts({
    repository,
    journal,
    mailbox: { send: async (m) => { sent.push(m); } },
    statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`,
    deadlineOf,
    notice: new ShopNotice({ cabinetUrl: (slug) => `https://shop.test/experiments/backbone/?shop=${slug}`, deadlineOf, lines: 3 }),
  });
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { [SHOP]: { name: 'Крепёж', niche: 'hardware', replyTo } },
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    statusPage: new StatusPage(),
    receipts,
    privacy: { keepYears: 3, withdrawDays: 30 },
  });
  return { desk, sent };
}

const toShop = (sent) => sent.filter((m) => m.to === 'zakaz@shop.test');

test('a site order gives the buyer a receipt and the shop manager a letter: client, contact, list head, cabinet link', async () => {
  const { desk, sent } = makeDesk();
  const long = [LIST, 'Шайба М10 — 400 шт', 'Саморез 4,2×19 — 3 упак', 'Дюбель 6×40 — 100 шт'].join('\n');
  await desk.receiveFromSite(SHOP, { ...FORM, text: long });
  assert.deepEqual(sent.map((m) => m.to), ['buyer@example.ru', 'zakaz@shop.test']);
  const [manager] = toShop(sent);
  assert.equal(manager.subject, 'Новая заявка №1 — ООО Стройка');
  assert.match(manager.body, /Клиент: ООО Стройка\nКонтакт: buyer@example\.ru/);
  assert.match(manager.body, /Ответить до: 17\.10 в 15:00/);
  assert.match(manager.body, /Список:\nБолт М10х50 — 200 шт\nГайка М10 — 200 шт\nШайба М10 — 400 шт\n… и ещё строк: 2/);
  assert.match(manager.body, /https:\/\/shop\.test\/experiments\/backbone\/\?shop=notice-shop/);
  assert.equal(manager.replyTo, 'buyer@example.ru', 'ответ менеджера уходит клиенту');
  assert.equal(sent[0].replyTo, null, 'ответ клиента — на почту магазина');

  const rows = await desk.receiptsOf(SHOP);
  assert.deepEqual(rows.map((r) => [r.audience, r.kind, r.status]).sort(), [['client', 'received', 'sent'], ['shop', 'received', 'sent']]);
  assert.equal(rows[0].event_id, rows[1].event_id, 'одно событие — два письма');
});

test('the same list again: the manager hears about it with the current column; the buyer gets no second receipt', async () => {
  const { desk, sent } = makeDesk();
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  await desk.moveOrder(SHOP, order.id, 'parse', { actor: 'm' });
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'm' });
  await desk.moveOrder(SHOP, order.id, 'issued', { actor: 'm' });
  const before = sent.filter((m) => m.to === 'buyer@example.ru').length;
  const again = await desk.receiveFromSite(SHOP, FORM);
  assert.equal(again.duplicate, true);
  assert.equal(sent.filter((m) => m.to === 'buyer@example.ru').length, before, 'клиенту — без второй квитанции');
  const letters = toShop(sent);
  assert.equal(letters.length, 2);
  assert.equal(letters[1].subject, 'Заявка №1: тот же список пришёл ещё раз');
  assert.match(letters[1].body, /в колонке «Выдан»/);
  assert.match(letters[1].body, /заказывает повторно/);
});

test('moves and manual orders do not write to the manager; a phone contact gets no Reply-To', async () => {
  const { desk, sent } = makeDesk();
  const manual = await desk.createOrder(SHOP, { client: 'Звонок', contact: '+79001234567', text: 'Болт — 1 шт' }, 'm');
  await desk.moveOrder(SHOP, manual.id, 'parse', { actor: 'm' });
  await desk.sendReceipts(SHOP);
  assert.equal(sent.length, 0, 'заявку вручную завёл сам менеджер');

  await desk.receiveFromSite(SHOP, { ...FORM, contact: '8 (900) 123-45-67' });
  const [manager] = toShop(sent);
  assert.equal(manager.replyTo, null);
  assert.match(manager.body, /Контакт: \+79001234567/);
  assert.doesNotMatch(manager.body, /Ответ на это письмо/);
  const client = (await desk.receiptsOf(SHOP)).find((r) => r.audience === 'client');
  assert.equal(client.status, 'skipped', 'квитанция по телефону — пропущена, как раньше');
});

test('no shop e-mail: the manager letter is skipped with a reason, the buyer receipt still goes', async () => {
  const { desk, sent } = makeDesk({ replyTo: null });
  await desk.receiveFromSite(SHOP, FORM);
  assert.deepEqual(sent.map((m) => m.to), ['buyer@example.ru']);
  const shopRow = (await desk.receiptsOf(SHOP)).find((r) => r.audience === 'shop');
  assert.equal(shopRow.status, 'skipped');
  assert.match(shopRow.last_error, /у магазина нет почты/);
});

test('a failed delivery does not drop the order; retry sends both letters once, a second projection adds nothing', async () => {
  const { desk, sent } = makeDesk();
  let fail = true;
  desk.receipts.mailbox = { send: async (m) => { if (fail) throw new Error('SMTP недоступен'); sent.push(m); } };
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  assert.equal(order.number, 1, 'заявка принята, хотя письма не ушли');
  assert.deepEqual((await desk.receiptsOf(SHOP)).map((r) => r.status), ['failed', 'failed']);
  fail = false;
  assert.deepEqual(await desk.sendReceipts(SHOP), { made: 0, pending: 2, sent: 2 });
  assert.deepEqual(await desk.sendReceipts(SHOP), { made: 0, pending: 0, sent: 0 });
  assert.equal(toShop(sent).length, 1);
});

test('the letter takes its own Reply-To when given, otherwise the shop e-mail; a bad one is refused', () => {
  const shop = { name: 'Крепёж', reply_to: 'zakaz@shop.test' };
  const base = { from: 'noreply@shop.test', to: 'zakaz@shop.test', subject: 'Новая заявка', body: 'x', shop };
  assert.match(letterOf(base).text, /\r\nReply-To: <zakaz@shop\.test>\r\n/);
  assert.match(letterOf({ ...base, replyTo: 'buyer@example.ru' }).text, /\r\nReply-To: <buyer@example\.ru>\r\n/);
  assert.throws(() => letterOf({ ...base, replyTo: 'a@b.ru\r\nBcc: x@y.ru' }), /плохой адрес/);
  const notice = new ShopNotice({ cabinetUrl: () => '', deadlineOf: () => null });
  assert.equal(notice.replyTo('a,b@x.ru'), null, 'адрес, который не пройдёт в заголовок, — без Reply-To, а не сбой письма');
});

test('privacy: the shop name, its e-mail and the terms from the assembly point — no buyer contacts', async () => {
  const { desk } = makeDesk();
  await desk.receiveFromSite(SHOP, FORM);
  const p = await desk.privacyOf(SHOP);
  assert.deepEqual(p, {
    name: 'Крепёж', email: 'zakaz@shop.test', operator: null, missing: ['наименование', 'ИНН', 'ОГРН или ОГРНИП', 'адрес'],
    keepYears: 3, withdrawDays: 30,
  }, 'реквизитов нет — политика неполная; почта для обращений — почта магазина');
  await assert.rejects(desk.privacyOf('nope'), /не найден/);

  const storefront = fs.readFileSync(path.join(__dirname, '..', 'public', 'backbone', 'index.html'), 'utf8');
  assert.match(storefront, /<label class="consent">[\s\S]*id="privacy-link"[\s\S]*<\/label>/, 'ссылка — в галочке согласия');
  assert.match(storefront, /privacy\.html\?shop=\$\{encodeURIComponent\(slug\)\}/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'backbone', 'privacy.html'), 'utf8');
  assert.match(page, /\/api\/backbone-public\/shops\/\$\{encodeURIComponent\(slug\)\}\/privacy/);
});

// ---------- Postgres: витрина → квитанция и письмо менеджеру, страница политики ----------

test('postgres: a storefront order gives two letters by one projection; privacy is public per shop', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['024_backbone_shop_notice.sql']);
    if (!rows.length) return t.skip('миграция 024 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const { backboneDesk } = require('../server/services/backbone');
  const config = require('../server/config');
  const slug = `t-notice-${Date.now().toString(36)}`;
  await backboneDesk.openShop({ slug, name: 'Магазин писем', niche: 'hardware', days: 'пн-пт', time: '9-18', email: 'zakaz@notice.test' }, 'test');
  const app = express();
  app.use('/api/backbone-public', require('../server/routes/backbonePublic'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/backbone-public`;
  try {
    const privacy = await (await fetch(`${base}/shops/${slug}/privacy`)).json();
    assert.deepEqual([privacy.name, privacy.email, privacy.keepYears, privacy.withdrawDays], ['Магазин писем', 'zakaz@notice.test', 3, 30]);
    assert.equal((await fetch(`${base}/shops/nope-${slug}/privacy`)).status, 404);

    const form = new FormData();
    for (const [k, v] of Object.entries({ ...FORM, contact: 'buyer@notice.test' })) form.set(k, v);
    const posted = await (await fetch(`${base}/shops/${slug}/orders`, { method: 'POST', body: form })).json();
    assert.equal(posted.number, 1, posted.error);
    const rows = await backboneDesk.receiptsOf(slug);
    assert.deepEqual(rows.map((r) => [r.audience, r.address, r.status]).sort(), [
      ['client', 'buyer@notice.test', 'sent'], ['shop', 'zakaz@notice.test', 'sent'],
    ]);
    assert.equal(rows.find((r) => r.audience === 'shop').reply_to, 'buyer@notice.test');
    assert.deepEqual(await backboneDesk.sendReceipts(slug), { made: 0, pending: 0, sent: 0 }, 'повтор проекции — без дублей');
  } finally {
    server.close();
    fs.rmSync(path.join(config.backboneMailDir, slug), { recursive: true, force: true });
    const { rows: [shop] } = await db.query('SELECT id FROM backbone_shops WHERE slug = $1', [slug]);
    if (shop) {
      await db.query('DELETE FROM journal_events WHERE scope = $1', [shop.id]);
      await db.query('DELETE FROM backbone_shops WHERE id = $1', [shop.id]);
    }
  }
});
