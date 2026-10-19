// Костяк, шаг 6 — то, что решается кодом: магазин из кабинета без правки кода,
// каталог из выгрузки xlsx (подмена целиком только при успешном чтении, О17),
// квитанции настоящим письмом (SMTP с контрактом FileMailbox).

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { TEMPLATES, templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { ShopForm, parseDays, parseTime, hoursText } = require('../server/services/backbone/shops/ShopForm');
const { Catalogs, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { CatalogIndex } = require('../server/services/backbone/catalog/CatalogIndex');
const { CatalogFile, number } = require('../server/services/backbone/catalog/CatalogFile');
const hardwareAttributes = require('../server/services/backbone/catalog/hardwareAttributes');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');
const { SiteIntake } = require('../server/services/backbone/site/SiteIntake');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { SmtpMailbox } = require('../server/services/backbone/receipts/SmtpMailbox');
const { letterOf } = require('../server/services/backbone/receipts/letter');
const { Components } = require('../server/components');
const { Table } = require('../server/components/table');

const FIXTURE = path.join(__dirname, '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv');

// ---------- xlsx без библиотек: лист как у выгрузки 1С ----------

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(zlib.crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10);
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

function xlsxOf(rows) {
  const strings = [];
  const sid = (s) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => (typeof v === 'number'
    ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
    : v === '' ? '' : `<c r="${col(c)}${r + 1}" t="s"><v>${sid(v)}</v></c>`)).join('')}</row>`).join('');
  return zip([
    ['xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Прайс" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

// Прайс 1С: название и дата над шапкой, строки-группы, брак — цена словом, без артикула, дубль.
const PRICE_1C = [
  ['ООО «Крепёж-Курск»'],
  ['Прайс-лист на 17.10.2026'],
  ['Артикул', 'Номенклатура', 'Ед. изм.', 'Кратность', 'Цена, руб.', 'Остаток'],
  ['Болты'],
  ['KK-B10x50', 'Болт DIN 933 М10×50 кл. 8.8 оцинк.', 'шт', 25, 15.4, 1200],
  ['KK-B10x60', 'Болт DIN 933 М10×60 кл. 8.8 оцинк.', 'шт.', 25, '16,80', '1 000'],
  ['Гайки'],
  ['KK-N10', 'Гайка DIN 934 М10 кл. 8 оцинк.', 'Штука', 100, 2.1, ''],
  ['KK-N12', 'Гайка DIN 934 М12 кл. 8 оцинк.', 'шт', 100, 'договорная', 50],
  ['', 'Шайба без артикула', 'шт', 1, 1.5, 10],
  ['KK-B10x50', 'Болт дубль', 'шт', 25, 15, 1],
  ['KK-W10', 'Шайба DIN 125 М10 оцинк.', 'кг', '', 320, 12.5],
];

const reader = () => new CatalogFile(new SheetRows());

// ---------- форма магазина ----------

test('shop form: days and hours in human words, slug and e-mail checked before the database', () => {
  assert.deepEqual(parseDays('пн-сб'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays('пн – пт, сб'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays('пн ср пт'), [1, 3, 5]);
  assert.deepEqual(parseDays('ежедневно'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(parseDays('пт-пн'), [1, 5, 6, 7], 'через воскресенье');
  assert.throws(() => parseDays('по будням'), /Дни работы/);
  assert.deepEqual(parseTime('9-18'), { from: '09:00', to: '18:00' });
  assert.deepEqual(parseTime('08.30 — 17:45'), { from: '08:30', to: '17:45' });
  assert.throws(() => parseTime('18-9'), /конец раньше начала/);
  assert.equal(hoursText({ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }), 'пн–пт 08:00–17:00');
  assert.equal(hoursText({ days: [1, 3, 5], from: '10:00', to: '16:00' }), 'пн, ср, пт 10:00–16:00');

  const form = new ShopForm({ niches: Object.keys(TEMPLATES) });
  const shop = form.create({ slug: ' Krepezh-Kursk ', name: 'Крепёж  Курск', niche: 'hardware', days: 'пн-пт', time: '8-17', email: 'zakaz@kk.test' });
  assert.deepEqual(shop, {
    slug: 'krepezh-kursk', name: 'Крепёж Курск', niche: 'hardware',
    hours: { days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }, replyTo: 'zakaz@kk.test',
  });
  assert.throws(() => form.create({ slug: 'кр', name: 'Магазин' }), /латиница/);
  assert.throws(() => form.create({ slug: 'shop-1', name: 'Магазин', niche: 'bakery' }), /Ниша/);
  assert.throws(() => form.create({ slug: 'shop-1', name: 'Магазин', email: 'не почта' }), /не похоже на адрес/);
  const changed = form.change({ time: '9-18', email: '-' }, { name: 'Старое', hours: { days: [1, 2], from: '08:00', to: '17:00' }, reply_to: 'a@b.ru' });
  assert.deepEqual(changed, { name: 'Старое', hours: { days: [1, 2], from: '09:00', to: '18:00' }, replyTo: null }, 'пустое — прежнее, «-» — убрать почту');
});

// ---------- выгрузка каталога ----------

test('catalog file: header found under the title rows, columns guessed by words, group rows and rejects with row numbers', async () => {
  const file = reader();
  const grid = await file.grid({ name: 'price.xlsx', data: xlsxOf(PRICE_1C) });
  const preview = file.preview(grid);
  assert.equal(preview.headerRow, 3);
  assert.deepEqual(preview.mapping, { sku: 0, name: 1, unit: 2, pack: 3, price: 4, stock: 5, group: null });
  assert.equal(preview.rows, 9);
  assert.deepEqual(preview.columns[4], { index: 4, letter: 'E', header: 'Цена, руб.', samples: ['15.4', '16,80', '2.1'] });

  const read = file.read(grid, preview);
  assert.equal(read.ok, true);
  assert.deepEqual(read.items.map((i) => i.sku), ['KK-B10x50', 'KK-B10x60', 'KK-N10', 'KK-W10']);
  assert.deepEqual(read.items[1], { sku: 'KK-B10x60', name: 'Болт DIN 933 М10×60 кл. 8.8 оцинк.', group: 'Болты', unit: 'шт', pack: 25, price: 16.8, stock: 1000 });
  assert.equal(read.items[2].group, 'Гайки');
  assert.equal(read.items[2].unit, 'шт', '«Штука» — шт');
  assert.equal(read.items[2].stock, 0, 'пустой остаток в выгрузке остатков — ноль');
  assert.deepEqual([read.items[3].unit, read.items[3].pack], ['кг', 1], 'нет кратности — 1');
  assert.equal(read.groups, 2);
  assert.deepEqual(read.rejects.map((r) => [r.row, r.reason]), [
    [9, 'цена не число: «договорная»'],
    [10, 'нет артикула'],
    [11, 'артикул KK-B10x50 повторяется — первый в строке 5'],
  ]);
  assert.match(read.rejects[0].cells, /Артикул: KK-N12 · Наименование: Гайка/);

  // МойСклад: «Код» и «Артикул» — берётся артикул; закупочная цена — не цена
  assert.deepEqual(file.guess(['Группы', 'Наименование', 'Код', 'Артикул', 'Единица измерения', 'Цена: Цена продажи', 'Закупочная цена', 'Остаток']),
    { sku: 3, name: 1, unit: 4, pack: null, price: 5, stock: 7, group: 0 });
  assert.equal(file.columnOf(preview.columns, 'e'), 4);
  assert.equal(file.columnOf(preview.columns, '6'), 5);
  assert.equal(file.columnOf(preview.columns, 'остаток'), 5);
  assert.equal(file.columnOf(preview.columns, '-'), null);
  assert.throws(() => file.columnOf(preview.columns, 'Z'), /Нет колонки/);

  assert.equal(number('1 234,50 руб.'), 1234.5);
  assert.equal(number('1.234,50'), 1234.5);
  assert.equal(number('>100'), 100);
  assert.equal(number('1.5E+3'), 1500);
  assert.equal(number('по запросу'), null);
});

test('catalog file: broken file, no header, unmapped required field, mostly rejects — named refusals', async () => {
  const file = reader();
  await assert.rejects(file.grid({ name: 'a.xlsx', data: Buffer.from('это не zip') }), (e) => e.refused && /xlsx/.test(e.message));
  await assert.rejects(file.grid({ name: 'old.xls', data: Buffer.from('x') }), /сохраните выгрузку как \.xlsx/);
  assert.throws(() => file.preview([{ row: 1, cells: ['просто', 'текст'] }]), /Не нашли шапку/);
  const grid = await file.grid({ name: 'p.xlsx', data: xlsxOf(PRICE_1C) });
  const { headerRow, mapping } = file.preview(grid);
  assert.throws(() => file.read(grid, { headerRow, mapping: { ...mapping, price: null } }), /обязательные поля: Цена/);
  const wrong = file.read(grid, { headerRow, mapping: { ...mapping, price: 1 } }); // цена — из наименования
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /ни одной позиции/);
});

// ---------- дверь: второй магазин без правки кода ----------

function makeDesk({ mailbox = null } = {}) {
  const { invoiceTool } = require('../server/services/backbone');
  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const catalogs = new Catalogs({
    repository,
    indexOf: () => new CatalogIndex({ attributes: hardwareAttributes }),
    fixtureOf: (shop) => (shop.slug === 'demo' ? new CsvFeed(FIXTURE) : null),
  });
  const tools = new WeakMap();
  const receipts = mailbox && new Receipts({
    repository, journal, mailbox, statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`, deadlineOf: () => '17.10 в 15:00',
  });
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { demo: { name: 'Демо', niche: 'hardware', mode: 'help', shadowDays: 0 } },
    shopForm: new ShopForm({ niches: Object.keys(TEMPLATES) }),
    catalogs,
    catalogFile: reader(),
    toolOf: async (shop) => {
      const catalog = await catalogs.of(shop);
      if (!tools.has(catalog)) tools.set(catalog, invoiceTool(catalog, shop.niche));
      return tools.get(catalog);
    },
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    receipts,
  });
  return { desk, journal, repository };
}

