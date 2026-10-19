// Разбор заявки, UX 18.10.2026 (docs/backbone-architecture.md §6.5–6.6, §7): тумблер
// «Выключен / Сравнение / Помощь», «Помощь» без меры — подтверждением, карточка заявки
// «две колонки» (текст покупателя и как понял помощник), честное сравнение — черновик
// только после счёта менеджера, «До и после» простыми словами; контракты switch@1 и extract@1.

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
const { Catalog, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { OrderToInvoice } = require('../server/services/backbone/invoice/OrderToInvoice');
const { InvoiceDraft } = require('../server/services/backbone/invoice/InvoiceDraft');
const { StockCheck } = require('../server/services/backbone/invoice/StockCheck');
const { Match, Matches } = require('../server/services/backbone/invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('../server/services/backbone/invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer, anchorText } = require('../server/services/backbone/invoice/RequestText');
const { InvoiceExport } = require('../server/services/backbone/invoice/InvoiceExport');
const { FinalInvoice, pairLines } = require('../server/services/backbone/invoice/FinalInvoice');
const { RecordedLlm } = require('../server/services/backbone/invoice/models');
const { Measures } = require('../server/services/backbone/measures/Measures');
const { WorkingHours } = require('../server/services/backbone/measures/WorkingHours');
const { Baseline } = require('../server/services/backbone/measures/Baseline');
const { OwnerBrief } = require('../server/services/backbone/measures/OwnerBrief');
const { Components } = require('../server/components');
const { Switch } = require('../server/components/switch');
const { Extract } = require('../server/components/extract');
const { KNOWN_BLOCKS } = require('../server/components/pages');

const FIXTURES = path.join(__dirname, '..', 'server', 'services', 'backbone', 'invoice', 'fixtures');
const REQUEST_20 = fs.readFileSync(path.join(FIXTURES, 'request-20.txt'), 'utf8');
const RECORDED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-llm.json'), 'utf8'));
const SHOP = 'test-shop';
const HOURS = { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' };
const msk = (local) => new Date(`${local}+03:00`);

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

function makeDesk(start, { mode = 'shadow', autoParse = false, llm = new RecordedLlm(RECORDED) } = {}) {
  const clock = { now: start };
  const journal = new MemoryJournal({ clock: () => clock.now });
  const desk = new BackboneDesk({
    repository: new MemoryRepository(journal), journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { [SHOP]: { name: 'Тест', niche: 'hardware', hours: HOURS, mode } },
    tool, llm, autoParse,
    measuresOf: (shop, spec) => new Measures(new WorkingHours({ tz: shop.tz, ...spec.hours })),
    baseline: new Baseline({ shadowDays: 14, accuracy: 0.8, minLines: 20 }),
    clock: () => clock.now,
  });
  return { desk, journal, clock };
}

// Табличная часть счёта, как её копирует 1С: № — Артикул — Товары — Кол-во — Ед. — Цена — Сумма.
function invoiceFrom1C(rows) {
  const lines = rows.map(([sku, qty], i) => {
    const item = catalog.bySku(sku);
    const money = (x) => x.toFixed(2).replace('.', ',');
    return [i + 1, sku, item.name, qty, item.unit, money(item.price), money(item.price * qty)].join('\t');
  });
  return ['№\tАртикул\tТовары (работы, услуги)\tКол-во\tЕд.\tЦена\tСумма', ...lines].join('\n');
}

// Черновик демо-заявки без синонимов (как в backbone-measures.test.js).
const DRAFT_20 = [
  ['B933-10x50-ZN', 100], ['N934-10-ZN', 200], ['W125-10-ZN', 200], ['SW-4.5x60-YZ', 1000], ['SR-4.8x35-RAL8017', 250],
  ['AK-8x75', 37], ['DP-6x40', 200], ['ST975-12-ZN', 10], ['HC-20-32', 30], ['BV-1-2-ВР-ВР', 5], ['FH-60-GS', 4],
  ['PP-PIPE-25', 12], ['PP-MF-25', 10], ['FUM-19x15', 5], ['NL-3x70', 5], null, ['SP-4.2x16-D', 500], ['DG-6x60', 300],
  ['N985-8-ZN', 100], ['B933-8x40-ZN', 100],
];

// ---------- тумблер ----------

test('toggle: «off» is board only — no parsing, no drafts, no invoice; switching back is an event like mode_changed', async () => {
  const { desk, journal, clock } = makeDesk(msk('2026-10-12T10:00'));
  const off = await desk.switchMode(SHOP, 'off', 'owner');
  assert.deepEqual([off.from, off.to, off.reason], ['shadow', 'off', 'разбор выключен: только доска']);
  clock.now = msk('2026-10-12T10:05');
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');
  await assert.rejects(desk.parseOrder(SHOP, order.id, { actor: 'm' }), /Разбор выключен/);
  await assert.rejects(desk.attachInvoice(SHOP, order.id, invoiceFrom1C([['N934-10-ZN', 200]]), { actor: 'm' }), /Разбор выключен/);
  await assert.rejects(desk.exportInvoice(SHOP, order.id, 'm'), /Разбор выключен/);
  await assert.rejects(desk.switchMode(SHOP, 'off', 'owner'), /Разбор уже выключен/);
  await assert.rejects(desk.switchMode(SHOP, 'nope', 'owner'), /Неизвестный режим/);

  // «Помощь» из выключенного — замера «до» нет: вопрос, а не запрет
  clock.now = msk('2026-10-12T10:10');
  const err = await desk.switchMode(SHOP, 'help', 'owner').catch((e) => e);
  assert.equal(err.status, 409);
  assert.equal(err.warn, true);
  assert.match(err.message, /сравнение не шло — замера «до» нет\. Включить всё равно\?/);
  const help = await desk.switchMode(SHOP, 'help', 'owner', { confirm: true });
  assert.equal(help.unmeasured, true);
  const changes = (await journal.history((await desk.shop(SHOP)).id)).filter((e) => e.type === 'mode_changed');
  assert.deepEqual(changes.map((e) => [e.data.from, e.data.to, Boolean(e.data.unmeasured)]), [['shadow', 'off', false], ['off', 'help', true]]);

  // заявки при выключенном разборе — ни «до», ни «после»
  const { report } = await desk.measures(SHOP);
  assert.deepEqual([report.cards[0].mode, report.before.orders, report.after.orders], ['off', 0, 0]);
});

test('toggle: help without the measure asks first; with a confirmation it is on and marked «without the measure»', async () => {
  const { desk } = makeDesk(msk('2026-10-12T10:00'));
  const err = await desk.switchMode(SHOP, 'help', 'owner').catch((e) => e);
  assert.equal(err.warn, true);
  assert.match(err.message, /сравнение идёт 0 дн\. из 14/);
  assert.equal((await desk.shop(SHOP)).mode, 'shadow', 'без подтверждения режим не меняется');
  const r = await desk.switchMode(SHOP, 'help', 'owner', { confirm: true });
  assert.deepEqual([r.to, r.unmeasured, r.snapshot.comparedLines], ['help', true, 0]);
  assert.equal((await desk.shop(SHOP)).mode, 'help');
});

// ---------- карточка «две колонки» и честное сравнение ----------

test('card in comparison: no draft before the manager invoice; after «my invoice is ready» — pairs, extra lines, manager vs helper time', async () => {
  const { desk, journal, clock } = makeDesk(msk('2026-10-12T10:00')); // понедельник
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');

  let card = await desk.orderCard(SHOP, order.id);
  assert.deepEqual([card.drafted, card.lines.length, card.sent], [false, 0, null]);
  assert.equal(card.text.join('\n'), REQUEST_20.replace(/\r\n?/g, '\n').trimEnd()); // текст покупателя целиком

  await desk.parseOrder(SHOP, order.id, { actor: 'm' }); // помощник разобрал тихо
  card = await desk.orderCard(SHOP, order.id);
  assert.deepEqual([card.drafted, card.lines.length], [true, 0], 'в сравнении до счёта строк в ответе нет вовсе');
  assert.ok(card.helperMs >= 0);
  await assert.rejects(desk.pickCandidate(SHOP, order.id, 'x', 'y', 'm'), /Сравнение/);
  await assert.rejects(desk.acceptConfident(SHOP, order.id, 'm'), /Сравнение/);

  clock.now = msk('2026-10-12T10:40');
  const final = DRAFT_20.filter((x) => x && !['AK-8x75', 'NL-3x70', 'FUM-19x15'].includes(x[0]))
    .concat([['AK-8x75', 50], ['NL-3x70-ZN', 5], ['SW-3.5x35-YZ', 400]]);
  const attached = await desk.attachInvoice(SHOP, order.id, invoiceFrom1C(final), { actor: 'm' });
  assert.deepEqual([attached.matched, attached.base, attached.invoiceLines.length], [14, 25, 19]); // механика: 17, 18 — «не разобрано»

  card = await desk.orderCard(SHOP, order.id);
  assert.equal(card.lines.length, 20);
  assert.equal(card.managerMinutes, 40);           // рабочие минуты от заявки до счёта
  assert.ok(card.helperMs >= 0);
  for (const l of card.lines) {
    if (l.anchors.length) assert.ok(card.text[l.anchors[0]].includes(l.source.trim()), `строка ${l.position} ведёт к своему месту в тексте`);
  }
  assert.ok(card.lines.every((l) => l.anchors.length === 1));
  const tone = (sku) => card.pairs.pairs[card.lines.findIndex((l) => l.sku === sku)];
  assert.equal(tone('B933-10x50-ZN').tone, 'same');
  assert.deepEqual([tone('AK-8x75').tone, tone('AK-8x75').final.qty], ['qty', 50]);
  assert.equal(tone('FUM-19x15').tone, 'none');
  assert.deepEqual(card.pairs.extra.map((f) => f.sku).sort(), ['DG-6x60', 'NL-3x70-ZN', 'SP-4.2x16-D', 'SW-3.5x35-YZ']);
  assert.equal(card.pairs.pairs.filter((p) => p.tone === 'same').length, attached.matched); // те же числа, что точность

  // время помощника — метрика замеров
  const { current } = await desk.measures(SHOP);
  assert.ok(current.helperMs >= 0);
  const parsed = (await journal.forSubject('order', order.id)).find((e) => e.type === 'parsed');
  assert.equal(typeof parsed.data.ms, 'number');

  // нейросеть в «Сравнении» — только после счёта; тогда же сверка с ним, и она точнее механики
  const read = await desk.readByModel(SHOP, order.id, { actor: 'm' });
  assert.deepEqual([read.invoice.matched, read.invoice.base], [17, 22]);
  card = await desk.orderCard(SHOP, order.id);
  assert.equal(card.reading.lines.length, 20);
  assert.equal(card.readingInvoice.pairs.filter((p) => p.tone === 'same').length, 17);
  assert.equal((await desk.measures(SHOP)).current.modelAccuracy.right, 17);
  await assert.rejects(desk.takeAllModel(SHOP, order.id, 'm'), /Сравнение/, 'в сравнении черновик не правят');
});

test('comparison: the neural network waits for the manager invoice, otherwise the «before» measure is spoiled', async () => {
  const { desk } = makeDesk(msk('2026-10-12T10:00'));
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');
  await assert.rejects(desk.readByModel(SHOP, order.id, { actor: 'm' }), /после вашего счёта/);
});

test('auto parse on arrival: mechanical, without the model — in help and comparison, not when off', async () => {
  const llm = new RecordedLlm(RECORDED);
  const { desk, journal } = makeDesk(msk('2026-10-12T10:00'), { mode: 'help', autoParse: true, llm });
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');
  const events = await journal.forSubject('order', order.id);
  assert.deepEqual(events.map((e) => e.type), ['received', 'parsed', 'draft_ready']);
  assert.deepEqual([events[1].actor, events[1].cause, events[1].data.model, events[1].data.raw], ['helper', 'auto', 0, 2]);
  assert.equal(llm.prompts.length, 0, 'модель сама не зовётся никогда');
  assert.equal((await desk.orderCard(SHOP, order.id)).lines.length, 20);

  await desk.switchMode(SHOP, 'off', 'owner');
  const quiet = await desk.createOrder(SHOP, { client: 'ИП Петров', text: 'Болт М10х50 — 100 шт' }, 'm');
  assert.deepEqual((await journal.forSubject('order', quiet.id)).map((e) => e.type), ['received']);
});

test('read by the neural network in help: the whole request, a third column next to the mechanics; take a line or take all', async () => {
  const llm = new RecordedLlm(RECORDED);
  const { desk, journal } = makeDesk(msk('2026-10-12T10:00'), { mode: 'help', autoParse: true, llm });
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');
  let card = await desk.orderCard(SHOP, order.id);
  assert.equal(card.advice.advise, true);
  assert.match(card.advice.reason, /не разобрано строк — 2.*Стоит распознать нейросетью/);
  await assert.rejects(desk.takeAllModel(SHOP, order.id, 'm'), /ещё не читала/);

  const read = await desk.readByModel(SHOP, order.id, { actor: 'm' });
  assert.deepEqual([read.model, read.accepted, read.missing], [20, 16, 0]);
  assert.ok(!llm.prompts[0].includes('+7 900'), 'контакты покупателя в модель не уходят');
  assert.ok(llm.prompts[0].includes('[1] 1. Болт DIN 933'), 'модель читает всю заявку, а не только остаток');

  card = await desk.orderCard(SHOP, order.id);
  const differ = card.readingPairs.filter((p) => p.base && p.line.sku && p.base.sku !== p.line.sku);
  assert.deepEqual(differ.map((p) => p.line.sku), ['SW-3.5x35-YZ', 'SP-4.2x16-D', 'DG-6x60']);
  const screw = differ[0];
  await desk.takeModelLine(SHOP, order.id, screw.line.position, 'm');
  await assert.rejects(desk.takeModelLine(SHOP, order.id, screw.line.position, 'm'), /так же/);
  const taken = await desk.takeAllModel(SHOP, order.id, 'm');
  assert.equal(taken.lines, 2);
  await assert.rejects(desk.takeAllModel(SHOP, order.id, 'm'), /Брать нечего/);

  const reviewed = (await journal.forSubject('order', order.id)).filter((e) => e.type === 'reviewed');
  assert.ok(reviewed.length >= 3 && reviewed.every((e) => e.data.via === 'model'));
  assert.ok((await desk.synonymsOf(SHOP)).some((s) => s.phrase === 'шуруп по дереву 3.5×35' && s.sku === 'SW-3.5x35-YZ'), 'нейросеть учит механику');
  const after = await desk.orderCard(SHOP, order.id);
  assert.equal(after.lines.filter((l) => l.state === 'missing').length, 0); // три «нет в каталоге» механики закрыты нейросетью
});

test('ambiguous line: three best variants with what differs, «more» folded, a question to the client from the difference', async () => {
  const { desk, journal } = makeDesk(msk('2026-10-12T10:00'), { mode: 'help', autoParse: true });
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: 'Саморез по дереву 3,5 — 200 шт\nБолт М8х40 — 100 шт' }, 'm');
  const card = await desk.orderCard(SHOP, order.id);
  const [screw, bolt] = card.lines;
  const alts = card.choices.get(screw.id);
  assert.deepEqual(alts.top.map((c) => c.differs), ['3,5×16', '3,5×20', '3,5×25']);
  assert.equal(alts.more.length, alts.total - 3);
  assert.ok(alts.more.some((c) => c.differs === '3,5×35'));
  assert.equal(alts.question, '«Саморез по дереву 3,5»: какой размер — 3,5×16, 3,5×20 или 3,5×25?');
  assert.equal(card.choices.get(bolt.id).question, '«Болт М8х40»: какой вариант — кл. 8.8 оцинк. или нерж. A2?');

  const asked = await desk.askClient(SHOP, order.id, screw.id, 'm');
  assert.equal(asked.question, alts.question);
  await assert.rejects(desk.askClient(SHOP, order.id, screw.id, 'm'), /уже в вопросах/);
  const [line] = await desk.orderCard(SHOP, order.id).then((c) => c.lines);
  assert.ok(line.question.includes('какой размер'));
  assert.equal((await journal.forSubject('order', order.id)).at(-1).type, 'client_asked');

  // вариант из «ещё N» тоже выбирается и рождает синоним
  const far = alts.more.find((c) => c.differs === '3,5×35').sku;
  const picked = await desk.pickCandidate(SHOP, order.id, screw.id, far, 'm');
  assert.equal(picked.synonyms, 1);
});

