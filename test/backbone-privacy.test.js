// Костяк: два блокера 152-ФЗ перед первым живым покупателем (docs/backbone-handover.md §6–7).
// Реквизиты оператора в политике ПДн: заводятся в форме магазина, ИНН и ОГРН проверяются до
// базы, политика показывает блок «Оператор», без реквизитов кабинет пишет «неполная».
// Удаление данных покупателя — по запросу и по сроку хранения одним узлом (Erasure): после
// него ни в одном хранилище нет имени, контакта, текста и файла заявки, а номер, позиции,
// суммы и события журнала (без ПДн) — на месте.

// до чтения config: письма-файлы — в свою папку (их тоже проверяем после удаления)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.BACKBONE_MAIL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backbone-pdn-mail-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf, TEMPLATES } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { ShopForm } = require('../server/services/backbone/shops/ShopForm');
const { SiteIntake } = require('../server/services/backbone/site/SiteIntake');
const { StatusPage } = require('../server/services/backbone/site/StatusPage');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { ShopNotice } = require('../server/services/backbone/receipts/ShopNotice');
const { FileMailbox } = require('../server/services/backbone/receipts/FileMailbox');
const { Catalog, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { OrderToInvoice } = require('../server/services/backbone/invoice/OrderToInvoice');
const { InvoiceDraft } = require('../server/services/backbone/invoice/InvoiceDraft');
const { StockCheck } = require('../server/services/backbone/invoice/StockCheck');
const { Match, Matches } = require('../server/services/backbone/invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('../server/services/backbone/invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');
const { zip } = require('../server/services/backbone/invoice/zip');
const { ChatDesk } = require('../server/services/chat-engine/ChatDesk');
const { Funnel } = require('../server/services/chat-engine/Funnel');
const { Assistant, visitorKey } = require('../server/services/backbone/assistant/Assistant');
const { ShopFacts } = require('../server/services/backbone/assistant/ShopFacts');
const { AutoAnswers, StatusAnswer, HoursAnswer, StockAnswer } = require('../server/services/backbone/assistant/AutoAnswers');
const { ChatIntake } = require('../server/services/backbone/assistant/ChatIntake');
const { MemoryDialogues } = require('../server/services/backbone/assistant/MemoryDialogues');
const { WorkingHours } = require('../server/services/backbone/measures/WorkingHours');
const { checkInn, checkOgrn, operatorOf, missingOf } = require('../server/services/backbone/privacy/Requisites');
const { Anonymizer, contactKey, findsOrder } = require('../server/services/backbone/privacy/Anonymizer');
const { Erasure, Retention } = require('../server/services/backbone/privacy/Erasure');
const { Components } = require('../server/components');
const { Table } = require('../server/components/table');

const SHOP = 'pdn-shop';
const msk = (local) => new Date(`${local}+03:00`);
const OPERATOR = { operator: 'ООО «Метиз-Центр»', inn: '7707083893', ogrn: '1027700132195', address: '305000, г. Курск, ул. Ленина, д. 1' };

// ---------- реквизиты оператора ----------

test('requisites: INN and OGRN are checked by length and check digit before the database, of one kind', () => {
  assert.equal(checkInn('7707083893'), '7707083893', 'ИНН организации');
  assert.equal(checkInn('5001 0073 2259'), '500100732259', 'ИНН ИП, пробелы не в счёт');
  assert.throws(() => checkInn('7707083894'), /контрольная цифра/);
  assert.throws(() => checkInn('500100732258'), /контрольная цифра/);
  assert.throws(() => checkInn('77070838'), /10 цифр у организации или 12 у ИП/);
  assert.equal(checkOgrn('1027700132195'), '1027700132195', 'ОГРН');
  assert.equal(checkOgrn('304500116000157'), '304500116000157', 'ОГРНИП');
  assert.throws(() => checkOgrn('1027700132196'), /ОГРН 1027700132196: не сходится контрольная цифра/);
  assert.throws(() => checkOgrn('304500116000158'), /ОГРНИП 304500116000158: не сходится/);
  assert.throws(() => checkOgrn('12345'), /13 цифр \(ОГРН\) или 15 \(ОГРНИП\)/);
  assert.throws(() => operatorOf({ inn: '7707083893', ogrn: '304500116000157' }), /разного рода/);
  assert.throws(() => operatorOf({ inn: '500100732259', ogrn: '1027700132195' }), /разного рода/);
  assert.throws(() => operatorOf({ address: 'Курск' }), /Адрес оператора: от 10/);
  assert.throws(() => operatorOf({ pdEmail: 'не почта' }), /не похоже на адрес/);

  const full = operatorOf(OPERATOR);
  assert.deepEqual(full, { name: 'ООО «Метиз-Центр»', inn: '7707083893', ogrn: '1027700132195', address: '305000, г. Курск, ул. Ленина, д. 1', email: null });
  assert.equal(operatorOf({}), null, 'ничего не задано — реквизитов нет');
  const ip = operatorOf({ operator: 'ИП Иванов Иван Иванович', inn: '500100732259', ogrn: '304500116000157' }, full);
  assert.deepEqual([ip.name, ip.inn, ip.ogrn, ip.address], ['ИП Иванов Иван Иванович', '500100732259', '304500116000157', full.address], 'пустое — прежнее');
  assert.equal(operatorOf({ address: '-' }, full).address, null, '«-» — убрать');

  assert.deepEqual(missingOf(full, 'zakaz@shop.test'), [], 'почта для обращений — почта магазина');
  assert.deepEqual(missingOf(full, null), ['почта для обращений']);
  assert.deepEqual(missingOf(null, 'zakaz@shop.test'), ['наименование', 'ИНН', 'ОГРН или ОГРНИП', 'адрес']);
});

test('requisites: the shop form takes them on open and change; the policy shows the operator block, incomplete until filled', async () => {
  const form = new ShopForm({ niches: Object.keys(TEMPLATES) });
  const created = form.create({ slug: 'metiz-kursk', name: 'Метиз', email: 'zakaz@metiz.test', ...OPERATOR, pdEmail: 'pd@metiz.test' });
  assert.equal(created.operator.email, 'pd@metiz.test');
  assert.throws(() => form.create({ slug: 'metiz-kursk', name: 'Метиз', inn: '1234567890' }), /ИНН 1234567890: не сходится/, 'отказ до базы');

  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf, shopForm: form,
    privacy: { keepYears: 3, withdrawDays: 30 },
  });
  await desk.openShop({ slug: 'metiz-kursk', name: 'Метиз', email: 'zakaz@metiz.test' }, 'admin');
  const bare = await desk.privacyOf('metiz-kursk');
  assert.deepEqual([bare.operator, bare.email, bare.missing], [null, 'zakaz@metiz.test', ['наименование', 'ИНН', 'ОГРН или ОГРНИП', 'адрес']]);

  await desk.changeShop('metiz-kursk', OPERATOR, 'admin');
  const full = await desk.privacyOf('metiz-kursk');
  assert.deepEqual(full, {
    name: 'Метиз', email: 'zakaz@metiz.test', missing: [], keepYears: 3, withdrawDays: 30,
    operator: { name: 'ООО «Метиз-Центр»', inn: '7707083893', ogrn: '1027700132195', address: '305000, г. Курск, ул. Ленина, д. 1' },
  });
  await desk.changeShop('metiz-kursk', { pdEmail: 'pd@metiz.test' }, 'admin');
  assert.equal((await desk.privacyOf('metiz-kursk')).email, 'pd@metiz.test', 'своя почта для обращений по ПДн');
  await assert.rejects(desk.changeShop('metiz-kursk', { ogrn: '304500116000157' }, 'admin'), /разного рода/);
  const changed = journal.events.filter((e) => e.type === 'shop_changed').pop();
  assert.equal(changed.data.operator.inn, '7707083893', 'правка реквизитов — в журнале магазина');

  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'backbone', 'privacy.html'), 'utf8');
  assert.match(page, /<h2>Оператор<\/h2>/);
  assert.match(page, /op\.inn \? `ИНН/);
  assert.match(page, /'ОГРНИП' : 'ОГРН'/);
  assert.match(page, /Магазин ещё не указал: \$\{escapeHtml\(p\.missing\.join/);
  const cabinet = fs.readFileSync(path.join(__dirname, '..', 'public', 'experiments', 'backbone', 'index.html'), 'utf8');
  assert.match(cabinet, /Политика ПДн магазина неполная: не указаны/, 'кабинет предупреждает по полю missing из /me');
  assert.match(cabinet, /<a data-page="privacy">Данные покупателей<\/a>/);
});

// ---------- что считать ПДн в тексте, который остаётся ----------

test('anonymizer: e-mails, phones of any form, the contact and the name go; sizes, articles and quantities stay', () => {
  const a = new Anonymizer();
  const needles = a.needles([{ contact: '+79101234567', client: 'Пётр Иванов' }, { contact: 'ivan@buyer.test', client: 'ООО «Ромашка»' }]);
  assert.equal(
    a.scrub('Гайка М10 — 200 шт, звоните 8 (910) 123-45-67 или 910 123 45 67, Петр Иванов, ivan@buyer.test, Ромашка', needles),
    'Гайка М10 — 200 шт, звоните [удалено] или [удалено], [удалено], [удалено], [удалено]',
  );
  const declined = a.needles([{ contact: 'olga@buyer.test', client: 'Ольга Ипполитова' }]);
  assert.equal(a.scrub('для Ольги Ипполитовой, звонить Ольгой', declined), 'для [удалено] [удалено], звонить [удалено]', 'имя в другом падеже');
  const goods = 'Шуруп 3,5х35 — 8 упак; DIN 933 M10x50 8.8 — 200 шт; EAN 4607001234567; Ромашковый пр-д';
  assert.equal(a.scrub(goods, needles), goods, 'размеры, ГОСТ, штрихкод и похожее слово — не ПДн');
  assert.deepEqual(a.line({ origin: 'raw', source: 'С уважением, снабжение', name: 'С уважением, снабжение' }, needles), { source: '[удалено]', name: '[удалено]' });
  assert.equal(a.line({ origin: 'rule', source: 'Болт М10х50 — 100 шт', name: 'Болт М10х50' }, needles), null, 'менять нечего');
  assert.deepEqual(
    a.data({ number: 3, file: 'Иванов заявка.jpg', lines: [{ origin: 'raw', source: 'ИНН 7707083893', name: 'ИНН' }, { origin: 'model', source: 'Болт — 1 шт', name: 'Болт', sku: 'B-1' }] }, needles),
    { number: 3, file: '[удалено]', lines: [{ origin: 'raw', source: '[удалено]', name: '[удалено]' }, { origin: 'model', source: 'Болт — 1 шт', name: 'Болт', sku: 'B-1' }] },
  );
  assert.equal(a.data({ number: 3, columnType: 'inbox', org: true }, needles), null);
  assert.deepEqual(a.synonym({ phrase: 'гайка м10 для иванова', example: 'Гайка М10 для Иванова' }, a.needles([{ client: 'Иванова' }]), 'rule'), { drop: true });
  assert.deepEqual(a.synonym({ phrase: 'гайка м10 для петра', example: 'Гайка М10 для Петра' }, needles, 'rule'), { drop: true }, 'фраза с именем в падеже');
  assert.deepEqual(a.synonym({ phrase: 'гайка м10', example: 'Гайка М10 — тел. +7 910 123-45-67' }, needles, 'rule'), { example: 'Гайка М10 — тел. [удалено]' });

  assert.equal(contactKey('8 (910) 123-45-67'), '79101234567');
  assert.equal(contactKey('+7 910 1234567'), '79101234567');
  assert.equal(contactKey('Ivan@Buyer.TEST'), 'ivan@buyer.test');
  const order = { contact: '+79101234567', client: 'Пётр Иванов', number: 12 };
  for (const q of ['8 (910) 123-45-67', '9101234567', '123-45', 'пётр', '№12']) assert.ok(findsOrder(order, q), q);
  for (const q of ['8 (910) 765-43-21', 'ivan@buyer.test', '13']) assert.ok(!findsOrder(order, q), q);
});

test('table@1: search can be a function of the domain — the query is matched as the domain reads it', async () => {
  const rows = [{ id: '1', contact: '+79101234567' }, { id: '2', contact: 'a@b.test' }];
  const app = express();
  app.use('/c', Components({ t: Table({ rows: async () => rows, idKey: 'id', columns: [{ key: 'contact', name: 'Контакт' }], search: (row, q) => findsOrder(row, q) }) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/c/t`;
  try {
    assert.equal((await (await fetch(`${base}/meta`)).json()).search, true);
    const found = await (await fetch(`${base}/rows?q=${encodeURIComponent('8 (910) 123-45-67')}`)).json();
    assert.deepEqual(found.rows.map((r) => r.id), ['1']);
    const ids = await (await fetch(`${base}/ids?q=${encodeURIComponent('A@B.test')}`)).json();
    assert.deepEqual(ids.ids, ['2']);
  } finally {
    server.close();
  }
});

