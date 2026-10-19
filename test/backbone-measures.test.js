// Костяк MVP, шаг 3: замеры из журнала, теневой режим, выгрузка черновика в xlsx для 1С
// (docs/backbone-architecture.md §6.6, §10). Время событий — управляемые часы журнала.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path, Order } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { Catalog, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { OrderToInvoice } = require('../server/services/backbone/invoice/OrderToInvoice');
const { InvoiceDraft } = require('../server/services/backbone/invoice/InvoiceDraft');
const { StockCheck } = require('../server/services/backbone/invoice/StockCheck');
const { Match, Matches } = require('../server/services/backbone/invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('../server/services/backbone/invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');
const { InvoiceExport } = require('../server/services/backbone/invoice/InvoiceExport');
const { FinalInvoice, compareDraft } = require('../server/services/backbone/invoice/FinalInvoice');
const { unzip } = require('../server/services/backbone/invoice/zip');
const { RecordedLlm } = require('../server/services/backbone/invoice/models');
const { Measures } = require('../server/services/backbone/measures/Measures');
const { WorkingHours } = require('../server/services/backbone/measures/WorkingHours');
const { Baseline } = require('../server/services/backbone/measures/Baseline');
const { Components } = require('../server/components');
const { Table } = require('../server/components/table');

const FIXTURES = path.join(__dirname, '..', 'server', 'services', 'backbone', 'invoice', 'fixtures');
const REQUEST_20 = fs.readFileSync(path.join(FIXTURES, 'request-20.txt'), 'utf8');
const RECORDED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-llm.json'), 'utf8'));
const SHOP = 'test-shop';
const HOURS = { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' };
const msk = (local) => new Date(`${local}+03:00`); // «2026-10-16T18:30» по Москве

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
), { maxLines: 200, exporter: new InvoiceExport(catalog), finalInvoice: new FinalInvoice(catalog.index, match, new RuleLines()) });

function makeDesk(start) {
  const clock = { now: start };
  const journal = new MemoryJournal({ clock: () => clock.now });
  const desk = new BackboneDesk({
    repository: new MemoryRepository(journal), journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { [SHOP]: { name: 'Тест', niche: 'hardware', hours: HOURS } },
    tool, llm: new RecordedLlm(RECORDED),
    measuresOf: (shop, spec) => new Measures(new WorkingHours({ tz: shop.tz, ...spec.hours })),
    // порог 0,6, а не 0,8 магазина: черновик здесь механический (без модели), и у демо-заявки
    // две строки остаются «не разобрано» — мера проверяется на числах этой заявки
    baseline: new Baseline({ shadowDays: 14, accuracy: 0.6, minLines: 20 }),
    clock: () => clock.now,
  });
  return { desk, journal, clock };
}

// Табличная часть счёта, как её копирует 1С: № — Артикул — Товары — Кол-во — Ед. — Цена — Сумма.
function invoiceFrom1C(rows) {
  const lines = rows.map(([sku, qty, { withSku = true } = {}], i) => {
    const item = catalog.bySku(sku);
    const money = (x) => x.toFixed(2).replace('.', ',');
    return [i + 1, withSku ? sku : '', item.name, qty, item.unit, money(item.price), money(item.price * qty)].join('\t');
  });
  return ['№\tАртикул\tТовары (работы, услуги)\tКол-во\tЕд.\tЦена\tСумма', ...lines, 'Итого:\t\t\t\t\t\t13 000,00'].join('\n');
}