test('card in help: the draft at once; pick a candidate, accept everything green, then the invoice', async () => {
  const { desk, journal } = makeDesk(msk('2026-10-12T10:00'), { mode: 'help' });
  const order = await desk.createOrder(SHOP, { client: 'ООО «Стройка»', text: REQUEST_20 }, 'm');
  await desk.parseOrder(SHOP, order.id, { actor: 'm' });
  const card = await desk.orderCard(SHOP, order.id);
  assert.equal(card.lines.length, 20);
  assert.ok(card.lines.every((l) => l.origin !== 'model'), 'черновик — механический');

  const ask = card.lines.find((l) => l.state === 'ask' && l.candidates.length > 1);
  const other = ask.candidates.find((c) => c.sku !== ask.sku).sku;
  await assert.rejects(desk.pickCandidate(SHOP, order.id, ask.id, 'NO-SUCH', 'm'), /не вариант/);
  const picked = await desk.pickCandidate(SHOP, order.id, ask.id, other, 'm');
  assert.equal(picked.synonyms, 1);
  const green = card.lines.filter((l) => l.state === 'accepted').length;
  const accepted = await desk.acceptConfident(SHOP, order.id, 'm');
  assert.equal(accepted.lines, green); // выбранный кандидат уже отмечен менеджером — второй раз не принимается
  await assert.rejects(desk.acceptConfident(SHOP, order.id, 'm'), /не осталось/);

  const reviewed = (await journal.forSubject('order', order.id)).filter((e) => e.type === 'reviewed');
  assert.equal(reviewed[0].data.verdict, 'replaced');
  assert.ok(reviewed.slice(1).every((e) => e.data.verdict === 'accepted'));
  const sent = await desk.invoiceSent(SHOP, order.id, 'm');
  assert.equal(sent.edited, 1);
  const after = await desk.orderCard(SHOP, order.id);
  assert.equal(after.sent.mode, 'help');
  assert.equal(after.pairs, null);
});

