const config = require('../config');
const { buildSearchPlan, rerankOffers } = require('./queryBuilder');
const { searchWildberriesOffers } = require('./wildberries');

function detectShop(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('wildberries.ru') || u.includes('wb.ru')) return 'wildberries';
  if (u.includes('ozon.ru')) return 'ozon';
  return 'other';
}

function parsePriceCents(text) {
  if (!text) return null;
  const m = String(text).replace(/\s/g, '').match(/(\d[\d\s]*)([.,]\d{2})?/);
  if (!m) return null;
  const whole = m[1].replace(/\D/g, '');
  if (!whole) return null;
  const frac = m[2] ? m[2].slice(1) : '00';
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

async function searchYandex(query) {
  if (!config.serpapiApiKey) {
    throw new Error('SERPAPI_API_KEY не задан');
  }
  const params = new URLSearchParams({
    engine: 'yandex',
    q: query,
    api_key: config.serpapiApiKey,
    yandex_domain: 'yandex.ru',
    lang: 'ru',
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `SerpAPI HTTP ${res.status}`);
  }
  return data;
}

function normalizeYandexResults(raw, query) {
  const organic = Array.isArray(raw.organic_results) ? raw.organic_results : [];
  return organic
    .map((item, idx) => {
      const url = item.link || item.url || '';
      const title = item.title || 'Без названия';
      const snippet = item.snippet || item.description || '';
      const priceText =
        item.price || item.rich_snippet?.top?.detected_extensions?.price || '';
      return {
        shop: detectShop(url),
        title,
        url,
        price_cents: parsePriceCents(priceText) || parsePriceCents(snippet) || parsePriceCents(title),
        currency: 'RUB',
        thumbnail_url: item.thumbnail || item.favicon || null,
        snippet,
        score: Math.max(0, 1 - idx * 0.05) + (detectShop(url) !== 'other' ? 0.15 : 0),
        query,
        source: 'serpapi_yandex',
      };
    })
    .filter((o) => o.url);
}

function pushUnique(offers, seen, items) {
  for (const o of items) {
    const key = (o.url || '').split('?')[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    offers.push(o);
  }
}

/**
 * Primary: direct WB search with detailed bases.
 * Fallback: SerpAPI Yandex (if key) for Ozon/web coverage.
 */
async function searchOffers(attributes) {
  const plan = buildSearchPlan(attributes);
  const jobs = [];
  const offers = [];
  const seen = new Set();

  // Use plain bases (no site:) — WB search eats full detail strings
  const wbQueries = (plan.bases || []).slice(0, 3);
  for (const query of wbQueries) {
    try {
      const { offers: wbOffers, raw, version } = await searchWildberriesOffers(query, 24);
      jobs.push({
        provider: 'wildberries',
        query: `[WB] ${query}`,
        status: 'done',
        raw_response: { version, total: wbOffers.length, sample: raw?.metadata || null },
        error: null,
      });
      pushUnique(offers, seen, wbOffers);
      // Small pause to reduce 429
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      jobs.push({
        provider: 'wildberries',
        query: `[WB] ${query}`,
        status: 'failed',
        raw_response: null,
        error: err.message,
      });
    }
  }

  const needFallback = offers.length < 4 && Boolean(config.serpapiApiKey);
  if (needFallback) {
    const yandexQueries = (plan.queries || []).filter((q) => q.includes('site:ozon')).slice(0, 2);
    const extras = (plan.bases || []).slice(0, 1).map((q) => `${q} site:ozon.ru`);
    const list = [...new Set([...yandexQueries, ...extras])].slice(0, 2);

    for (const query of list) {
      try {
        const raw = await searchYandex(query);
        const normalized = normalizeYandexResults(raw, query);
        jobs.push({
          provider: 'serpapi_yandex',
          query,
          status: 'done',
          raw_response: raw,
          error: null,
        });
        pushUnique(offers, seen, normalized);
      } catch (err) {
        jobs.push({
          provider: 'serpapi_yandex',
          query,
          status: 'failed',
          raw_response: null,
          error: err.message,
        });
      }
    }
  }

  // If WB failed and no SerpAPI — still expose Ozon search links for top bases
  if (!offers.length && !config.serpapiApiKey) {
    const q = plan.bases[0] || 'одежда';
    jobs.push({
      provider: 'link_fallback',
      query: q,
      status: 'done',
      raw_response: { note: 'WB недоступен, отдаём ссылки на поиск' },
      error: null,
    });
    pushUnique(offers, seen, [
      {
        shop: 'wildberries',
        title: `${q} — открыть поиск WB`,
        url: `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(q)}`,
        price_cents: null,
        currency: 'RUB',
        thumbnail_url: null,
        snippet: 'Прямой поиск WB временно недоступен (лимит/блок).',
        score: 0.5,
        query: q,
        source: 'link_fallback',
      },
      {
        shop: 'ozon',
        title: `${q} — открыть поиск Ozon`,
        url: `https://www.ozon.ru/search/?text=${encodeURIComponent(q)}`,
        price_cents: null,
        currency: 'RUB',
        thumbnail_url: null,
        snippet: 'Ссылка на поиск Ozon с тем же детальным запросом.',
        score: 0.45,
        query: q,
        source: 'link_fallback',
      },
    ]);
  }

  const ranked = rerankOffers(offers, attributes);
  return {
    jobs,
    offers: ranked,
    searchPlan: plan,
  };
}

async function runSearch(attributes) {
  const attrs =
    attributes && typeof attributes === 'object' && !Array.isArray(attributes)
      ? attributes
      : { search_queries: Array.isArray(attributes) ? attributes : [] };

  return searchOffers(attrs);
}

module.exports = {
  runSearch,
  detectShop,
  buildSearchPlan,
};