// Черновик демо-заявки без синонимов: что дал бы инструмент (позиция, количество в единице позиции).
const DRAFT_20 = [
  ['B933-10x50-ZN', 100], ['N934-10-ZN', 200], ['W125-10-ZN', 200], ['SW-4.5x60-YZ', 1000], ['SR-4.8x35-RAL8017', 250],
  ['AK-8x75', 37], ['DP-6x40', 200], ['ST975-12-ZN', 10], ['HC-20-32', 30], ['BV-1-2-ВР-ВР', 5], ['FH-60-GS', 4],
  ['PP-PIPE-25', 12], ['PP-MF-25', 10], ['FUM-19x15', 5], ['NL-3x70', 5], null, ['SP-4.2x16-D', 500], ['DG-6x60', 300],
  ['N985-8-ZN', 100], ['B933-8x40-ZN', 100],
];

// ---------- рабочее время ----------

test('working hours count shop minutes in Moscow time: evenings and Sundays wait', () => {
  const hours = new WorkingHours({ tz: 'Europe/Moscow', ...HOURS });
  assert.equal(hours.minutes(msk('2026-10-16T18:30'), msk('2026-10-17T09:30')), 60);  // пятница вечер → суббота утро
  assert.equal(hours.minutes(msk('2026-10-17T18:30'), msk('2026-10-19T09:30')), 60);  // воскресенье выходной
  assert.equal(hours.minutes(msk('2026-10-16T22:00'), msk('2026-10-17T09:15')), 15);
  assert.equal(hours.minutes(msk('2026-10-16T10:00'), msk('2026-10-16T10:00')), 0);
  assert.equal(hours.weekOf(msk('2026-10-18T23:30').getTime()), '2026-10-12');
  assert.equal(hours.weekOf(msk('2026-10-19T00:10').getTime()), '2026-10-19');
});

// ---------- замеры на журнале ----------

test('measures read every §6.6 metric from journal events, split into shadow (before) and help (after)', () => {
  const S = 'shop-1';
  let id = 0;
  const ev = (stream, subject, type, local, data = {}, extra = {}) => ({
    id: ++id, stream, scope: S, subject_id: subject, type, data, actor: 'm', cause: 'manual', at: msk(local).toISOString(), ...extra,
  });
  const events = [
    // A — тень: ответ через 20 мин, счёт через час, выдано; от организации
    ev('order', 'A', 'received', '2026-10-12T10:00', { number: 1, columnType: 'inbox', org: true }),
    ev('order', 'A', 'draft_ready', '2026-10-12T10:01', { lines: 10, missing: 1, questions: 2 }),
    ev('order', 'A', 'moved', '2026-10-12T10:20', { toType: 'waiting_client' }),
    ev('order', 'A', 'invoice_sent', '2026-10-12T11:00', { mode: 'shadow', right: 8, base: 12 }),
    ev('order', 'A', 'moved', '2026-10-12T15:00', { toType: 'done' }),
    // B — тень: заявка вечером, ответ утром — 75 минут рабочего времени; отказ
    ev('order', 'B', 'received', '2026-10-12T18:30', { number: 2, columnType: 'inbox' }),
    ev('order', 'B', 'draft_ready', '2026-10-12T18:31', { lines: 3, missing: 0, questions: 0 }),
    ev('order', 'B', 'invoice_sent', '2026-10-13T09:45', { mode: 'shadow', right: 3, base: 3 }),
    ev('order', 'B', 'moved', '2026-10-13T12:00', { toType: 'refused' }),
    // смена режима: помощь
    ev('shop', S, 'mode_changed', '2026-10-14T09:00', { from: 'shadow', to: 'help' }),
    // C — помощь: две правки, выгрузка и счёт за 12 минут; выдано
    ev('order', 'C', 'received', '2026-10-15T10:00', { number: 3, columnType: 'inbox' }),
    ev('order', 'C', 'draft_ready', '2026-10-15T10:01', { lines: 20, missing: 0, questions: 1 }),
    ev('order', 'C', 'reviewed', '2026-10-15T10:05', { line: 3, verdict: 'edited' }),
    ev('order', 'C', 'reviewed', '2026-10-15T10:07', { line: 7, verdict: 'replaced' }),
    ev('order', 'C', 'invoice_exported', '2026-10-15T10:10', { lines: 18 }),
    ev('order', 'C', 'invoice_sent', '2026-10-15T10:12', { mode: 'help', right: 18, base: 20 }),
    ev('order', 'C', 'moved', '2026-10-16T10:00', { toType: 'done' }),
    // D — помощь: лежит во входящих три рабочих часа
    ev('order', 'D', 'received', '2026-10-19T09:00', { number: 4, columnType: 'inbox' }),
  ];
  const measures = new Measures(new WorkingHours({ tz: 'Europe/Moscow', ...HOURS }));
  const r = measures.report(events, { now: msk('2026-10-19T12:00').getTime(), mode: 'help' });

  assert.deepEqual(r.cards.map((c) => c.mode), ['shadow', 'shadow', 'help', 'help']);
  const b = r.before;
  assert.equal(b.orders, 2);
  assert.equal(b.replyWithinHour, 0.5);
  assert.equal(b.replyMinutes, 47.5);
  assert.equal(b.invoiceMinutes, 67.5);
  assert.deepEqual(b.shadowAccuracy, { value: 11 / 15, right: 11, base: 15, orders: 2 });
  assert.equal(b.missingShare, 1 / 13);
  assert.equal(b.questionShare, 2 / 13);
  assert.deepEqual(b.conversion, { value: 0.5, won: 1, lost: 1 });
  assert.equal(b.b2b, 0.5);
  assert.equal(b.managerMinutes, null); // в тени работа идёт в 1С — из журнала её не видно

  const a = r.after;
  assert.equal(a.orders, 2);
  assert.equal(a.replyWithinHour, 0.5); // D просрочена: три рабочих часа без ответа
  assert.equal(a.replyMinutes, 12);
  assert.equal(a.managerMinutes, 8);    // правки 10:05–10:12 — одна серия, 7 мин + 1
  assert.deepEqual(a.untouched, { value: 0.9, right: 18, base: 20, orders: 1 });
  assert.deepEqual(a.conversion, { value: 1, won: 1, lost: 0 });

  assert.deepEqual(r.weeks.map((w) => [w.week, w.orders, w.modes]), [['2026-10-19', 1, ['help']], ['2026-10-12', 3, ['shadow', 'help']]]);
  assert.deepEqual(r.silence, { inbox: [4], waitingClient: [] });
});

