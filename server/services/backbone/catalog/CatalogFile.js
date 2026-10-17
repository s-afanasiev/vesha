// Выгрузка каталога магазина (docs/backbone-architecture.md §8, О17): xlsx из 1С,
// МойСклад или прайс-лист. Две ступени — две формы данных:
//   preview: сетка листа → шапка, колонки с примерами, догадка «поле ← колонка»;
//   read:    сетка + сопоставление → позиции, список «не загружено», вердикт.
// Подменять ли каталог, решает дверь по вердикту: здесь подмены нет. Битый файл,
// нет шапки, не сопоставлены обязательные поля, позиций нет или брака больше,
// чем позиций, — отказ: прежний каталог остаётся.

const { unitOf } = require('../invoice/Lines');

// Поля каталога и слова шапки, по которым колонка узнаётся. Порядок слов — приоритет:
// у МойСклад есть и «Код», и «Артикул» — берётся артикул.
const FIELDS = [
  { key: 'sku', name: 'Артикул', required: true, header: [/^артикул/, /^sku$/, /^код товара/, /^код$/] },
  { key: 'name', name: 'Наименование', required: true, header: [/наименован/, /номенклатур/, /^товар/, /^название/] },
  { key: 'unit', name: 'Единица', header: [/^ед\.?(\s|$|изм)/, /^единиц/] },
  { key: 'pack', name: 'Упаковка', header: [/упаков/, /кратност/, /фасовк/, /^в уп/] },
  { key: 'price', name: 'Цена', required: true, header: [/^цена(?!.*закуп)/, /^(?!.*закуп).*розничн/, /^стоимост/, /^(?!.*закуп).*цена/] },
  { key: 'stock', name: 'Остаток', header: [/остат/, /^в наличии/, /^наличие/, /^доступно/, /^свободн/, /^количество/, /^кол-?во/] },
  { key: 'group', name: 'Группа', header: [/^групп/, /^категори/, /^раздел/, /^папка/] },
];

const letterOf = (index) => {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const headerText = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// «1 234,50 руб.», «1.234,50», «>100», «1.5E+3» → число; не число — null.
function number(raw) {
  let s = String(raw ?? '').toLowerCase().replace(/[\s  ]/g, '');
  if (!s) return null;
  s = s.replace(/(руб\.?|р\.?|₽|шт\.?)$/, '').replace(/^[<>≈~]=?/, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, ''); // точка — разряды, запятая — дробь
  s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/.test(s)) return null;
  return Number(s);
}

class Refused extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.refused = true;
  }
}

class CatalogFile {
  constructor(sheet, { maxItems = 20_000, maxRejects = 300, headerScan = 30, samples = 3 } = {}) {
    this.sheet = sheet;           // SheetRows: grid(buffer) → [{ row, cells }]
    this.maxItems = maxItems;
    this.maxRejects = maxRejects; // сколько строк брака хранить списком (счёт — всех)
    this.headerScan = headerScan; // в скольких первых строках искать шапку
    this.samples = samples;
    this.fields = FIELDS;
  }

  async grid(file) {
    if (!file || !file.data || !file.data.length) throw new Refused('Файл пустой');
    if (/\.xls$/i.test(file.name || '')) throw new Refused('Файл .xls (старый Excel) — сохраните выгрузку как .xlsx и загрузите снова');
    try {
      return await this.sheet.grid(file.data);
    } catch (err) {
      if (err.refusal) throw new Refused(err.message);
      throw new Refused(`Файл не прочитан как xlsx: ${err.message}`);
    }
  }

  // Шапка — строка, в которой узнаётся больше всего полей (и наименование — обязательно).
  preview(grid) {
    let best = null;
    for (const r of grid.slice(0, this.headerScan)) {
      const mapping = this.guess(r.cells);
      const score = Object.values(mapping).filter((v) => v != null).length;
      if (mapping.name != null && score >= 2 && (!best || score > best.score)) best = { r, mapping, score };
    }
    if (!best) throw new Refused(`Не нашли шапку таблицы в первых ${this.headerScan} строках: нужна строка с «Наименование» и «Артикул» или «Цена»`);
    const below = grid.filter((r) => r.row > best.r.row && r.cells.some(Boolean));
    const width = Math.max(best.r.cells.length, ...below.slice(0, 50).map((r) => r.cells.length));
    const columns = Array.from({ length: width }, (_, index) => ({
      index,
      letter: letterOf(index),
      header: best.r.cells[index] || '',
      samples: below.map((r) => r.cells[index]).filter(Boolean).slice(0, this.samples),
    })).filter((c) => c.header || c.samples.length);
    return { headerRow: best.r.row, columns, mapping: best.mapping, rows: below.length };
  }

