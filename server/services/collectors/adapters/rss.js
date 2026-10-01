// Адаптер RSS 2.0 / Atom: лента → одна пачка записей.
// У СМИ берём заголовок, лид и ссылку; полный текст (content:encoded, yandex:full-text) не храним.
const { XMLParser } = require('fast-xml-parser');
const { fetchText, SourceHttpError } = require('../http');
const { plainText, parseFeedDate } = require('../text');

const LEAD_MAX_CHARS = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  processEntities: true,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'category', 'link'].includes(name),
});

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function atomLink(links) {
  const list = [].concat(links || []);
  const alternate = list.find((l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'));
  const chosen = alternate || list[0];
  return typeof chosen === 'object' ? chosen['@_href'] : chosen;
}

function categories(value) {
  return [].concat(value || [])
    .map((c) => plainText(typeof c === 'object' ? c['#text'] ?? c['@_term'] : c))
    .filter(Boolean);
}

function fromRssItem(item) {
  const link = plainText(first(item.link));
  const guid = plainText(item.guid);
  return {
    externalId: guid || link,
    url: link || guid,
    title: plainText(item.title),
    lead: plainText(item.description, LEAD_MAX_CHARS),
    body: null,
    publishedAt: parseFeedDate(item.pubDate || item['dc:date']),
    meta: { categories: categories(item.category) },
  };
}

function fromAtomEntry(entry) {
  const link = plainText(atomLink(entry.link));
  const id = plainText(entry.id);
  return {
    externalId: id || link,
    url: link || id,
    title: plainText(entry.title),
    lead: plainText(entry.summary || entry.content, LEAD_MAX_CHARS),
    body: null,
    publishedAt: parseFeedDate(entry.published || entry.updated),
    meta: { categories: categories(entry.category) },
  };
}

function parseFeed(xml) {
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new SourceHttpError('bad_feed', `Лента не разбирается как XML: ${err.message}`);
  }
  if (doc.rss && doc.rss.channel) {
    return [].concat(first(doc.rss.channel).item || []).map(fromRssItem);
  }
  if (doc.feed) {
    return [].concat(doc.feed.entry || []).map(fromAtomEntry);
  }
  if (doc['rdf:RDF']) {
    return [].concat(doc['rdf:RDF'].item || []).map(fromRssItem);
  }
  throw new SourceHttpError('bad_feed', 'Ответ не похож на RSS или Atom');
}

async function* pages(source, ctx) {
  const { feedUrl } = source.settings;
  const { text } = await fetchText(feedUrl, {
    signal: ctx.signal,
    timeoutMs: ctx.pageTimeoutMs,
    maxBytes: ctx.maxBytes,
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  });
  yield parseFeed(text).filter((item) => item.externalId && item.title);
}

module.exports = {
  pages,
  parseFeed,
};