// ---------- выгрузка в 1С и счёт из 1С ----------

test('invoice export writes an xlsx for 1C: accepted lines only, the rest on a second sheet', async () => {
  const draft = (await tool.run({ text: REQUEST_20 }, { llm: new RecordedLlm(RECORDED) })).draft;
  const lines = draft.lines.map((l) => ({ ...l, invoice_qty: l.invoiceQty }));
  const file = tool.exportFile(lines);
  assert.deepEqual([file.included, file.left], [15, 5]);

  const rows = await new SheetRows().lines(file.buffer); // наш же читатель xlsx: файл — настоящая книга
  assert.equal(rows.length, 15);
  assert.equal(rows[0], 'B933-10x50-ZN\tБолт DIN 933 М10×50 кл. 8.8 оцинк.\t100\tшт\t5.52\t552');
  assert.ok(!rows.some((r) => r.startsWith('B933-8x40')));            // «выбрать» молча в счёт не попадает
  const sheet2 = unzip(file.buffer, { maxEntryBytes: 1e6, bad: (m) => new Error(m) })('xl/worksheets/sheet2.xml');
  assert.match(sheet2, /Шуруп по дереву 3,5х35/);
  assert.match(sheet2, /упаковка по 50/);
  assert.equal(file.sum, Math.round(lines.filter((l) => l.state === 'accepted').reduce((s, l) => s + l.invoiceQty * l.price, 0) * 100) / 100);
});