  // Ячейки шапки → { поле: номер колонки | null }; колонка достаётся одному полю.
  guess(cells) {
    const texts = cells.map(headerText);
    const taken = new Set();
    const mapping = {};
    for (const f of this.fields) {
      mapping[f.key] = null;
      for (const re of f.header) {
        const at = texts.findIndex((t, i) => t && !taken.has(i) && re.test(t));
        if (at >= 0) { mapping[f.key] = at; taken.add(at); break; }
      }
    }
    return mapping;
  }

  // Колонка по слову админа: буква («C»), номер («3») или текст шапки; пусто или «-» — не брать.
  columnOf(columns, raw) {
    const text = String(raw ?? '').trim();
    if (!text || text === '-') return null;
    const byLetter = columns.find((c) => c.letter === text.toUpperCase());
    if (byLetter) return byLetter.index;
    if (/^\d{1,3}$/.test(text)) {
      const byNumber = columns.find((c) => c.index === Number(text) - 1);
      if (byNumber) return byNumber.index;
    }
    const byHeader = columns.find((c) => headerText(c.header) === headerText(text))
      || columns.find((c) => c.header && headerText(c.header).includes(headerText(text)));
    if (byHeader) return byHeader.index;
    throw new Refused(`Нет колонки «${text}» — укажите букву (A, B, …) или название из шапки`);
  }

  // Сетка + сопоставление → { items, rejects, rejected, rows, groups, ok, reason }.
  read(grid, { headerRow, mapping }) {
    const missing = this.fields.filter((f) => f.required && mapping[f.key] == null).map((f) => f.name);
    if (missing.length) throw new Refused(`Не сопоставлены обязательные поля: ${missing.join(', ')}`);
    const cell = (r, key) => (mapping[key] == null ? '' : String(r.cells[mapping[key]] ?? '').trim());
    const items = [];
    const rejects = [];
    let rejected = 0;
    let rows = 0;
    let groups = 0;
    let group = '';
    const seen = new Map(); // артикул → строка листа
    const reject = (r, reason) => {
      rejected++;
      if (rejects.length < this.maxRejects) {
        const cells = this.fields.filter((f) => mapping[f.key] != null && cell(r, f.key)).map((f) => `${f.name}: ${cell(r, f.key)}`).join(' · ');
        rejects.push({ row: r.row, reason, cells });
      }
    };
    for (const r of grid) {
      if (r.row <= headerRow || !r.cells.some(Boolean)) continue;
      rows++;
      const sku = cell(r, 'sku');
      const name = cell(r, 'name');
      const priceText = cell(r, 'price');
      // строка-заголовок группы прайса: одна заполненная ячейка (в любой колонке) и без цены
      if (!priceText && r.cells.filter(Boolean).length === 1) {
        group = r.cells.find(Boolean).slice(0, 120);
        groups++;
        continue;
      }
      if (!sku) { reject(r, 'нет артикула'); continue; }
      if (!name) { reject(r, 'нет наименования'); continue; }
      const price = number(priceText);
      if (price == null) { reject(r, priceText ? `цена не число: «${priceText}»` : 'нет цены'); continue; }
      if (price <= 0) { reject(r, 'цена не больше нуля'); continue; }
      const packText = cell(r, 'pack');
      const pack = packText ? number(packText) : 1;
      if (pack == null || pack <= 0) { reject(r, `упаковка не число: «${packText}»`); continue; }
      if (seen.has(sku)) { reject(r, `артикул ${sku} повторяется — первый в строке ${seen.get(sku)}`); continue; }
      let stock = null;                                    // колонки остатка нет — остаток неизвестен
      if (mapping.stock != null) {
        const s = cell(r, 'stock');
        stock = s ? number(s) : 0;                         // пусто в выгрузке остатков — ноль
        if (stock != null && stock < 0) stock = 0;         // 1С показывает минус при пересорте
      }
      seen.set(sku, r.row);
      items.push({
        sku: sku.slice(0, 80),
        name: name.replace(/\s+/g, ' ').slice(0, 300),
        group: (cell(r, 'group') || group).slice(0, 120),
        unit: unitOf(cell(r, 'unit')) || 'шт',
        pack,
        price: Math.round(price * 100) / 100,
        stock,
      });
    }
    const verdict = this.verdict(items.length, rejected);
    return { items, rejects, rejected, rows, groups, ...verdict };
  }

  verdict(loaded, rejected) {
    if (!loaded) return { ok: false, reason: 'ни одной позиции — проверьте сопоставление колонок' };
    if (loaded > this.maxItems) return { ok: false, reason: `позиций ${loaded} — больше ${this.maxItems}: разделите выгрузку` };
    if (rejected > loaded) return { ok: false, reason: `не загрузилось больше половины строк (${rejected} из ${loaded + rejected}) — проверьте сопоставление колонок` };
    return { ok: true, reason: null };
  }
}

module.exports = { CatalogFile, Refused, number, letterOf, FIELDS };
