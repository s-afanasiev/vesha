// Текст заявки (docs/backbone-architecture.md §6.5 п. 1): сообщение, строки листа
// xlsx, текстовый слой pdf. У скана текстового слоя нет — это именованный отказ
// «нужен текст или таблица», а не попытка OCR (правило VESHA: только текстовые
// источники). Выход — строки текста; что в них товар, решают Lines.

const { XMLParser } = require('fast-xml-parser');
const { unzip } = require('./zip');

// Отказ разбора — результат с именем, а не сбой (П24): дверь пишет parse_failed.
class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.refusal = true;
    this.status = 422;
  }
}

const CHATTER_LINE = /^\s*-- \d+ of \d+ --\s*$/; // разделитель страниц pdf-parse

function splitText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n|;/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !CHATTER_LINE.test(l));
}

// Текст заявки целиком — для левой колонки карточки «как прислал покупатель» — и где
// в нём каждая строка черновика (sources — исходные строки по порядку черновика):
// → { lines: [строки текста как есть], anchors: [для каждой исходной строки — номера строк текста] }
// Строку ищем от места предыдущей, потом с начала; одна и та же строка дважды встаёт на
// своё место по порядку, а не дважды на первое.
function anchorText(text, sources) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const taken = new Map(); // «номер строки текста + исходная строка» → сколько раз уже занята
  let cursor = 0;
  const anchors = sources.map((source) => {
    const needle = String(source ?? '').trim();
    if (!needle) return [];
    const free = (l, i) => l.split(needle).length - 1 > (taken.get(`${i}:${needle}`) || 0);
    const find = (from) => lines.findIndex((l, i) => i >= from && free(l, i));
    let at = find(cursor);
    if (at < 0) at = find(0);
    if (at < 0) return [];
    const key = `${at}:${needle}`;
    taken.set(key, (taken.get(key) || 0) + 1);
    cursor = at;
    return [at];
  });
  return { lines, anchors };
}

// Два прочтения одного текста (механика и нейросеть) → пары по месту: строки с тем же
// местом в тексте (anchors[0], иначе исходная строка) встают друг к другу по порядку.
// → [{ line: строка из others, base: строка из lines на том же месте | null }]
function pairByPlace(lines, others) {
  const place = (l) => ((l.anchors || []).length ? `@${l.anchors[0]}` : `#${String(l.source ?? '').trim()}`);
  const byPlace = new Map();
  for (const l of lines) {
    if (!byPlace.has(place(l))) byPlace.set(place(l), []);
    byPlace.get(place(l)).push(l);
  }
  const used = new Map();
  return others.map((line) => {
    const k = place(line);
    const i = used.get(k) || 0;
    used.set(k, i + 1);
    return { line, base: (byPlace.get(k) || [])[i] || null };
  });
}

class PlainText {
  async lines(data) {
    return splitText(Buffer.isBuffer(data) ? data.toString('utf8') : data);
  }
}

// ---------- xlsx: zip из XML (invoice/zip.js) ----------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false });
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (t) => (t == null ? '' : typeof t === 'object' ? String(t['#text'] ?? '') : String(t));
const runs = (si) => (si.t != null ? textOf(si.t) : list(si.r).map((r) => textOf(r.t)).join(''));