test('a final invoice pasted from 1C is read by article or by name; totals and headers are skipped', () => {
  const text = invoiceFrom1C([['B933-10x50-ZN', 100], ['W125-10-ZN', 200, { withSku: false }], ['AK-8x75', 50]])
    + '\n4\t\tТовар, которого нет в каталоге\t3\tшт\t10,00\t30,00';
  const { lines, unknown } = tool.readInvoice(text);
  assert.deepEqual(lines.map((l) => [l.sku, l.qty]), [['B933-10x50-ZN', 100], ['W125-10-ZN', 200], ['AK-8x75', 50]]);
  assert.equal(unknown.length, 1);

  const cmp = compareDraft(
    [{ sku: 'B933-10x50-ZN', invoice_qty: 100 }, { sku: 'W125-10-ZN', invoice_qty: 200 }, { sku: 'AK-8x75', invoice_qty: 37 }, { sku: null, invoice_qty: null }],
    lines,
  );
  assert.deepEqual(cmp, { draft: 4, final: 3, matched: 2, right: 2, base: 5, accuracy: 0.4 });
});

// ---------- сравнение (тень) → мера → помощь ----------

test('comparison (shadow) hides the draft, the 1C invoice measures accuracy, help by the measure goes without a question', async () => {
  const { desk, journal, clock } = makeDesk(msk('2026-10-12T10:00'));
  const first = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'manager@test');
  assert.equal((await journal.forSubject('order', first.id))[0].data.org, true);
  assert.equal((await desk.shop(SHOP)).mode, 'shadow');

  await assert.rejects(desk.exportInvoice(SHOP, first.id, 'm'), /Сравнение/);
  await assert.rejects(desk.invoiceSent(SHOP, first.id, 'm'), /Сравнение/);

  // менеджер сделал счёт в 1С сам: анкеры — 50 (упаковка), гвозди — оцинкованные, шуруп нашёл, ФУМ убрал
  clock.now = msk('2026-10-12T10:40');
  const final = DRAFT_20.filter((x) => x && !['AK-8x75', 'NL-3x70', 'FUM-19x15'].includes(x[0]))
    .concat([['AK-8x75', 50], ['NL-3x70-ZN', 5], ['SW-3.5x35-YZ', 400]]);
  const attached = await desk.attachInvoice(SHOP, first.id, invoiceFrom1C(final), { actor: 'manager@test' });
  assert.deepEqual([attached.draft, attached.final, attached.matched, attached.base], [20, 19, 14, 25]); // механический черновик построен тут же
  assert.equal((await desk.managerLines(SHOP)).length, 20);                                           // после счёта — видно
  await assert.rejects(desk.attachInvoice(SHOP, first.id, invoiceFrom1C(final), { actor: 'm' }), /уже приложен/);

  await assert.rejects(desk.switchMode(SHOP, 'help', 'owner'), /сравнение идёт 0 дн\. из 14/);
  clock.now = msk('2026-10-27T10:00');
  await assert.rejects(desk.switchMode(SHOP, 'help', 'owner'), /точность черновика 0,56 — ниже порога 0,6/);

  // вторая заявка в тени: черновик ещё не показан менеджеру, счёт совпал почти целиком
  const second = await desk.createOrder(SHOP, { client: 'ИП Петров', text: REQUEST_20 }, 'manager@test');
  assert.equal((await desk.managerLines(SHOP)).length, 20);
  clock.now = msk('2026-10-27T11:00');
  await desk.attachInvoice(SHOP, second.id, invoiceFrom1C(DRAFT_20.filter(Boolean)), { actor: 'manager@test' });

  const switched = await desk.switchMode(SHOP, 'help', 'owner');
  assert.match(switched.reason, /точность 0,66 на 47 строках за 15 дн\. сравнения/);
  assert.equal(switched.unmeasured, undefined); // мера набрана — без пометки
  assert.deepEqual([switched.snapshot.days, switched.snapshot.orders, switched.snapshot.comparedLines], [15, 2, 47]);
  const changed = (await journal.history((await desk.shop(SHOP)).id)).find((e) => e.type === 'mode_changed');
  assert.deepEqual([changed.stream, changed.data.from, changed.data.to, changed.cause], ['shop', 'shadow', 'help', 'decision']);

  // помощь: правка, выгрузка в xlsx, счёт отправлен
  clock.now = msk('2026-10-28T10:00');
  const third = await desk.createOrder(SHOP, { client: 'ООО «Монтаж»', text: REQUEST_20 }, 'manager@test');
  await desk.parseOrder(SHOP, third.id, { actor: 'manager@test' });
  clock.now = msk('2026-10-28T10:04');
  const anchor = (await desk.draftLines(SHOP)).find((l) => l.order_id === third.id && l.position === 6);
  await desk.review(SHOP, [anchor.id], { verdict: 'edited', qty: '50' }, 'manager@test');
  clock.now = msk('2026-10-28T10:06');
  const exported = await desk.exportInvoice(SHOP, third.id, 'manager@test');
  assert.deepEqual([exported.included, exported.left], [14, 6]); // механика: две строки «не разобрано»
  const file = await desk.invoiceFile(SHOP, third.id);
  assert.equal(file.filename, `schet-zayavka-${third.number}.xlsx`);
  assert.ok((await new SheetRows().lines(file.buffer)).includes('AK-8x75\tАнкер клиновой 8×75\t50\tшт\t12\t600'));
  clock.now = msk('2026-10-28T10:08');
  const sent = await desk.invoiceSent(SHOP, third.id, 'manager@test');
  assert.deepEqual([sent.right, sent.base, sent.edited], [19, 20, 1]);
  await assert.rejects(desk.invoiceSent(SHOP, third.id, 'm'), /уже отправлен/);
  await assert.rejects(desk.attachInvoice(SHOP, third.id, 'x', { actor: 'm' }), /Помощь/);

  const { report } = await desk.measures(SHOP);
  assert.equal(report.before.orders, 2);
  assert.equal(report.before.shadowAccuracy.base, 47);
  assert.equal(report.after.orders, 1);
  assert.deepEqual([report.after.untouched.value, report.after.invoiceMinutes, report.after.managerMinutes], [0.95, 8, 5]);

  // вернуться в сравнение можно всегда — это новая база
  await desk.switchMode(SHOP, 'shadow', 'owner');
  await assert.rejects(desk.switchMode(SHOP, 'shadow', 'owner'), /Сравнение уже идёт/);
});

