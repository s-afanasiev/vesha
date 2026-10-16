// Костяк MVP, шаг 2: конвейер разбора заявки в счёт (docs/backbone-architecture.md §4, §6.5).
// Модель — заместитель RecordedLlm; квота — настоящий runGuarded; база — двойник в памяти.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { Catalog, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const { Synonyms } = require('../server/services/backbone/catalog/Synonyms');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { OrderToInvoice } = require('../server/services/backbone/invoice/OrderToInvoice');
const { InvoiceDraft } = require('../server/services/backbone/invoice/InvoiceDraft');
const { StockCheck } = require('../server/services/backbone/invoice/StockCheck');
const { Match, Matches } = require('../server/services/backbone/invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('../server/services/backbone/invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');
const { GuardedLlm, RecordedLlm } = require('../server/services/backbone/invoice/models');
const { __test: guardInternals } = require('../server/services/llmGuard');
const { Components } = require('../server/components');
const { Table } = require('../server/components/table');

const FIXTURES = path.join(__dirname, '..', 'server', 'services', 'backbone', 'invoice', 'fixtures');
const REQUEST_20 = fs.readFileSync(path.join(FIXTURES, 'request-20.txt'), 'utf8');
const RECORDED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-llm.json'), 'utf8'));
const SHOP = 'test-shop';

const catalog = new Catalog(
  new CsvFeed(path.join(__dirname, '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv')),
  new CatalogIndex({ attributes: hardwareAttributes }),
);

function makeTool() {
  return new OrderToInvoice(new InvoiceDraft(
    new StockCheck(catalog, { pack: 'ask' }),
    new Matches(new Match(catalog.index, { autoAccept: 0.9, ask: 0.6, defaultCoating: hardwareAttributes.defaultCoating })),
    new Lines(new RuleLines(), new ModelLines({ verify: digitsInSource })),
    new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }),
  ), { maxLines: 200 });
}

function makeDesk(llm = new RecordedLlm(RECORDED)) {
  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { [SHOP]: { name: 'Тест', niche: 'hardware' } }, tool: makeTool(), llm,
  });
  return { desk, journal, repository, llm };
}

const byPos = (lines, position) => lines.find((l) => l.position === position);