function columnIndex(ref) {
  const letters = String(ref || '').replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const HEADER = /наимен|номенкл|товар|кол-?в|количеств|ед\.?\s?изм|^ед\.?$|артикул|^№$|цена/i;

class SheetRows {
  constructor({ maxEntryBytes = 20 * 1024 * 1024 } = {}) {
    this.maxEntryBytes = maxEntryBytes;
  }

  // Первый лист книги сеткой: [{ row: номер строки листа, cells: [текст по колонкам] }].
  // Каталог читает сетку целиком (шапка, колонки); заявка — строками текста (lines).
  async grid(data) {
    const read = unzip(data, { maxEntryBytes: this.maxEntryBytes, bad: (message) => new Refusal('bad_file', message) });
    const shared = read('xl/sharedStrings.xml');
    const strings = shared ? list(xml.parse(shared).sst?.si).map(runs) : [];
    const sheet = read(this.firstSheet(read));
    if (!sheet) throw new Refusal('bad_file', 'В книге xlsx нет листа');
    const rows = [];
    let n = 0;
    for (const row of list(xml.parse(sheet).worksheet?.sheetData?.row)) {
      n = Number(row['@_r']) || n + 1;
      const cells = [];
      for (const c of list(row.c)) {
        const type = c['@_t'];
        const value = type === 's' ? strings[Number(textOf(c.v))] ?? ''
          : type === 'inlineStr' ? runs(c.is || {})
            : textOf(c.v);
        cells[c['@_r'] ? columnIndex(c['@_r']) : cells.length] = String(value).trim(); // без адреса — следующая колонка
      }
      rows.push({ row: n, cells: Array.from(cells, (v) => v || '') });
    }
    return rows;
  }

  // Первый лист книги: строка листа → строка текста, ячейки через табуляцию.
  async lines(data) {
    const rows = [];
    for (const { cells: filled } of await this.grid(data)) {
      if (!filled.some(Boolean)) continue;
      // шапка таблицы: слова шапки и ни одного числа
      if (filled.some((v) => HEADER.test(v)) && !filled.some((v) => /^\d+(?:[.,]\d+)?$/.test(v))) continue;
      rows.push(filled.filter(Boolean).join('\t'));
    }
    return rows;
  }

  firstSheet(read) {
    const book = read('xl/workbook.xml');
    const rels = read('xl/_rels/workbook.xml.rels');
    if (book && rels) {
      const first = list(xml.parse(book).workbook?.sheets?.sheet)[0];
      const rel = first && list(xml.parse(rels).Relationships?.Relationship).find((r) => r['@_Id'] === first['@_r:id']);
      if (rel) {
        const target = String(rel['@_Target']);
        return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
    return 'xl/worksheets/sheet1.xml';
  }
}

// ---------- pdf: только текстовый слой ----------

// pdf-parse (pdf.js) тяжёл и нужен только здесь — подключается лениво.
let PdfParse;

class PdfTextLayer {
  constructor({ minChars = 10 } = {}) {
    this.minChars = minChars;
  }

  async lines(data) {
    PdfParse ??= require('pdf-parse').PDFParse;
    const parser = new PdfParse({ data: new Uint8Array(data) });
    let text;
    try {
      text = (await parser.getText()).text;
    } catch (err) {
      throw new Refusal('bad_file', `PDF не открывается: ${err.message}`);
    } finally {
      await parser.destroy().catch(() => {});
    }
    const lines = splitText(text);
    if (lines.join('').replace(/\s+/g, '').length < this.minChars) {
      throw new Refusal('scan', 'В PDF нет текстового слоя — похоже на скан. Нужен текст или таблица (xlsx).');
    }
    return lines;
  }
}

// ---------- вход ----------

const KIND_BY_EXT = { txt: 'text', csv: 'text', xlsx: 'xlsx', pdf: 'pdf' };
const SCAN_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'tif', 'tiff', 'bmp', 'gif']);

class RequestText {
  constructor(readers, { maxBytes = 5 * 1024 * 1024 } = {}) {
    this.readers = readers; // { text, xlsx, pdf }
    this.maxBytes = maxBytes;
  }

  // { text } | { file: { name, data } } → { kind, lines }
  async read(input = {}) {
    if (input.file) {
      const { name = '', data } = input.file;
      const ext = String(name).toLowerCase().split('.').pop();
      if (SCAN_EXT.has(ext)) throw new Refusal('scan', 'Фото или скан не разбираем. Нужен текст или таблица (xlsx).');
      if (ext === 'xls') throw new Refusal('unsupported', 'Старый формат .xls — сохраните таблицу как .xlsx');
      const kind = KIND_BY_EXT[ext];
      if (!kind) throw new Refusal('unsupported', `Формат .${ext} не разбираем: нужен текст, xlsx или pdf с текстом`);
      if (!data || !data.length) throw new Refusal('empty', 'Файл пустой');
      if (data.length > this.maxBytes) throw new Refusal('too_big', `Файл больше ${Math.round(this.maxBytes / 1024 / 1024)} МБ`);
      return this.done(kind, await this.readers[kind].lines(data));
    }
    return this.done('text', await this.readers.text.lines(input.text));
  }

  done(kind, lines) {
    if (!lines.length) throw new Refusal('empty', 'В заявке нет текста');
    return { kind, lines };
  }
}

module.exports = { RequestText, PlainText, SheetRows, PdfTextLayer, Refusal, splitText, anchorText, pairByPlace };