test('an order from an organization is recognised by its legal form', () => {
  for (const client of ['ООО «СтройМонтаж»', 'ИП Петров', 'АО "Завод"', 'Строительная компания']) assert.ok(Order.fromOrganization(client), client);
  for (const client of ['Иван Петров', 'Аоки', 'Сергей']) assert.ok(!Order.fromOrganization(client), client);
});

// ---------- контракты ----------

test('table@1 passes multiline fields to /meta; backbone files are admin-only', async () => {
  const app = express();
  app.use(express.json());
  app.use('/c', Components({
    t: Table({
      rows: () => [],
      columns: [{ key: 'id', name: 'id' }],
      actions: [{ id: 'attach', name: 'Приложить', bulk: true, max: 1, fields: [{ key: 'invoice', label: 'Строки', required: true, multiline: true }], run: async () => ({}) }],
    }),
  }));
  app.use('/api/backbone', require('../server/routes/backbone'));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const meta = await (await fetch(`${base}/c/t/meta`)).json();
    assert.deepEqual(meta.actions[0].fields, [{ key: 'invoice', label: 'Строки', required: true, multiline: true }]);
    assert.equal((await fetch(`${base}/api/backbone/files/invoice/x.xlsx`)).status, 401, 'без входа');
    assert.equal((await fetch(`${base}/api/backbone/c/summary/rows`)).status, 401);
  } finally {
    server.close();
  }
});