test('whole request: what the model did not answer stays with the rules; contacts never reach it; a broken model leaves the mechanics', async () => {
  const text = 'Здравствуйте!\nБолт М10х50 — 100 шт\nГайка М10 — 100 шт\nтел. +7 900 123-45-67';
  const partial = new RecordedLlm([{ match: '[1] Болт М10х50', text: { lines: [{ ref: 2, name: 'Гайка DIN 934 М10', qty: 100, unit: 'шт' }] } }]);
  const r = await tool.run({ text }, { llm: partial, whole: true });
  assert.deepEqual(r.draft.lines.map((l) => [l.origin, l.name]), [['rule', 'Болт М10х50'], ['model', 'Гайка DIN 934 М10']]);
  assert.equal(partial.prompts[0], '[1] Болт М10х50 — 100 шт\n[2] Гайка М10 — 100 шт');

  const broken = new RecordedLlm([{ match: 'Болт', error: { code: 'llm_busy', message: 'слоты заняты' } }]);
  const b = await tool.run({ text }, { llm: broken, whole: true });
  assert.deepEqual([b.facts.model, b.draft.lines.map((l) => l.origin), b.failures[0].code], [0, ['rule', 'rule'], 'llm_busy']);
  const plain = await tool.run({ text }, {});
  assert.deepEqual([plain.failures, plain.facts.modelCalls], [[], 0], 'механика без модели — не сбой');
});