// ---------- удаление данных покупателя: костяк в памяти ----------

const catalog = new Catalog(
  new CsvFeed(path.join(__dirname, '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv')),
  new CatalogIndex({ attributes: hardwareAttributes }),
);
const match = new Match(catalog.index, { autoAccept: 0.9, ask: 0.6, defaultCoating: hardwareAttributes.defaultCoating });
const tool = new OrderToInvoice(new InvoiceDraft(
  new StockCheck(catalog, { pack: 'ask' }),
  new Matches(match),
  new Lines(new RuleLines(), new ModelLines({ verify: digitsInSource })),
  new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }),
), { maxLines: 200 });

// Магазин в памяти целиком: витрина, разбор при поступлении, квитанции и письмо менеджеру
// файлами .eml, ассистент, узел удаления данных.
function makeShop(start) {
  const clock = { now: start };
  const now = () => clock.now;
  const journal = new MemoryJournal({ clock: now });
  const repository = new MemoryRepository(journal);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backbone-pdn-'));
  const mailbox = new FileMailbox({ dir, from: 'shop@pdn.test' });
  const deadlineOf = () => '19.10 в 15:00';
  const receipts = new Receipts({
    repository, journal, mailbox, deadlineOf,
    statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`,
    notice: new ShopNotice({ cabinetUrl: (slug) => `https://shop.test/cabinet/?shop=${slug}`, deadlineOf }),
  });
  const dialogues = new MemoryDialogues({ clock: now });
  const erasure = new Erasure({
    repository, journal, anonymizer: new Anonymizer(), keepYears: 3, visitorKeyOf: visitorKey, dialogues, mailbox, batch: 2, clock: now,
  });
  const hours = { days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59' };
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: {
      [SHOP]: { name: 'Крепёж ПДн', niche: 'hardware', hours, mode: 'help', replyTo: 'zakaz@pdn.test' },
      'other-shop': { name: 'Другой', niche: 'hardware', mode: 'help' },
    },
    tool, autoParse: true,
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    statusPage: new StatusPage(), receipts, privacy: { keepYears: 3, withdrawDays: 30 }, erasure, clock: now,
  });
  const funnel = new Funnel();
  const statusPath = (t) => `/backbone/status.html?t=${t}`;
  const assistant = new Assistant({
    desk,
    chatDesk: new ChatDesk({ repository: dialogues, suggester: null, funnel }),
    replyDeskOf: () => null,
    factsOf: async (shop, clientKey) => new ShopFacts({
      shop, catalog, match, orders: () => desk.clientOrders(shop.slug, clientKey),
      hours: new WorkingHours({ tz: 'Europe/Moscow', ...hours }), clock: now,
    }),
    answers: new AutoAnswers([new StatusAnswer({ statusPath }), new HoursAnswer(), new StockAnswer({ limit: 5 })]),
    intake: new ChatIntake(new RuleLines()),
    repository, journal, statusPath, clock: now,
  });
  const stores = () => JSON.stringify({
    orders: repository.rows, lines: repository.draftLines, synonyms: repository.synonymRows, receipts: repository.receiptRows,
    journal: journal.events, dialogues: dialogues.rows, messages: dialogues.msgs,
  });
  const letters = () => fs.readdirSync(path.join(dir, SHOP)).map((f) => fs.readFileSync(path.join(dir, SHOP, f), 'utf8'));
  return { desk, assistant, journal, repository, dialogues, clock, stores, letters, erasure, dir };
}

