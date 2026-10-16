// Выгрузка черновика в xlsx для загрузки в 1С (docs/backbone-architecture.md §4, §6.5 п. 7):
// счёт формирует учётная система, костяк отдаёт таблицу «Артикул — Номенклатура —
// Количество — Ед. — Цена — Сумма» без шапок и итогов, чтобы загрузка из файла
// сопоставила колонки сама.
//
// В счёт идут только принятые строки с позицией и количеством; «выбрать», «нет в
// каталоге» и вопросы клиенту — на втором листе: молча в счёт они не попадают.

const { zip } = require('./zip');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => String.fromCharCode(65 + i);

function sheet(rows) {
  const body = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => {
    const ref = `${col(c)}${r + 1}`;
    if (v == null || v === '') return '';
    return typeof v === 'number'
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function workbook(sheets) {
  const names = sheets.map(([name], i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const types = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${types}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(rows)]),
  ]);
}

class InvoiceExport {
  constructor(catalog) {
    this.catalog = catalog;
  }

  // строки черновика (как в backbone_order_lines) → { buffer, included, left, sum }
  of(lines) {
    const ready = (l) => l.state === 'accepted' && l.sku && l.invoice_qty != null && this.catalog.bySku(l.sku);
    const included = lines.filter(ready);
    const left = lines.filter((l) => !ready(l));
    const money = (x) => Math.round(x * 100) / 100;
    const invoice = [
      ['Артикул', 'Номенклатура', 'Количество', 'Ед.', 'Цена', 'Сумма'],
      ...included.map((l) => {
        const item = this.catalog.bySku(l.sku);
        return [l.sku, item.name, l.invoice_qty, item.unit, l.price, money(l.invoice_qty * l.price)];
      }),
    ];
    const why = (l) => (l.state === 'missing' ? 'нет в каталоге' : l.state === 'ask' ? 'выбрать позицию' : 'нет количества');
    const notes = [
      ['Стр.', 'Как написал клиент', 'Что с ней', 'Вопрос клиенту'],
      ...lines.filter((l) => !ready(l) || l.question).map((l) => [l.position, l.source, ready(l) ? 'в счёте' : why(l), l.question || '']),
    ];
    return {
      buffer: workbook([['Счёт', invoice], ['Вопросы и пропуски', notes]]),
      included: included.length,
      left: left.length,
      sum: money(included.reduce((s, l) => s + l.invoice_qty * l.price, 0)),
    };
  }
}

module.exports = { InvoiceExport };
