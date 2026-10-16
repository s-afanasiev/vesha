// Каталог магазина (docs/backbone-architecture.md §4): общее для сайта, ассистента
// и инструмента — читается один раз (П5). Шаг 1 MVP: источник — файл-фикстура
// на 300 позиций (честный простой узел, О6; пересборка — scripts/backbone-catalog-fixture.mjs).
// Живая выгрузка 1С / МойСклад, индекс атрибутов и синонимы — шаги 2 и 6.

const fs = require('node:fs');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

class CsvFeed {
  constructor(file) {
    this.file = file;
  }

  read() {
    return parseCsv(fs.readFileSync(this.file, 'utf8')).map((r) => ({
      sku: r.sku,
      name: r.name,
      group: r.group,
      unit: r.unit,
      pack: Number(r.pack),
      price: Number(r.price),
      stock: Number(r.stock),
    }));
  }
}

class Catalog {
  constructor(feed) {
    this.feed = feed;
    this.cache = null;
  }

  items() {
    if (!this.cache) this.cache = this.feed.read();
    return this.cache;
  }

  bySku(sku) {
    return this.items().find((i) => i.sku === sku) || null;
  }
}

module.exports = { Catalog, CsvFeed };