test('anchors: each draft line finds its place; the same line twice goes to its own place, not twice to the first', () => {
  const { lines, anchors } = anchorText('Здравствуйте!\r\nБолт М8 - 10 шт; Гайка М8 - 10 шт\n\nБолт М8 - 10 шт\n\n', ['Болт М8 - 10 шт', ' Гайка М8 - 10 шт', 'Болт М8 - 10 шт', 'нет такого']);
  assert.deepEqual(lines, ['Здравствуйте!', 'Болт М8 - 10 шт; Гайка М8 - 10 шт', '', 'Болт М8 - 10 шт']);
  assert.deepEqual(anchors, [[1], [1], [3], []]);
});

test('pairs: same position and quantity, then the same position with another quantity; the rest — not in the invoice / only in it', () => {
  const draft = [{ sku: 'A', invoice_qty: 10 }, { sku: 'B', invoice_qty: 5 }, { sku: null, invoice_qty: null }, { sku: 'C', invoice_qty: 1 }];
  const { pairs, extra } = pairLines(draft, [{ sku: 'B', qty: 7 }, { sku: 'A', qty: 10 }, { sku: 'D', qty: 2 }]);
  assert.deepEqual(pairs.map((p) => p.tone), ['same', 'qty', 'none', 'none']);
  assert.deepEqual(extra, [{ sku: 'D', qty: 2 }]);
});