const NEW_SHOP = { slug: 'krepezh-kursk', name: 'Крепёж Курск', niche: 'hardware', days: 'пн-пт', time: '8-17', email: 'zakaz@kk.test' };

test('second shop from the cabinet: table row, shadow mode, board from the niche template, shop_opened in the journal', async () => {
  const { desk, journal } = makeDesk();
  const shop = await desk.openShop(NEW_SHOP, 'admin@vesha');
  assert.equal(shop.mode, 'shadow', 'новый магазин — в тени');
  assert.deepEqual(shop.hours, { days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' });
  assert.equal(shop.reply_to, 'zakaz@kk.test');
  assert.deepEqual((await desk.columns('krepezh-kursk')).map((c) => c.id), templateOf('hardware').map((c) => c.id));
  assert.deepEqual((await journal.forScope(shop.id)).map((e) => e.type).sort(), ['board_created', 'shop_opened']);
  assert.deepEqual((await desk.shopList()).map((s) => s.slug).sort(), ['demo', 'krepezh-kursk'], 'посев демо — в том же списке');

  await assert.rejects(desk.openShop(NEW_SHOP, 'admin'), (e) => e.status === 409);
  await assert.rejects(desk.openShop({ ...NEW_SHOP, slug: 'demo' }, 'admin'), (e) => e.status === 409, 'адрес посева занят');
  await assert.rejects(desk.shop('nope'), (e) => e.status === 404);

  const changed = await desk.changeShop('krepezh-kursk', { time: '9-18' }, 'admin');
  assert.deepEqual([changed.name, changed.hours.from, changed.hours.days.length, changed.reply_to], ['Крепёж Курск', '09:00', 5, 'zakaz@kk.test']);
  assert.equal(desk.specOf(changed).shadowDays, null, 'срок тени — по умолчанию (14)');
});

test('catalog upload: replaced as a whole only after a full read; broken file and bad mapping keep the old catalog', async () => {
  const { desk } = makeDesk();
  await desk.openShop(NEW_SHOP, 'admin');
  assert.equal((await desk.catalogOf('krepezh-kursk')).items().length, 0, 'новый магазин — без каталога');
  assert.equal((await desk.storefront('krepezh-kursk')).items, 0);

  const preview = await desk.uploadCatalog('krepezh-kursk', { name: 'прайс.xlsx', data: xlsxOf(PRICE_1C) }, 'admin');
  assert.equal(preview.headerRow, 3);
  assert.equal((await desk.catalogOf('krepezh-kursk')).items().length, 0, 'до «Загрузить каталог» каталог не тронут');
  const done = await desk.commitCatalog('krepezh-kursk', 'admin');
  assert.deepEqual([done.ok, done.loaded, done.rejected, done.version], [true, 4, 3, 1]);
  const catalog = await desk.catalogOf('krepezh-kursk');
  assert.deepEqual(catalog.items().map((i) => i.sku), ['KK-B10x50', 'KK-B10x60', 'KK-N10', 'KK-W10']);
  assert.deepEqual(catalog.groups(), ['Болты', 'Гайки']);
  assert.equal((await desk.catalogOf('demo')).items().length, 300, 'каталог демо — свой');
  const [loaded] = await desk.catalogLoads('krepezh-kursk');
  assert.deepEqual([loaded.status, loaded.loaded, loaded.rejected, loaded.rejects.length], ['loaded', 4, 3, 3]);

  // битый файл — отказ в истории, каталог прежний
  await assert.rejects(desk.uploadCatalog('krepezh-kursk', { name: 'битый.xlsx', data: Buffer.from('обрыв') }, 'admin'), (e) => e.status === 400);
  const [refused] = await desk.catalogLoads('krepezh-kursk');
  assert.deepEqual([refused.status, refused.file_name], ['refused', 'битый.xlsx']);
  assert.equal((await desk.catalogOf('krepezh-kursk')).items().length, 4);

  // цена не взята — отказ до чтения; цена из колонки единиц — попытка не прошла, файл ждёт исправления
  await desk.uploadCatalog('krepezh-kursk', { name: 'прайс-2.xlsx', data: xlsxOf(PRICE_1C.slice(0, 8)) }, 'admin');
  await desk.mapCatalogField('krepezh-kursk', 'price', '-');
  await assert.rejects(desk.commitCatalog('krepezh-kursk', 'admin'), /обязательные поля: Цена/);
  await desk.mapCatalogField('krepezh-kursk', 'price', 'Ед. изм.');
  assert.equal((await desk.pendingCatalog('krepezh-kursk')).mapping.unit, null, 'колонка достаётся одному полю');
  const failed = await desk.commitCatalog('krepezh-kursk', 'admin');
  assert.equal(failed.ok, false);
  assert.equal((await desk.catalogOf('krepezh-kursk')).items().length, 4, 'каталог не подменён');
  assert.equal((await desk.pendingCatalog('krepezh-kursk')).reason, failed.reason, 'файл ждёт, причина видна');
  await desk.mapCatalogField('krepezh-kursk', 'price', 'E');
  const fixed = await desk.commitCatalog('krepezh-kursk', 'admin');
  assert.deepEqual([fixed.ok, fixed.loaded, fixed.version], [true, 3, 2]);
  await assert.rejects(desk.mapCatalogField('krepezh-kursk', 'price', 'E'), /Сначала загрузите файл/);
});

test('order of the second shop is parsed against its own catalog; synonyms stay with the shop', async () => {
  const { desk } = makeDesk();
  await desk.openShop(NEW_SHOP, 'admin');
  await desk.uploadCatalog('krepezh-kursk', { name: 'прайс.xlsx', data: xlsxOf(PRICE_1C) }, 'admin');
  await desk.commitCatalog('krepezh-kursk', 'admin');
  const order = await desk.createOrder('krepezh-kursk', { client: 'ООО Стройка', text: 'Болт М10х50 оцинк. — 100 шт\nГайка М10 — 200 шт' }, 'admin');
  const parsed = await desk.parseOrder('krepezh-kursk', order.id, { actor: 'admin' });
  assert.equal(parsed.ok, true);
  const lines = await desk.draftLines('krepezh-kursk');
  assert.deepEqual(lines.map((l) => l.sku), ['KK-B10x50', 'KK-N10']);
  assert.deepEqual(lines.map((l) => l.price), [15.4, 2.1]);
  await desk.review('krepezh-kursk', [lines[0].id], { verdict: 'replaced', sku: 'KK-B10x60' }, 'admin');
  assert.deepEqual((await desk.synonymsOf('krepezh-kursk')).map((s) => s.sku), ['KK-B10x60']);
  await assert.rejects(desk.review('krepezh-kursk', [lines[1].id], { verdict: 'replaced', sku: 'B933-10x50-ZN' }, 'admin'), /Нет позиции/, 'артикул демо — не из этого каталога');

  const demoOrder = await desk.createOrder('demo', { client: 'Демо', text: 'Болт М10х50 — 100 шт' }, 'admin');
  await desk.parseOrder('demo', demoOrder.id, { actor: 'admin' });
  assert.ok((await desk.draftLines('demo')).every((l) => !String(l.sku).startsWith('KK-')), 'демо разбирает свой каталог');
});

// ---------- квитанции письмом: SMTP против приёмника на своей машине ----------

function smtpSink({ rcptReply = '250 2.1.5 ok' } = {}) {
  const letters = [];
  const server = net.createServer((socket) => {
    const letter = { lines: [] };
    let buf = '';
    let data = false;
    socket.write('220 sink.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; letters.push(letter); socket.write('250 2.0.0 queued\r\n'); } else letter.lines.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) socket.write('250-sink.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('AUTH PLAIN ')) { letter.auth = Buffer.from(line.slice(11), 'base64').toString('utf8'); socket.write('235 2.7.0 ok\r\n'); } else if (cmd.startsWith('MAIL FROM:')) { letter.from = line.slice(10); socket.write('250 ok\r\n'); } else if (cmd.startsWith('RCPT TO:')) { letter.to = line.slice(8); socket.write(`${rcptReply}\r\n`); } else if (cmd === 'DATA') { data = true; socket.write('354 go\r\n'); } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('502 5.5.2 ?\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, letters, port: server.address().port })));
}

// Письмо из приёмника: заголовки (encoded-word раскрыт) и тело из base64.
function parseLetter(lines) {
  const blank = lines.indexOf('');
  const headers = {};
  let last = null;
  for (const l of lines.slice(0, blank)) {
    if (/^\s/.test(l)) { headers[last] += l.trim(); continue; }
    const at = l.indexOf(':');
    last = l.slice(0, at).toLowerCase();
    headers[last] = l.slice(at + 1).trim();
  }
  const words = (v) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, words(v)])),
    body: Buffer.from(lines.slice(blank + 1).join(''), 'base64').toString('utf8'),
  };
}

test('smtp mailbox: AUTH, envelope, Reply-To of the shop, encoded subject and base64 body; refusal of the server is an error', async () => {
  const sink = await smtpSink();
  try {
    const mailbox = new SmtpMailbox({ host: '127.0.0.1', port: sink.port, user: 'robot@vesha.test', pass: 'секрет', from: 'robot@vesha.test', timeoutMs: 5000 });
    const subject = 'Заявка №7 получена — ответим до 17.10 в 15:00, магазин «Крепёж Курск» на улице Ленина';
    const body = 'Здравствуйте!\nЗаявка №7 получена.\n.точка в начале строки\nСтатус: https://shop.test/backbone/status.html?t=abc';
    const sent = await mailbox.send({ to: 'buyer@example.ru', subject, body, shop: { slug: 'krepezh-kursk', name: 'Крепёж Курск', reply_to: 'zakaz@kk.test' } });
    assert.match(sent.messageId, /^<[0-9a-f-]+@vesha\.test>$/);
    const [letter] = sink.letters;
    assert.equal(letter.auth, '\0robot@vesha.test\0секрет');
    assert.equal(letter.from, '<robot@vesha.test>');
    assert.equal(letter.to, '<buyer@example.ru>');
    assert.ok(letter.lines.every((l) => l.length <= 78), 'строки письма не длиннее 78');
    const { headers, body: text } = parseLetter(letter.lines);
    assert.equal(headers.subject, subject);
    assert.equal(headers.from, 'Крепёж Курск <robot@vesha.test>');
    assert.equal(headers['reply-to'], '<zakaz@kk.test>');
    assert.equal(headers['content-transfer-encoding'], 'base64');
    assert.equal(text, body.replace(/\n/g, '\r\n'));

    const strict = await smtpSink({ rcptReply: '550 5.1.1 no such user' });
    try {
      const m = new SmtpMailbox({ host: '127.0.0.1', port: strict.port, from: 'robot@vesha.test', timeoutMs: 5000 });
      await assert.rejects(m.send({ to: 'nobody@example.ru', subject: 'x', body: 'y' }), /RCPT: 550 5\.1\.1 no such user/);
    } finally {
      strict.server.close();
    }
    await assert.rejects(mailbox.send({ to: 'a@b.ru\r\nBcc: x@y.ru', subject: 'x', body: 'y' }), /плохой адрес/);
    assert.throws(() => letterOf({ from: 'a@b.ru', to: 'c@d.ru', subject: 'x', body: 'y', shop: { name: 'Ш', reply_to: 'x@y.ru>\r\nBcc: z@z.ru' } }), /плохой адрес/);
  } finally {
    sink.server.close();
  }
});

test('receipt of the second shop leaves as a real letter: order from the storefront → SMTP → Reply-To of the shop', async () => {
  const sink = await smtpSink();
  try {
    const mailbox = new SmtpMailbox({ host: '127.0.0.1', port: sink.port, from: 'robot@vesha.test', timeoutMs: 5000 });
    const { desk, repository } = makeDesk({ mailbox });
    const shop = await desk.openShop(NEW_SHOP, 'admin');
    const { order } = await desk.receiveFromSite('krepezh-kursk', { name: 'ООО Стройка', contact: 'buyer@example.ru', text: 'Болт М10х50 — 100 шт', consent: 'on' });
    const [receipt] = await repository.receipts(shop.id);
    assert.deepEqual([receipt.status, receipt.address], ['sent', 'buyer@example.ru']);
    const { headers, body } = parseLetter(sink.letters[0].lines);
    assert.equal(headers['reply-to'], '<zakaz@kk.test>');
    assert.match(headers.subject, new RegExp(`№${order.number}`));
    assert.match(body, /status\.html\?t=/);
  } finally {
    sink.server.close();
  }
});

// ---------- table@1: поле-файл и выбор из списка ----------

test('table@1 file field: multipart upload with a utf-8 name, size limit, required file, options checked', async () => {
  const app = express();
  app.use(express.json());
  app.use('/c', Components({
    t: Table({
      rows: () => [],
      columns: [{ key: 'id', name: 'id' }],
      actions: [{
        id: 'up', name: 'Загрузить',
        fields: [
          { key: 'file', type: 'file', label: 'Файл', required: true, accept: '.xlsx', maxBytes: 1024 },
          { key: 'kind', label: 'Вид', options: ['a', { value: 'b', name: 'Бэ' }] },
        ],
        run: async ({ body, ids }) => ({ name: body.file.name, size: body.file.data.length, kind: body.kind || null, ids }),
      }],
    }),
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/c/t`;
  try {
    const meta = await (await fetch(`${base}/meta`)).json();
    assert.deepEqual(meta.actions[0].fields, [
      { key: 'file', label: 'Файл', required: true, type: 'file', accept: '.xlsx', maxBytes: 1024 },
      { key: 'kind', label: 'Вид', required: false, options: [{ value: 'a', name: 'a' }, { value: 'b', name: 'Бэ' }] },
    ]);
    const post = (fill) => { const f = new FormData(); fill(f); return fetch(`${base}/actions/up`, { method: 'POST', body: f }); };
    const ok = await (await post((f) => { f.set('file', new Blob([Buffer.alloc(100, 1)]), 'прайс.xlsx'); f.set('kind', 'b'); f.append('ids', '7'); })).json();
    assert.deepEqual(ok.result, { name: 'прайс.xlsx', size: 100, kind: 'b', ids: ['7'] });
    const big = await post((f) => f.set('file', new Blob([Buffer.alloc(2048)]), 'big.xlsx'));
    assert.equal(big.status, 400);
    assert.match((await big.json()).error, /больше/);
    const none = await post((f) => f.set('kind', 'a'));
    assert.match((await none.json()).error, /Файл: пусто/);
    const wrong = await post((f) => { f.set('file', new Blob(['x']), 'a.xlsx'); f.set('kind', 'c'); });
    assert.match((await wrong.json()).error, /нет такого варианта/);
  } finally {
    server.close();
  }
});

test('cabinet and shop screens need sign-in, by path of the shop', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/backbone', require('../server/routes/backbone'));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/backbone`;
    for (const p of ['/c/shops/rows', '/c/pages/shops', '/s/demo-krepezh/c/catalog-fields/meta', '/s/demo-krepezh/c/pages/catalog', '/s/demo-krepezh/files/invoice/x.xlsx']) {
      assert.equal((await fetch(base + p)).status, 401, p);
    }
    const upload = await fetch(`${base}/s/demo-krepezh/c/catalog-fields/actions/upload`, { method: 'POST', body: new FormData() });
    assert.equal(upload.status, 401);
  } finally {
    server.close();
  }
});

// ---------- Postgres: второй магазин из кабинета, каталог из xlsx, витрина ----------

test('postgres: shop opened through the cabinet table, catalog uploaded as xlsx, storefront shows it', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['023_backbone_shops_catalog.sql']);
    if (!rows.length) return t.skip('миграция 023 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const { forShop, cabinet } = require('../server/services/backbone/components');
  const slug = `t-shop-${Date.now().toString(36)}`;
  const app = express();
  app.use(express.json());
  app.use('/c', cabinet);
  app.use('/s/:slug/c', (req, res, next) => forShop(req.params.slug)(req, res, next));
  app.use('/api/backbone-public', require('../server/routes/backbonePublic'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (p, init) => { const r = await fetch(base + p, init); return { status: r.status, ...(await r.json()) }; };
  const postJson = (p, body) => json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const opened = await postJson('/c/shops/actions/open', { slug, name: 'Тестовый магазин', niche: 'hardware', days: 'пн-пт', time: '9-18', email: 'zakaz@kk.test' });
    assert.equal(opened.status, 200, opened.error);
    const listed = (await json('/c/shops/rows?limit=200')).rows.find((r) => r.slug === slug);
    assert.deepEqual([listed.mode, listed.hours, listed.email, listed.catalog], ['сравнение, день 0 из 14', 'пн–пт 09:00–18:00', 'zakaz@kk.test', 'не загружен']);
    assert.equal((await postJson('/c/shops/actions/open', { slug, name: 'Дубль', niche: 'hardware' })).status, 400);

    const form = new FormData();
    form.set('file', new Blob([xlsxOf(PRICE_1C)]), 'прайс 1С.xlsx');
    const uploaded = await json(`/s/${slug}/c/catalog-fields/actions/upload`, { method: 'POST', body: form });
    assert.equal(uploaded.status, 200, uploaded.error);
    assert.match(uploaded.result.message, /шапка в строке 3/);
    const fields = (await json(`/s/${slug}/c/catalog-fields/rows`)).rows;
    assert.equal(fields.find((f) => f.id === 'price').column, 'E · «Цена, руб.»');
    const committed = await postJson(`/s/${slug}/c/catalog-fields/actions/commit`, {});
    assert.equal(committed.result.ok, true);
    assert.equal(committed.result.loaded, 4);
    assert.equal((await json(`/s/${slug}/c/catalog-rejects/rows`)).total, 3);
    assert.equal((await json(`/s/${slug}/c/catalog/rows`)).total, 4);

    const site = await json(`/api/backbone-public/shops/${slug}`);
    assert.deepEqual([site.name, site.groups, site.items], ['Тестовый магазин', ['Болты', 'Гайки'], 4]);
    const found = await json(`/api/backbone-public/shops/${slug}/catalog?q=${encodeURIComponent('м10х60')}`);
    assert.deepEqual(found.items.map((i) => [i.sku, i.price, i.inStock]), [['KK-B10x60', 16.8, true]]);
  } finally {
    server.close();
    const { rows: [shop] } = await db.query('SELECT id FROM backbone_shops WHERE slug = $1', [slug]);
    if (shop) {
      await db.query('DELETE FROM journal_events WHERE scope = $1', [shop.id]);
      await db.query('DELETE FROM backbone_shops WHERE id = $1', [shop.id]);
    }
  }
});