// ---------- файлы заявки: xlsx и pdf собираются здесь же, без внешних библиотек ----------

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(zlib.crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(zlib.crc32(raw), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Лист: строки как в выгрузке снабженца — шапка, номер, наименование, количество, единица.
function xlsxOf(rows) {
  const strings = [];
  const sid = (s) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => (typeof v === 'number'
    ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`)).join('')}</row>`).join('');
  return zip([
    ['xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Заявка" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`, true],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`, true],
  ]);
}

// PDF с текстовым слоем: Helvetica + Differences с именами глифов кириллицы (afii…).
function glyph(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x410 && cp <= 0x415) return `afii${10017 + cp - 0x410}`;
  if (cp >= 0x416 && cp <= 0x42f) return `afii${10018 + cp - 0x410}`;
  if (cp >= 0x430 && cp <= 0x435) return `afii${10065 + cp - 0x430}`;
  if (cp >= 0x436 && cp <= 0x44f) return `afii${10066 + cp - 0x430}`;
  return { '—': 'emdash', '×': 'multiply' }[ch];
}

function pdfOf(lines) {
  const codes = new Map();
  const enc = (s) => [...s].map((ch) => {
    if (ch.charCodeAt(0) < 128) return ch === '(' || ch === ')' || ch === '\\' ? `\\${ch}` : ch;
    if (!codes.has(ch)) codes.set(ch, 128 + codes.size);
    return `\\${codes.get(ch).toString(8)}`;
  }).join('');
  const content = lines.length ? `BT /F1 12 Tf 50 800 Td ${lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${enc(l)}) Tj`).join(' ')} ET` : '';
  const diffs = [...codes].map(([ch, code]) => `${code} /${glyph(ch)}`).join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${diffs}] >> >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- CatalogIndex: атрибуты из наименований ----------

test('catalog index reads size, standard, grade and coating; spellings of one size meet', () => {
  const index = catalog.index;
  const bolt = index.parse('Болт DIN 933 М10×50 кл. 8.8 оцинк.');
  assert.deepEqual(bolt, { kind: 'болт', dims: ['10', '50'], standard: 'din933', grade: '8.8', coating: 'zn', words: [] });
  for (const spelling of ['болты m10x50', 'Болт М10х50', 'болт м10 * 50', 'Болт M10 × 50']) {
    assert.deepEqual(index.parse(spelling).dims, ['10', '50'], spelling);
  }
  assert.deepEqual(index.parse('Саморез по дереву 4,2х19 желт.').dims, ['4.2', '19']);
  assert.equal(index.parse('Саморез по дереву 4,2х19 жёлтый цинк').coating, 'yz');
  assert.equal(index.parse('Саморез кровельный 4,8×35 RAL 8017').coating, 'ral8017');
  assert.deepEqual(index.parse('Кран шаровой 1/2" нр/вр').words, ['шаров', 'вр-нр']);
  assert.equal(index.parse('гроверная шайба м8').kind, 'шайба');

  // каждая из 300 позиций распознана, и двух одинаковых наборов атрибутов нет
  const signatures = new Set();
  for (const { item, attrs } of index.entries) {
    assert.ok(attrs.kind, item.name);
    signatures.add(JSON.stringify(attrs));
  }
  assert.equal(signatures.size, 300);
});

test('match: full spec is accepted, a missing coating asks with candidates, an unknown size is missing', () => {
  const match = new Match(catalog.index, { autoAccept: 0.9, ask: 0.6, defaultCoating: 'zn' });
  const full = match.of({ name: 'Болт DIN 933 М10х50 кл.8.8 оцинк.' });
  assert.equal(full.state, 'accepted');
  assert.equal(full.sku, 'B933-10x50-ZN');

  const vague = match.of({ name: 'Болт М8х40' });
  assert.equal(vague.state, 'ask');
  assert.deepEqual(vague.candidates.map((c) => c.sku), ['B933-8x40-ZN', 'B933-8x40-A2']);
  assert.equal(vague.sku, 'B933-8x40-ZN'); // первый кандидат предложен, но не принят молча

  const none = match.of({ name: 'Болт М14х70' });
  assert.equal(none.state, 'missing');
  assert.equal(none.sku, null);

  const learned = match.of({ name: 'Шуруп по дереву 3,5х35' }, new Synonyms([{ phrase: Synonyms.phrase('шуруп по дереву 3.5x35'), sku: 'SW-3.5x35-YZ' }]));
  assert.deepEqual([learned.sku, learned.state, learned.via], ['SW-3.5x35-YZ', 'accepted', 'synonym']);
});

// ---------- RuleLines и ModelLines ----------

test('rule lines read «name — qty unit» forms; greetings and requisites are skipped', () => {
  const { lines, rest, skipped } = new RuleLines().of([
    'Здравствуйте! Прошу выставить счёт на:',
    '1. Болт М10х50 — 100 шт',
    '- Гайка М10: 200',
    '100 шт. шайба М10',
    'Труба ПП 25 мм 12 м',
    'Болт М10х50 — 100 шт., гайка М10 — 100 шт.',
    'Хомут червячный 20–32',
    'тел. +7 900 123-45-67',
    'Номер\tНаименование\tКол-во',
    '2\tДюбель распорный 6х40\t2\tуп',
  ]);
  const got = lines.map((l) => [l.name, l.qty, l.unit]);
  assert.deepEqual(got, [
    ['Болт М10х50', 100, 'шт'],
    ['Гайка М10', 200, null],
    ['шайба М10', 100, 'шт'],
    ['Труба ПП 25 мм', 12, 'м'],
    ['Болт М10х50', 100, 'шт'],
    ['гайка М10', 100, 'шт'],
    ['Дюбель распорный 6х40', 2, 'уп'],
  ]);
  assert.deepEqual(rest.map((r) => r.source), ['Хомут червячный 20–32', 'Номер\tНаименование\tКол-во']);
  assert.equal(skipped.length, 2);
});

test('model lines: digits are checked against the source line, foreign refs are dropped', async () => {
  const llm = new RecordedLlm([{
    match: 'штук пятьсот',
    text: { lines: [
      { ref: 3, name: 'Саморез 4,2×16 со сверлом', qty: 500, unit: 'шт' },
      { ref: 4, name: 'Дюбель-гвоздь 6×60', qty: 300, unit: 'штук' },
      { ref: 99, name: 'Выдуманная позиция 1×1', qty: 1, unit: 'шт' },
    ] },
  }]);
  const out = await new ModelLines().of([
    { ref: 3, source: 'саморезы 4,2 на 16 со сверлом, штук пятьсот' },
    { ref: 4, source: 'дюбель-гвоздь 6 на 60, 300 штук нужно' },
    { ref: 5, source: 'и ещё 7 позиций как в прошлый раз' },
  ], { llm });
  assert.equal(out.calls, 1);
  assert.deepEqual(out.lines.map((l) => [l.ref, l.unit, l.verify]), [[3, 'шт', 'цифры не из текста: 500'], [4, 'шт', null]]);
  assert.equal(out.failures[0].code, 'model_foreign_line');
  assert.deepEqual(out.raw.map((r) => r.ref), [5]); // модель промолчала, а цифры есть — видно менеджеру
});

test('model call goes through runGuarded on behalf of the initiator; exhausted quota leaves lines unparsed, not lost', async () => {
  let seen = null;
  const llm = new GuardedLlm({ complete: async (opts) => { seen = opts; return { text: '{"lines":[]}' }; } });
  await llm.forActor({ id: 'invoice-quota-ok' }).complete([{ role: 'user', content: 'x' }]);
  assert.deepEqual(seen.selection, { provider: 'openai' }); // серверный пресет, ключа в коде нет
  assert.equal(seen.apiKey, undefined);

  guardInternals.buckets.set('user:invoice-quota-test', { startedAt: Date.now(), count: 1_000_000 });
  try {
    const out = await new ModelLines().of(
      [{ ref: 0, source: 'саморезы 4,2 на 16, штук пятьсот' }],
      { llm: new GuardedLlm({ complete: async () => assert.fail('модель не должна вызываться сверх квоты') }).forActor({ id: 'invoice-quota-test' }) },
    );
    assert.equal(out.failures[0].code, 'llm_rate_limit');
    assert.deepEqual(out.raw.map((r) => r.ref), [0]);
  } finally {
    guardInternals.buckets.delete('user:invoice-quota-test');
  }
});

// ---------- RequestText: текст, xlsx, pdf, скан ----------

test('request text reads xlsx rows and a pdf text layer; a scan is a named refusal, not OCR', async () => {
  const text = new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() });

  const sheet = await text.read({ file: { name: 'заявка.xlsx', data: xlsxOf([
    ['№', 'Наименование', 'Кол-во', 'Ед.'],
    [1, 'Болт DIN 933 М10х50 оцинк.', 100, 'шт'],
    [2, 'Дюбель распорный 6х40', 2, 'уп'],
  ]) } });
  assert.equal(sheet.kind, 'xlsx');
  assert.deepEqual(sheet.lines, ['1\tБолт DIN 933 М10х50 оцинк.\t100\tшт', '2\tДюбель распорный 6х40\t2\tуп']);

  const pdf = await text.read({ file: { name: 'заявка.pdf', data: pdfOf(['Болт DIN 933 М10х50 — 100 шт', 'Гайка М10 оцинк. — 200 шт']) } });
  assert.equal(pdf.kind, 'pdf');
  assert.deepEqual(pdf.lines, ['Болт DIN 933 М10х50 — 100 шт', 'Гайка М10 оцинк. — 200 шт']);

  await assert.rejects(text.read({ file: { name: 'скан.pdf', data: pdfOf([]) } }), (e) => e.refusal && e.code === 'scan');
  await assert.rejects(text.read({ file: { name: 'фото.jpg', data: Buffer.from('x') } }), (e) => e.code === 'scan');
  await assert.rejects(text.read({ file: { name: 'old.xls', data: Buffer.from('x') } }), (e) => e.code === 'unsupported');
  await assert.rejects(text.read({ text: '   ' }), (e) => e.code === 'empty');

  // xlsx доходит до черновика так же, как текст
  const tool = makeTool();
  const r = await tool.run({ file: { name: 'заявка.xlsx', data: xlsxOf([['Наименование', 'Кол-во'], ['Анкер клиновой 8х75', 37]]) } }, {});
  assert.equal(r.draft.kind, 'xlsx');
  assert.equal(r.draft.lines[0].sku, 'AK-8x75');
});

// ---------- StockCheck ----------

test('stock check: 37 at a pack of 50 is a question, not a silent rounding; packs and foreign units are explicit', () => {
  const stock = new StockCheck(catalog, { pack: 'ask' });
  const odd = stock.of({ sku: 'AK-8x75', qty: 37, unit: 'шт' });
  assert.equal(odd.invoiceQty, 37);
  assert.match(odd.question, /упаковка по 50: отгрузить 50 шт \(1 уп\.\)\?/);

  assert.deepEqual(stock.of({ sku: 'DP-6x40', qty: 2, unit: 'уп' }), { invoiceQty: 200, price: 0.96, sum: 192, question: null });
  const kg = stock.of({ sku: 'AK-8x75', qty: 5, unit: 'кг' });
  assert.equal(kg.invoiceQty, null);
  assert.match(kg.question, /в заявке 5 кг, позиция продаётся в шт/);
  assert.match(stock.of({ sku: 'N934-10-ZN', qty: 200, unit: 'шт' }).question, /нет в наличии/);
  assert.match(stock.of({ sku: 'FUM-19x15', qty: 5, unit: 'шт' }).question, /в наличии 1 шт из 5/);
  assert.equal(new StockCheck(catalog, { pack: 'any' }).of({ sku: 'AK-8x75', qty: 37, unit: 'шт' }).question, null);
});

// ---------- черновик целиком ----------

test('a request of 20 lines gives a draft with a confidence on every line', async () => {
  const llm = new RecordedLlm(RECORDED);
  const { draft, facts, failures } = await makeTool().run({ text: REQUEST_20 }, { llm, synonyms: new Synonyms() });
  assert.equal(draft.lines.length, 20);
  for (const line of draft.lines) {
    assert.ok(Number.isFinite(line.confidence) && line.confidence >= 0 && line.confidence <= 1, `строка ${line.position}`);
    assert.equal(line.state, line.confidence >= 0.9 ? 'accepted' : line.confidence >= 0.6 ? 'ask' : 'missing');
  }
  assert.deepEqual(failures, []);
  assert.equal(llm.prompts.length, 1); // модель — один вызов на две строки, которые не взяли правила
  assert.deepEqual([facts.rule, facts.model, facts.raw, facts.skipped], [18, 2, 0, 3]);
  assert.ok(facts.accepted >= 12 && facts.ask >= 2 && facts.missing >= 1, facts.summary);

  assert.equal(byPos(draft.lines, 1).sku, 'B933-10x50-ZN');
  assert.match(byPos(draft.lines, 6).question, /упаковка по 50/);              // анкер 37 шт
  assert.equal(byPos(draft.lines, 7).invoiceQty, 200);                          // 2 уп дюбелей
  assert.equal(byPos(draft.lines, 16).state, 'missing');                        // «шуруп по дереву» — синонима ещё нет
  assert.equal(byPos(draft.lines, 17).verify, 'цифры не из текста: 500');      // «штук пятьсот» — проверить
  assert.ok(byPos(draft.lines, 17).confidence < 0.9);
  assert.deepEqual([byPos(draft.lines, 18).origin, byPos(draft.lines, 18).state], ['model', 'accepted']);
  assert.equal(draft.totals.sum, Math.round(draft.lines.reduce((s, l) => s + (l.sum || 0), 0) * 100) / 100);
});

test('a clean list never calls the model; an unavailable model keeps the rest as unparsed lines', async () => {
  const tool = makeTool();
  const quiet = new RecordedLlm([]);
  await tool.run({ text: 'Болт М10х50 — 100 шт\nГайка М10 — 100 шт' }, { llm: quiet });
  assert.equal(quiet.prompts.length, 0);

  const down = new RecordedLlm([{ match: 'пятьсот', error: { code: 'llm_busy', message: 'слоты заняты' } }]);
  const r = await tool.run({ text: 'Болт М10х50 — 100 шт\nсаморезы 4,2 на 16, штук пятьсот' }, { llm: down });
  assert.deepEqual(r.draft.lines.map((l) => [l.origin, l.state]), [['rule', 'ask'], ['raw', 'missing']]);
  assert.equal(r.failures[0].code, 'llm_busy');
});

// ---------- дверь: разбор, правка, синоним, журнал ----------

test('parse an order: lines are stored, parsed and draft_ready go to the journal', async () => {
  const { desk, journal } = makeDesk();
  const order = await desk.createOrder(SHOP, { client: 'ООО Стройка', text: REQUEST_20 }, 'admin@test');
  const result = await desk.parseOrder(SHOP, order.id, { actor: 'admin@test', user: { id: 'u1' } });
  assert.equal(result.ok, true);
  assert.match(result.summary, /^20 строк/);
  const lines = await desk.draftLines(SHOP);
  assert.equal(lines.length, 20);
  assert.ok(lines.every((l) => l.number === order.number && Number.isFinite(l.confidence)));

  const events = await journal.forSubject('order', order.id);
  assert.deepEqual(events.map((e) => e.type), ['received', 'parsed', 'draft_ready']);
  assert.equal(events[1].data.lines, 20);
  assert.equal(events[2].data.lines, 20);

  const [summary] = await desk.drafts(SHOP);
  assert.equal(summary.lines, 20);
  assert.equal(summary.outcome.type, 'draft_ready');
});

test('a refused parse is a parse_failed event with a reason, the order stays as it was', async () => {
  const { desk, journal } = makeDesk();
  const order = await desk.createOrder(SHOP, { client: 'Без списка', text: 'Здравствуйте! Позвоните мне, пожалуйста.' }, 'admin@test');
  const result = await desk.parseOrder(SHOP, order.id, { actor: 'admin@test' });
  assert.deepEqual([result.ok, result.code], [false, 'no_lines']);
  const events = await journal.forSubject('order', order.id);
  assert.deepEqual(events.map((e) => e.type), ['received', 'parse_failed']);
  assert.equal(events[1].data.code, 'no_lines');
  assert.equal((await desk.draftLines(SHOP)).length, 0);
});

test('a manager replacing a line gives birth to a synonym: the next order finds the phrase itself', async () => {
  const { desk, journal } = makeDesk();
  const first = await desk.createOrder(SHOP, { client: 'ООО Стройка', text: REQUEST_20 }, 'admin@test');
  await desk.parseOrder(SHOP, first.id, { actor: 'admin@test' });
  const screw = byPos(await desk.draftLines(SHOP), 16);
  assert.equal(screw.state, 'missing');

  const r = await desk.review(SHOP, [screw.id], { verdict: 'replaced', sku: 'SW-3.5x35-YZ' }, 'manager@test');
  assert.deepEqual(r, { lines: 1, synonyms: 1 });
  const fixed = byPos(await desk.draftLines(SHOP), 16);
  assert.deepEqual([fixed.sku, fixed.state, fixed.review, fixed.confidence], ['SW-3.5x35-YZ', 'accepted', 'replaced', 1]);
  assert.equal(fixed.invoice_qty, 400);
  assert.equal(fixed.question, null); // 400 при упаковке по 200 — кратно

  const [synonym] = await desk.synonymsOf(SHOP);
  assert.deepEqual([synonym.phrase, synonym.sku, synonym.hits, synonym.example], ['шуруп по дереву 3.5×35', 'SW-3.5x35-YZ', 1, '16. Шуруп по дереву 3,5х35 — 400 шт']);
  const reviewed = (await journal.forSubject('order', first.id)).at(-1);
  assert.equal(reviewed.type, 'reviewed');
  assert.deepEqual(reviewed.data, { number: first.number, line: 16, verdict: 'replaced', from: null, to: 'SW-3.5x35-YZ', synonym: 'шуруп по дереву 3.5×35' });

  // другая заявка, та же фраза в другом написании — строка принята по синониму
  const second = await desk.createOrder(SHOP, { client: 'ИП Петров', text: 'шуруп по дереву 3.5x35 - 200 шт' }, 'admin@test');
  await desk.parseOrder(SHOP, second.id, { actor: 'admin@test' });
  const [line] = (await desk.draftLines(SHOP)).filter((l) => l.order_id === second.id);
  assert.deepEqual([line.sku, line.state, line.confidence], ['SW-3.5x35-YZ', 'accepted', 0.97]);

  // черновик с правкой не перезаписывается повторным разбором
  await assert.rejects(desk.parseOrder(SHOP, first.id, { actor: 'admin@test' }), (e) => e.status === 409);
});

test('accepting an «ask» line confirms a synonym; editing qty recomputes the pack question; bad edits are refused', async () => {
  const { desk } = makeDesk();
  const order = await desk.createOrder(SHOP, { client: 'ООО Стройка', text: REQUEST_20 }, 'admin@test');
  await desk.parseOrder(SHOP, order.id, { actor: 'admin@test' });
  const lines = await desk.draftLines(SHOP);

  const bolt = byPos(lines, 20);                       // «Болт М8х40» — выбрать из двух
  assert.equal(bolt.state, 'ask');
  const accepted = await desk.review(SHOP, [bolt.id, byPos(lines, 1).id], { verdict: 'accepted' }, 'manager@test');
  assert.deepEqual(accepted, { lines: 2, synonyms: 1 }); // принятое и так — не синоним
  assert.equal((await desk.synonymsOf(SHOP))[0].sku, 'B933-8x40-ZN');

  const anchor = byPos(lines, 6);                      // 37 шт при упаковке по 50
  await desk.review(SHOP, [anchor.id], { verdict: 'edited', qty: '50' }, 'manager@test');
  const after = byPos(await desk.draftLines(SHOP), 6);
  assert.deepEqual([after.qty, after.invoice_qty, after.question, after.review], [50, 50, null, 'edited']);

  const second = byPos(lines, 15);                     // гвозди: кандидат № 2 — оцинкованные
  await desk.review(SHOP, [second.id], { verdict: 'replaced', sku: '2' }, 'manager@test');
  assert.equal(byPos(await desk.draftLines(SHOP), 15).sku, 'NL-3x70-ZN');

  await assert.rejects(desk.review(SHOP, [byPos(lines, 16).id], { verdict: 'accepted' }, 'm'), /позиции нет/);
  await assert.rejects(desk.review(SHOP, [anchor.id], { verdict: 'replaced', sku: 'NOPE-1' }, 'm'), /Нет позиции/);
  await assert.rejects(desk.review(SHOP, [anchor.id], { verdict: 'edited', qty: '-3' }, 'm'), /больше нуля/);
  await assert.rejects(desk.review(SHOP, [anchor.id, bolt.id], { verdict: 'edited', qty: '5' }, 'm'), /одной строки/);
});

// ---------- table@1: поля действия ----------

test('table@1 action fields and max reach /meta, required fields are checked, body reaches the action', async () => {
  let seen = null;
  const app = express();
  app.use(express.json());
  app.use('/c', Components({
    t: Table({
      rows: () => [{ id: 'a' }, { id: 'b' }],
      columns: [{ key: 'id', name: 'id' }],
      actions: [{
        id: 'replace', name: 'Заменить', bulk: true, max: 1,
        fields: [{ key: 'sku', label: 'Артикул', required: true, placeholder: 'SKU' }],
        run: async ({ ids, body }) => { seen = { ids, sku: body.sku }; return { message: 'ok' }; },
      }, { id: 'plain', name: 'Просто', run: async () => ({}) }],
    }),
  }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/c/t`;
    const meta = await (await fetch(`${base}/meta`)).json();
    assert.deepEqual(meta.actions[0], { id: 'replace', name: 'Заменить', bulk: true, max: 1, fields: [{ key: 'sku', label: 'Артикул', required: true, placeholder: 'SKU' }] });
    assert.deepEqual(meta.actions[1], { id: 'plain', name: 'Просто', bulk: false }); // без полей — прежний контракт
    const post = (body) => fetch(`${base}/actions/replace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ ids: ['a'] })).status, 400);
    assert.equal((await post({ ids: ['a', 'b'], sku: 'X' })).status, 400);
    const ok = await (await post({ ids: ['a'], sku: 'AK-8x75' })).json();
    assert.deepEqual([ok.result.message, seen], ['ok', { ids: ['a'], sku: 'AK-8x75' }]);
  } finally {
    server.close();
  }
});