// ---------- «До и после» простыми словами ----------

test('owner brief: comparison, help and off in plain phrases — minutes, helper seconds, accuracy, what is missing', () => {
  const brief = new OwnerBrief();
  const metrics = (over = {}) => ({
    orders: 0, invoiceMinutes: null, managerMinutes: null, helperMs: null,
    shadowAccuracy: { value: null, right: 0, base: 0, orders: 0 }, untouched: { value: null, right: 0, base: 0, orders: 0 }, ...over,
  });

  const shadow = brief.of({
    shop: { mode: 'shadow' }, days: 14, shadowDays: 14,
    current: metrics({ orders: 9, invoiceMinutes: 34.2, helperMs: 2800, shadowAccuracy: { value: 0.82, right: 41, base: 50, orders: 3 } }),
    decision: { ok: true, reason: 'точность 0,82' },
  });
  assert.deepEqual(shadow.lines, [
    'Сравнение идёт 2 недели: заявок — 9, ваших счетов приложено — 3.',
    'Вы тратите на счёт в среднем 34 мин рабочего времени — от заявки до счёта.',
    'Помощник готовит черновик за 2,8 с.',
    'Точность черновика — 82 %: совпало 41 из 50 строк с вашими счетами.',
    'Мера набрана — можно переходить в «Помощь».',
  ]);
  assert.deepEqual(shadow.cta, { value: 'help', name: 'Перейти в «Помощь»' });

  const early = brief.of({ shop: { mode: 'shadow' }, days: 0, current: metrics(), decision: { ok: false, reason: 'сравнение идёт 0 дн. из 14' } });
  assert.match(early.lines[0], /^Сравнение идёт первый день/);
  assert.match(early.lines.at(-1), /Мера для «Помощи» ещё не набрана: сравнение идёт 0 дн\. из 14\. Перейти можно и сейчас/);

  const help = brief.of({
    shop: { mode: 'help' },
    report: {
      before: metrics({ invoiceMinutes: 34, shadowAccuracy: { value: 0.82, right: 41, base: 50, orders: 3 } }),
      after: metrics({ invoiceMinutes: 9, managerMinutes: 5, untouched: { value: 0.95, right: 19, base: 20, orders: 1 } }),
    },
    switched: { data: { to: 'help', reason: 'сравнено строк: 6 из нужных 20', unmeasured: true, snapshot: { days: 14 } } },
  });
  assert.deepEqual(help.lines, [
    'За 2 недели сравнения вы тратили на счёт 34 мин, с помощником — 9 мин; точность черновика 82 %.',
    'Экономия — 25 мин на каждой заявке.',
    'Без правки уходит 95 % строк черновика (19 из 20).',
    'Ваша работа над черновиком — 5 мин на заявку.',
    '«Помощь» включили до полной меры (сравнено строк: 6 из нужных 20) — цифры «до» неполные.',
  ]);
  assert.equal(help.cta, null);

  const off = brief.of({ shop: { mode: 'off' }, shadowDays: 14, report: { before: metrics() } });
  assert.match(off.lines[0], /Разбор выключен/);
  assert.deepEqual(off.cta, { value: 'shadow', name: 'Включить «Сравнение»' });
});