// Покупатель, чьи данные удаляем: имя, почта, телефон в тексте и подпись — везде, куда они попадают.
const BUYER = /ипполит|ippolit|пдн-покупатель|555[\s()-]*12[\s()-]*34/i;
const LIST = 'Здравствуйте!\nБолт М10х50 — 200 шт\nГайка М10 — 200 шт, Ипполиту на объект, тел. +7 (910) 555-12-34\nШайба М10 для Ипполита — 10 шт\nС уважением, Ипполит Пдн-покупатель';
const FORM = { name: 'Ипполит Пдн-покупатель', contact: 'Ippolit.PDN@Buyer.test', text: LIST, consent: 'on' };

test('erase by request: every store forgets the buyer — orders, lines, synonyms, letters and files, journal, chat; numbers and sums stay', async () => {
  const { desk, assistant, journal, repository, dialogues, stores, letters } = makeShop(msk('2026-10-19T10:00'));
  const { order: site } = await desk.receiveFromSite(SHOP, FORM, null, { clientKey: 'guest-1' });
  await desk.receiveFromSite(SHOP, { ...FORM, text: '' }, { name: 'Ипполит список.jpg', data: Buffer.from('jpeg') }, { clientKey: 'guest-1' });
  await assistant.hear(SHOP, 'guest-1', { text: 'Ипполит, мой телефон 8 910 555 12 34 — перезвоните' });
  const offered = await assistant.hear(SHOP, 'guest-1', { text: 'Шуруп по дереву 3,5х35 — 100 шт\nДюбель 6х40 — 50 шт' });
  await assistant.sendList(SHOP, 'guest-1', { message: offered.offer.message, contact: FORM.contact, name: FORM.name, consent: 'on' });
  const { order: other } = await desk.receiveFromSite(SHOP, { name: 'Ольга Другая', contact: 'olga@other.test', text: 'Болт М10х50 — 50 шт', consent: 'on' });

  // правка менеджера из строки покупателя — синоним с её текстом примером; разбор нейросетью — строки в журнале
  const shop = await desk.shop(SHOP);
  const lines = (await repository.lines(shop.id)).filter((l) => l.order_id === site.id);
  const nut = lines.find((l) => /Гайка/.test(l.source));
  const washer = lines.find((l) => /Ипполита/.test(l.source));
  await desk.review(SHOP, [nut.id], { verdict: 'replaced', sku: 'N934-10-ZN' }, 'manager@pdn.test');
  await desk.review(SHOP, [washer.id], { verdict: 'replaced', sku: 'W125-10-ZN' }, 'manager@pdn.test');
  assert.match(JSON.stringify(repository.synonymRows), /ипполита/, 'синоним из строки с именем покупателя');
  await repository.appendEvents([{
    stream: 'order', scope: shop.id, subjectId: site.id, type: 'model_parsed', actor: 'manager@pdn.test', cause: 'model',
    data: { number: site.number, lines: [{ position: 1, source: nut.source, name: 'Гайка М10', origin: 'model', sku: 'N934-10-ZN' }, { position: 2, source: 'С уважением, Ипполит Пдн-покупатель', name: 'С уважением', origin: 'raw' }] },
  }]);
  assert.match(stores(), BUYER, 'до удаления покупатель — в хранилищах');
  assert.ok(letters().some((t) => /ippolit\.pdn@buyer\.test/.test(t)), 'и в письмах-файлах');

  const before = (await desk.drafts(SHOP)).map((d) => [d.order.number, d.lines, d.accepted, d.sum]);
  const eventsBefore = journal.events.length;
  const found = (await desk.customers(SHOP)).filter((o) => findsOrder(o, 'IPPOLIT.pdn@buyer.test'));
  assert.deepEqual(found.map((o) => o.number), [3, 2, 1], 'поиск по контакту — его заявки с сайта и из чата');
  assert.equal(found[0].keep_until, '2029-10-19T07:00:00.000Z', 'хранится 3 года с даты заявки');

  const r = await desk.eraseCustomer(SHOP, found.map((o) => o.id), 'manager@pdn.test');
  assert.deepEqual([r.orders, r.numbers, r.dialogues], [3, [1, 2, 3], 1]);
  assert.ok(r.letters >= 4 && r.files >= 4, `письма и файлы: ${r.letters}, ${r.files}`);

  assert.doesNotMatch(stores(), BUYER, 'ни в заявках, строках, синонимах, письмах, журнале, разговорах');
  assert.ok(letters().every((t) => !BUYER.test(t)), 'письма-файлы покупателя удалены');
  assert.ok(letters().some((t) => /olga@other\.test/.test(t)), 'письма другого покупателя на месте');
  const kept = await repository.orderById(other.id);
  assert.deepEqual([kept.client, kept.contact, kept.text, kept.erased_at], ['Ольга Другая', 'olga@other.test', 'Болт М10х50 — 50 шт', null]);

  const after = (await desk.drafts(SHOP)).map((d) => [d.order.number, d.lines, d.accepted, d.sum]);
  assert.deepEqual(after, before, 'номера, строки черновика и суммы — для замеров');
  const erased = await repository.orderById(site.id);
  assert.deepEqual([erased.client, erased.contact, erased.text, erased.content_key, erased.client_key], ['данные удалены', '', '', null, null]);
  assert.ok(erased.erased_at && erased.status_token, 'окно статуса по ссылке живо: в нём нет ПДн');
  assert.equal((await repository.lines(shop.id)).find((l) => l.id === nut.id).sku, 'N934-10-ZN', 'позиция строки осталась');
  assert.deepEqual(repository.synonymRows.map((x) => x.phrase), ['гайка м10'], 'синоним с именем ушёл, без имени — остался');
  assert.equal(journal.events.length, eventsBefore + 1, 'события на месте, плюс одно — об удалении');
  const done = journal.events.at(-1);
  assert.deepEqual([done.type, done.stream, done.actor, done.cause], ['personal_data_erased', 'shop', 'manager@pdn.test', 'request']);
  assert.deepEqual([done.data.orders, done.data.numbers, done.data.reason], [3, [1, 2, 3], 'request']);
  assert.deepEqual((await assistant.conversation(SHOP, 'guest-1')).messages, [], 'разговор гостя забыт');
  assert.equal(dialogues.rows.length, 0);
  assert.deepEqual(await desk.clientOrders(SHOP, 'guest-1'), [], 'ключ гостя у заявок стёрт');

  // дальше по доске: квитанции некому — «пропущено», файла нет
  const columns = await desk.columns(SHOP);
  const files = letters().length;
  await desk.moveOrder(SHOP, site.id, columns.find((c) => c.type === 'done').id, { actor: 'manager' });
  const last = (await desk.receiptsOf(SHOP)).find((x) => x.order_id === site.id && x.kind === 'done');
  assert.deepEqual([last.status, last.last_error], ['skipped', 'данные покупателя удалены']);
  assert.equal(letters().length, files);

  await assert.rejects(desk.eraseCustomer(SHOP, [site.id], 'm'), /уже удалены/);
  await assert.rejects(desk.eraseCustomer(SHOP, [], 'm'), /Не выбрано/);
  const { order: foreign } = await desk.receiveFromSite('other-shop', { ...FORM, contact: 'x@other.test' });
  const err = await desk.eraseCustomer(SHOP, [foreign.id, other.id], 'm').catch((e) => e);
  assert.equal(err.status, 404, 'заявка чужого магазина — «не найдена»');
  assert.equal((await repository.orderById(foreign.id)).contact, 'x@other.test');
  assert.equal((await repository.orderById(other.id)).contact, 'olga@other.test', 'отказ — без частичного удаления');
});

