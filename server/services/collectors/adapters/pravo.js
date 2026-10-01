// Адаптер «Официальное опубликование правовых актов» (publication.pravo.gov.ru).
// Отдаёт страницы от новых к старым; раннер перестаёт листать на странице без новых актов.
// В списке API текста нет — только реквизиты; текст акта живёт в PDF по /file/pdf
// (официальные документы не объекты авторского права, ст. 1259 п. 6 ГК РФ).
const { fetchJson, fetchBuffer, SourceHttpError } = require('../http');
const { plainText, parseMoscowDate } = require('../text');

const API_BASE = 'http://publication.pravo.gov.ru';

function fromDocument(doc) {
  const eoNumber = plainText(doc.eoNumber);
  return {
    externalId: eoNumber || plainText(doc.id),
    url: `${API_BASE}/document/${encodeURIComponent(eoNumber || doc.id)}`,
    title: plainText(doc.complexName || doc.title || doc.name),
    lead: null,
    body: null,
    publishedAt: parseMoscowDate(doc.publishDateShort),
    meta: {
      number: plainText(doc.number) || null,
      documentDate: plainText(doc.documentDate).slice(0, 10) || null,
      registration: plainText(doc.jdRegNumber) || null,
      pages: Number(doc.pagesCount) || null,
    },
  };
}

async function* pages(source, ctx) {
  const { block, pageSize = 100, maxPages = 1 } = source.settings;
  for (let index = 1; index <= maxPages; index += 1) {
    const url = `${API_BASE}/api/Documents?block=${encodeURIComponent(block)}&PageSize=${pageSize}&Index=${index}`;
    const data = await fetchJson(url, {
      signal: ctx.signal,
      timeoutMs: ctx.pageTimeoutMs,
      maxBytes: ctx.maxBytes,
    });
    const items = (data.items || []).map(fromDocument).filter((item) => item.externalId && item.title);
    yield items;
    if (!items.length || index >= Number(data.pagesTotalCount || 0)) return;
  }
}

// Текст акта: PDF по номеру опубликования. pdf-parse (pdf.js) тяжёл и нужен только
// здесь — подключается лениво, опрос лент его не тянет.
let pdfParseCtor;
function getPdfParse() {
  pdfParseCtor ??= require('pdf-parse').PDFParse;
  return pdfParseCtor;
}

async function fetchActPdf(eoNumber, ctx) {
  const { buffer } = await fetchBuffer(`${API_BASE}/file/pdf?eoNumber=${encodeURIComponent(eoNumber)}`, {
    signal: ctx.signal,
    timeoutMs: ctx.pageTimeoutMs,
    maxBytes: ctx.maxBytes,
    accept: 'application/pdf',
  });
  return buffer;
}

async function extractPdfText(buffer) {
  const parser = new (getPdfParse())({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    throw new SourceHttpError('bad_pdf', `PDF не разбирается: ${err.message}`);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

module.exports = {
  pages,
  fetchActPdf,
  extractPdfText,
};