// ---------- контракты switch@1 и extract@1 ----------

async function serve(components) {
  const app = express();
  app.use(express.json());
  app.use('/c', Components(components));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/c`;
  const call = async (url, body) => {
    const res = await fetch(`${base}${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  };
  return { call, close: () => server.close() };
}

test('switch@1: state with options, phrases and a call to action; the domain may ask for a confirmation instead of refusing', async () => {
  let value = 'b';
  const { call, close } = await serve({
    mode: Switch({
      title: 'Тумблер',
      state: () => ({ value, options: [{ value: 'a', name: 'А' }, { value: 'b', name: 'Б', note: 'сейчас' }, { value: 'c', name: 'В' }], lines: ['фраза'], cta: { value: 'c', name: 'В!' }, hint: 'подсказка' }),
      set: ({ value: to, confirm }) => {
        if (to === 'c' && !confirm) return { confirm: 'точно?' };
        value = to;
        return { message: `теперь ${to}` };
      },
    }),
  });
  try {
    assert.deepEqual((await call('/mode/meta')).body, { ok: true, kind: 'switch', version: 1, title: 'Тумблер' });
    const state = (await call('/mode/state')).body;
    assert.deepEqual([state.value, state.options.length, state.lines, state.cta.value, state.hint], ['b', 3, ['фраза'], 'c', 'подсказка']);
    assert.deepEqual((await call('/mode/set', { value: 'c' })).body.result, { confirm: 'точно?' });
    assert.equal(value, 'b');
    assert.deepEqual((await call('/mode/set', { value: 'c', confirm: true })).body.result, { message: 'теперь c' });
    assert.equal(value, 'c');
    assert.equal((await call('/mode/set', { value: 'z' })).status, 400, 'положения нет среди вариантов');
  } finally {
    close();
  }
});

