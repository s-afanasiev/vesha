const config = require('../config');

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

function buildQueries(baseQueries) {
  const bases = (baseQueries || []).filter(Boolean).slice(0, 2);
  if (!bases.length) bases.push('купить одежду');
  const out = [];
  for (const q of bases) {
    out.push(q);
    out.push(`${q} site:wildberries.ru`);
    out.push(`${q} site:ozon.ru`);
  }
  return out.slice(0, 6);
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

function normalizeResults(raw, query) {
  const organic = Array.isArray(raw.organic_results) ? raw.organic_results : [];
  return organic.map((item, idx) => {
    const url = item.link || item.url || '';
    const title = item.title || 'Без названия';
    const snippet = item.snippet || item.description || '';
    const priceText = item.price || item.rich_snippet?.top?.detected_extensions?.price || '';
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
    };
  }).filter((o) => o.url);
}

async function searchOffers(searchQueries) {
  const queries = buildQueries(searchQueries);
  const jobs = [];
  const offers = [];
  const seen = new Set();

  for (const query of queries) {
    try {
      const raw = await searchYandex(query);
      const normalized = normalizeResults(raw, query);
      jobs.push({ query, status: 'done', raw_response: raw, error: null, offers: normalized });
      for (const o of normalized) {
        const key = o.url.split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        offers.push(o);
      }
    } catch (err) {
      jobs.push({
        query,
        status: 'failed',
        raw_response: null,
        error: err.message,
        offers: [],
      });
    }
  }

  offers.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { jobs, offers };
}

/** Demo offers when SerpAPI is not configured — keeps UI/dev usable. */
function mockOffers(searchQueries) {
  const q = (searchQueries && searchQueries[0]) || 'футболка';
  return {
    jobs: [
      {
        query: q,
        status: 'done',
        raw_response: { mock: true },
        error: null,
        offers: [],
      },
    ],
    offers: [
      {
        shop: 'wildberries',
        title: `${q} — пример WB (demo без SERPAPI_API_KEY)`,
        url: `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(q)}`,
        price_cents: 199900,
        currency: 'RUB',
        thumbnail_url: null,
        snippet: 'Демо-оффер. Добавьте SERPAPI_API_KEY для живого поиска.',
        score: 0.9,
      },
      {
        shop: 'ozon',
        title: `${q} — пример Ozon (demo без SERPAPI_API_KEY)`,
        url: `https://www.ozon.ru/search/?text=${encodeURIComponent(q)}`,
        price_cents: 219900,
        currency: 'RUB',
        thumbnail_url: null,
        snippet: 'Демо-оффер. Добавьте SERPAPI_API_KEY для живого поиска.',
        score: 0.85,
      },
    ],
  };
}

async function runSearch(searchQueries) {
  if (!config.serpapiApiKey) {
    return mockOffers(searchQueries);
  }
  return searchOffers(searchQueries);
}

module.exports = { runSearch, detectShop, buildQueries };
