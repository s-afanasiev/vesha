// Каталог магазина (docs/backbone-architecture.md §4): общее для сайта, ассистента
// и инструмента — читается один раз (П5). Источник до шага 6 — файл-фикстура
// на 300 позиций (честный простой узел, О6; пересборка — scripts/backbone-catalog-fixture.mjs).
// Индекс атрибутов строится из тех же позиций при первом обращении; синонимы —
// у магазина (backbone_synonyms), их читает разбор. Живая выгрузка 1С / МойСклад — шаг 6.

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
  constructor(feed, index = null) {
    this.feed = feed;
    this.attributeIndex = index;
    this.cache = null;
    this.built = false;
  }

  items() {
    if (!this.cache) this.cache = this.feed.read();
    return this.cache;
  }

  get index() {
    if (!this.built) {
      this.attributeIndex.build(this.items());
      this.built = true;
    }
    return this.attributeIndex;
  }

  bySku(sku) {
    return this.items().find((i) => i.sku === sku) || null;
  }

  // Поиск витрины (§6.3): слова запроса — все в наименовании или артикуле; размер
  // пишут как угодно — «м10х50», «M10x50», «10*50» находят «М10×50».
  search({ q = '', group = '', limit = 60 } = {}) {
    const words = norm(q).split(' ').filter(Boolean);
    const found = this.items().filter((i) => {
      if (group && i.group !== group) return false;
      const hay = norm(`${i.name} ${i.sku}`);
      return words.every((w) => hay.includes(w));
    });
    return { total: found.length, items: found.slice(0, limit) };
  }

  groups() {
    return [...new Set(this.items().map((i) => i.group))];
  }
}

function norm(s) {
  return String(s).toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)\s*[x×х*]\s*(?=\d)/g, '$1x')   // 10х50, 10 × 50 → 10x50
    .replace(/(^|[^a-zа-я])[мm](?=\d)/g, '$1m')  // м10 → m10
    .replace(/[,.](?=\d)/g, '.')
    .replace(/[^\p{L}\p{N}.x]+/gu, ' ')
    .trim();
}

module.exports = { Catalog, CsvFeed };