test('extract@1: the source and several readings; closed and peek; only the actions a column allows run, item actions check tone, item list and variants', async () => {
  const runs = [];
  let state = 'closed';
  const { call, close } = await serve({
    card: Extract({
      title: 'Разбор',
      legend: { ok: 'да', ask: 'выбрать', miss: 'нет' },
      view: ({ key }) => ({
        title: `Ключ ${key}`,
        facts: [{ label: 'Строк', value: 2 }, { label: 'Пусто', value: null }],
        source: { title: 'Источник', lines: ['раз', 'два'] },
        results: [
          {
            id: 'a',
            title: 'Понято правилами',
            state,
            reason: 'закрыто до счёта',
            peek: 'Показать',
            items: state === 'closed' ? [] : [
              { id: 'i1', text: 'Первый', tone: 'ok', anchors: [0, 9], pair: { text: 'совпало', tone: 'same' } },
              { id: 'i2', text: 'Второй', tone: 'ask', anchors: [1], tag: 'модель', choices: [{ value: 'x', text: 'X', note: 'длина 25' }], more: [{ value: 'y', text: 'Y', note: 'длина 35' }] },
            ],
            extra: state === 'closed' ? [] : [{ text: 'только в эталоне', tone: 'diff' }],
            actions: state === 'closed' ? ['open'] : ['pick', 'unknown'],
          },
          {
            id: 'b',
            title: 'Понято моделью',
            state: 'open',
            hint: 'стоит позвать модель',
            items: [
              { id: 'm1', text: 'Иначе', tone: 'ok', anchors: [1], actions: ['take'] },
              { id: 'm2', text: 'Так же', tone: 'ok', anchors: [0], actions: [] },
            ],
            actions: ['take'],
          },
        ],
      }),
      actions: [
        { id: 'open', name: 'Открыть', fields: [{ key: 'text', label: 'Текст', required: true, multiline: true }], run: ({ body }) => { runs.push(['open', body.text]); state = 'peek'; return { message: 'открыто' }; } },
        { id: 'pick', name: 'Выбрать', scope: 'item', tones: ['ask'], choose: true, run: ({ item, value }) => { runs.push(['pick', item, value]); return { message: 'выбрано' }; } },
        { id: 'take', name: 'Взять', scope: 'item', run: ({ item }) => { runs.push(['take', item]); return { message: 'взято' }; } },
      ],
    }),
  });
  try {
    const meta = (await call('/card/meta')).body;
    assert.deepEqual([meta.kind, meta.legend.ask, meta.actions.map((a) => [a.id, a.scope])], ['extract', 'выбрать', [['open', 'all'], ['pick', 'item'], ['take', 'item']]]);
    assert.deepEqual(meta.actions[0].fields, [{ key: 'text', label: 'Текст', required: true, multiline: true }]);

    let view = (await call('/card/view?key=7')).body;
    assert.deepEqual([view.title, view.facts, view.results.length], ['Ключ 7', [{ label: 'Строк', value: '2' }], 2]);
    assert.deepEqual([view.results[0].state, view.results[0].items, view.results[0].actions], ['closed', [], ['open']]);
    assert.equal(view.results[1].hint, 'стоит позвать модель');
    assert.equal((await call('/card/view')).status, 400, 'без ключа');
    assert.equal((await call('/card/actions/pick', { key: '7', item: 'i2', value: 'x' })).status, 400, 'действия нет ни в одной колонке');
    assert.equal((await call('/card/actions/open', { key: '7' })).status, 400, 'обязательное поле пусто');
    assert.deepEqual((await call('/card/actions/open', { key: '7', text: 'счёт' })).body.result, { message: 'открыто' });

    view = (await call('/card/view?key=7')).body;
    const [a] = view.results;
    assert.deepEqual([a.state, a.peek, a.actions], ['peek', 'Показать', ['pick']]);
    assert.deepEqual(a.items[0].anchors, [0], 'ссылка за пределы источника отброшена');
    assert.deepEqual([a.items[1].tag, a.items[1].choices[0].note, a.items[1].more[0].value, a.extra[0].tone], ['модель', 'длина 25', 'y', 'diff']);
    assert.equal((await call('/card/actions/pick', { key: '7', item: 'i1', value: 'x' })).status, 400, 'не тот тон');
    assert.equal((await call('/card/actions/pick', { key: '7', item: 'i2', value: 'z' })).status, 400, 'нет такого варианта');
    assert.equal((await call('/card/actions/pick', { key: '7', item: 'i9', value: 'x' })).status, 400, 'нет такого пункта');
    assert.deepEqual((await call('/card/actions/pick', { key: '7', item: 'i2', value: 'y' })).body.result, { message: 'выбрано' }, 'вариант из «ещё N»');
    assert.equal((await call('/card/actions/take', { key: '7', item: 'm2' })).status, 400, 'у пункта своего действия нет');
    assert.equal((await call('/card/actions/take', { key: '7', item: 'i2' })).status, 400, 'пункт не из колонки этого действия');
    assert.deepEqual((await call('/card/actions/take', { key: '7', item: 'm1' })).body.result, { message: 'взято' });
    assert.deepEqual(runs, [['open', 'счёт'], ['pick', 'i2', 'y'], ['take', 'm1']]);
  } finally {
    close();
  }
});

test('boot@1 knows the new blocks; the cabinet spec puts the toggle on the orders screen and the card on its own page', () => {
  assert.ok(KNOWN_BLOCKS.has('switch@1') && KNOWN_BLOCKS.has('extract@1'));
  const { SHOP_PAGES } = require('../server/services/backbone/pages');
  assert.ok(SHOP_PAGES.includes('order'));
  const boot = fs.readFileSync(path.join(__dirname, '..', 'public', 'c', 'boot.js'), 'utf8');
  assert.match(boot, /'switch@1':/);
  assert.match(boot, /'extract@1':/);
});