test('erase by term: orders older than the keeping term and idle chats go; a repeated list renews the term; the timer runs every shop', async () => {
  const { desk, assistant, journal, repository, dialogues, clock, erasure } = makeShop(msk('2023-10-01T10:00'));
  const { order: old } = await desk.receiveFromSite(SHOP, { ...FORM, contact: 'old@buyer.test', text: 'Болт М10х50 — 10 шт' });
  const { order: renewed } = await desk.receiveFromSite(SHOP, { ...FORM, contact: 'again@buyer.test', text: 'Гайка М10 — 10 шт' });
  await assistant.hear(SHOP, 'guest-idle', { text: 'Ипполит, перезвоните на 8 910 555 12 34' });
  clock.now = msk('2026-09-01T10:00');
  await desk.receiveFromSite(SHOP, { ...FORM, contact: 'again@buyer.test', text: 'Гайка М10 — 10 шт' }); // тот же список — согласие заново
  await assistant.hear(SHOP, 'guest-live', { text: 'Есть ли М10х50?' });
  clock.now = msk('2026-10-19T10:00');
  const { order: fresh } = await desk.receiveFromSite(SHOP, { ...FORM, contact: 'new@buyer.test', text: 'Шайба М10 — 10 шт' });

  const ledger = new Map((await desk.customers(SHOP)).map((o) => [o.id, o.keep_until]));
  assert.equal(ledger.get(renewed.id), '2029-09-01T07:00:00.000Z', 'срок — от повторной отправки');

  const r = await desk.eraseExpired(SHOP, 'admin@pdn.test');
  assert.deepEqual([r.orders, r.numbers, r.dialogues], [1, [old.number], 1]);
  assert.equal((await repository.orderById(old.id)).contact, '');
  assert.equal((await repository.orderById(renewed.id)).contact, 'again@buyer.test');
  assert.equal((await repository.orderById(fresh.id)).contact, 'new@buyer.test');
  assert.deepEqual(dialogues.rows.map((d) => d.visitor_key.split(':')[1]), ['guest-live'], 'разговор без движения дольше срока — забыт');
  const done = journal.events.filter((e) => e.type === 'personal_data_erased');
  assert.deepEqual(done.map((e) => [e.cause, e.actor, e.data.orders, e.data.dialogues]), [['retention', 'admin@pdn.test', 1, 0], ['retention', 'admin@pdn.test', 0, 1]]);

  // таймер: тот же узел по всем магазинам; повтор — нечего обезличивать
  const said = [];
  const retention = new Retention({ shops: () => repository.shops(), erasure, everyHours: 24, firstMinutes: 5, log: { log: (m) => said.push(m), error: (m) => said.push(m) } });
  clock.now = msk('2029-09-02T10:00');
  assert.deepEqual(await retention.run(), [`${SHOP}: заявок 1, разговоров 1`]);
  assert.equal((await repository.orderById(renewed.id)).contact, '', 'вышел и продлённый срок');
  assert.deepEqual(await retention.run(), [], 'повтор безопасен');
  assert.match(said[0], /срок хранения ПДн — обезличено: pdn-shop: заявок 1/);
  const timer = retention.start();
  assert.equal(timer.hasRef(), false, 'таймер не держит процесс');
  assert.equal(retention.start(), timer, 'один таймер на экземпляр');
  clearInterval(timer);
});

