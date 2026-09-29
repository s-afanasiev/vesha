// Адаптер «Официальное опубликование правовых актов» (publication.pravo.gov.ru).
// Отдаёт страницы от новых к старым; раннер перестаёт листать на странице без новых актов.
// Официальные документы не объекты авторского права, но в списке API текста нет — только реквизиты.
const { fetchJson } = require('../http');
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

module.exports = {
  pages,
};