// ---------- Postgres: все таблицы после удаления ----------

const cyr = (t) => [...t].map((c) => 'бвгджзклмнпрстфхцчшщ'[parseInt(c, 36) % 20]).join('');

function xlsxOf(rows) {
  const strings = [];
  const sid = (s) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i) => String.fromCharCode(65 + i);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => (typeof v === 'number'
    ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`)).join('')}</row>`).join('');
  return zip([
    ['xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Прайс" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

test('postgres: after erasing a buyer no table of the database and no letter file holds their data; numbers, lines and sums stay', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['030_backbone_personal_data.sql']);
    if (!rows.length) return t.skip('миграция 030 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const config = require('../server/config');
  const { backboneDesk, assistant } = require('../server/services/backbone');
  const { forShop } = require('../server/services/backbone/components');
  const tag = Date.now().toString(36);
  const slug = `t-pdn-${tag}`;
  const name = `Ипполит Пдн${cyr(tag)}`;           // имя покупателя — уникальное слово кириллицей
  const email = `buyer-${tag}@pdn.test`;
  const [a, b, c] = [crypto.randomInt(100, 999), crypto.randomInt(10, 99), crypto.randomInt(10, 99)];
  const phone = `+7 (999) ${a}-${b}-${c}`;
  const NEEDLE = `пдн${cyr(tag)}|buyer-${tag}|999\\D{0,3}${a}\\D{0,3}${b}\\D{0,3}${c}`; // регулярка Postgres
  const guest = crypto.randomUUID();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'test-admin', email: 'manager@pdn.test' }; next(); });
  app.use('/c', (req, res, next) => forShop(slug)(req, res, next));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/c`;
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  let shopId = null;
  try {
    const shop = await backboneDesk.openShop({ slug, name: 'Магазин ПДн', niche: 'hardware', days: 'ежедневно', time: '0-24', email: `zakaz-${tag}@pdn.test`, ...OPERATOR }, 'test');
    shopId = shop.id;
    assert.deepEqual((await backboneDesk.privacyOf(slug)).missing, [], 'реквизиты в таблице магазинов — политика полная');
    await backboneDesk.switchMode(slug, 'help', 'test', { confirm: true });
    await backboneDesk.uploadCatalog(slug, { name: 'прайс.xlsx', data: xlsxOf([
      ['Артикул', 'Номенклатура', 'Ед. изм.', 'Кратность', 'Цена, руб.', 'Остаток'],
      ['PD-B10x50', 'Болт DIN 933 М10×50 кл. 8.8 оцинк.', 'шт', 25, 15.4, 1200],
      ['PD-N10', 'Гайка DIN 934 М10 кл. 8 оцинк.', 'шт', 100, 2.1, 5000],
    ]) }, 'test');
    assert.equal((await backboneDesk.commitCatalog(slug, 'test')).ok, true);

    // покупатель: заявка с сайта (имя, почта, телефон в тексте, подпись), скан с именем в файле, чат и список из чата
    const text = `Болт М10х50 — 200 шт\nГайка М10 — 100 шт, звонить ${phone}\nШайба М10 для ${name}а — 10 шт\nС уважением, ${name}`;
    const { order: site } = await backboneDesk.receiveFromSite(slug, { name, contact: email, text, consent: 'on' }, null, { clientKey: guest });
    await backboneDesk.receiveFromSite(slug, { name, contact: email, text: '', consent: 'on' }, { name: `${name} список.jpg`, data: Buffer.from('jpeg') }, { clientKey: guest });
    await assistant.hear(slug, guest, { text: `Это ${name}, мой телефон ${phone}` });
    const offered = await assistant.hear(slug, guest, { text: 'Болт М10х50 — 30 шт\nГайка М10 — 30 шт' });
    await assistant.sendList(slug, guest, { message: offered.offer.message, contact: email, name, consent: 'on' });
    const { order: other } = await backboneDesk.receiveFromSite(slug, { name: 'Ольга Другая', contact: `olga-${tag}@pdn.test`, text: 'Болт М10х50 — 50 шт', consent: 'on' });
    const washer = (await backboneDesk.draftLines(slug)).find((l) => l.order_id === site.id && /Шайба/.test(l.source));
    await backboneDesk.review(slug, [washer.id], { verdict: 'replaced', sku: 'PD-N10' }, 'manager@pdn.test'); // синоним с именем покупателя

    // где покупатель лежит до удаления — по всем таблицам базы
    const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
    const holding = async () => {
      const out = [];
      for (const table of tables) {
        const { rows: [row] } = await db.query(`SELECT count(*)::int AS n FROM "${table}" x WHERE x::text ~* $1`, [NEEDLE]);
        if (row.n) out.push(`${table}: ${row.n}`);
      }
      return out;
    };
    const was = await holding();
    for (const table of ['backbone_orders', 'backbone_order_lines', 'backbone_synonyms', 'backbone_receipts', 'journal_events', 'chat_engine_dialogues', 'chat_engine_messages']) {
      assert.ok(was.some((h) => h.startsWith(`${table}:`)), `до удаления покупатель есть в ${table}: ${was.join(', ')}`);
    }
    const mailDir = path.join(config.backboneMailDir, slug);
    const mail = () => fs.readdirSync(mailDir).map((f) => fs.readFileSync(path.join(mailDir, f), 'utf8'));
    assert.ok(mail().some((m) => m.includes(email)), 'письма-файлы с покупателем');
    const drafts = async () => (await backboneDesk.drafts(slug)).map((d) => [d.order.number, d.lines, d.accepted, d.sum]);
    const before = await drafts();

    // кабинет: поиск по почте любым регистром → «Удалить данные покупателя» с подтверждением
    const rows = await (await fetch(`${base}/customers/rows?q=${encodeURIComponent(email.toUpperCase())}`)).json();
    assert.deepEqual(rows.rows.map((r) => r.number), [3, 2, 1]);
    const ids = rows.rows.map((r) => r.id);
    const unconfirmed = await post('/customers/actions/erase', { ids });
    assert.equal(unconfirmed.status, 400);
    assert.match(unconfirmed.error, /Подтвердите/);
    const erased = await post('/customers/actions/erase', { ids, confirm: 'yes' });
    assert.equal(erased.status, 200, erased.error);
    assert.match(erased.result.message, /Данные покупателя удалены: заявок 3 \(№1, №2, №3\)/);

    assert.deepEqual(await holding(), [], 'ни в одной таблице базы');
    assert.ok(mail().every((m) => !new RegExp(NEEDLE.replace(/\\D/g, '[^0-9]'), 'i').test(m)), 'ни в одном письме-файле');
    assert.ok(mail().some((m) => m.includes(`olga-${tag}@pdn.test`)), 'письма другого покупателя — на месте');
    assert.deepEqual(await drafts(), before, 'номера, строки и суммы — на месте');
    assert.equal((await backboneDesk.history(slug, other.id)).order.contact, `olga-${tag}@pdn.test`);
    const journal = await backboneDesk.journalOf(slug);
    const event = journal.find((e) => e.type === 'personal_data_erased');
    assert.deepEqual([event.actor, event.data.orders, event.data.numbers, event.data.dialogues], ['manager@pdn.test', 3, [1, 2, 3], 1]);
    const expired = await post('/customers/actions/expired', {});
    assert.equal(expired.result.message, 'Заявок и разговоров старше срока хранения нет');
  } finally {
    server.close();
    fs.rmSync(path.join(config.backboneMailDir, slug), { recursive: true, force: true });
    if (shopId) {
      await db.query('DELETE FROM chat_engine_dialogues WHERE starts_with(visitor_key, $1)', [`${shopId}:`]);
      await db.query('DELETE FROM journal_events WHERE scope = $1', [shopId]);
      await db.query('DELETE FROM backbone_shops WHERE id = $1', [shopId]);
    }
  }
});
