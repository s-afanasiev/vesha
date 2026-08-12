const WB_SEARCH_VERSIONS = ['v18', 'v14', 'v9'];

function wbHeaders(query) {
  const q = encodeURIComponent(query);
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    Origin: 'https://www.wildberries.ru',
    Referer: `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}`,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractProducts(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.products)) return data.products;
  if (Array.isArray(data.data?.products)) return data.data.products;
  return [];
}

function priceCentsFromProduct(p) {
  const sizePrice = p.sizes?.find((s) => s?.price?.product != null)?.price;
  if (sizePrice?.product != null) return Number(sizePrice.product);
  if (p.salePriceU != null) return Number(p.salePriceU);
  if (p.priceU != null) return Number(p.priceU);
  if (p.salePrice != null) return Math.round(Number(p.salePrice) * 100);
  if (p.price != null) return Math.round(Number(p.price) * 100);
  return null;
}

/** Best-effort thumbnail from nmId (WB basket hosts change over time). */
function wbThumbnailUrl(id) {
  const nm = Number(id);
  if (!Number.isFinite(nm) || nm <= 0) return null;
  const vol = Math.floor(nm / 100000);
  const part = Math.floor(nm / 1000);
  // Host bands approximate; if image 404 UI still has title/url
  let basket = '01';
  if (vol >= 0 && vol <= 143) basket = '01';
  else if (vol <= 287) basket = '02';
  else if (vol <= 431) basket = '03';
  else if (vol <= 719) basket = '04';
  else if (vol <= 1007) basket = '05';
  else if (vol <= 1061) basket = '06';
  else if (vol <= 1115) basket = '07';
  else if (vol <= 1169) basket = '08';
  else if (vol <= 1313) basket = '09';
  else if (vol <= 1601) basket = '10';
  else if (vol <= 1655) basket = '11';
  else if (vol <= 1919) basket = '12';
  else if (vol <= 2045) basket = '13';
  else basket = '14';
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${nm}/images/c246x328/1.webp`;
}

function normalizeWbProducts(products, query) {
  return (products || [])
    .map((p, idx) => {
      const id = p.id || p.nmId || p.nm_id;
      if (!id) return null;
      const brand = p.brand ? String(p.brand) : '';
      const name = p.name ? String(p.name) : 'Товар WB';
      const title = brand ? `${brand} — ${name}` : name;
      const colors = Array.isArray(p.colors)
        ? p.colors.map((c) => c.name || c).filter(Boolean).join(', ')
        : '';
      const rating = p.reviewRating ?? p.rating;
      const snippetParts = [
        colors ? `цвет: ${colors}` : '',
        rating != null ? `рейтинг ${rating}` : '',
        p.supplier ? `продавец: ${p.supplier}` : '',
      ].filter(Boolean);

      return {
        shop: 'wildberries',
        title,
        url: `https://www.wildberries.ru/catalog/${id}/detail.aspx`,
        price_cents: priceCentsFromProduct(p),
        currency: 'RUB',
        thumbnail_url: wbThumbnailUrl(id),
        snippet: snippetParts.join(' · ') || `WB · запрос: ${query}`,
        score: Math.max(0, 1.1 - idx * 0.04),
        query,
        source: 'wildberries',
      };
    })
    .filter(Boolean);
}

async function fetchWbSearchOnce(query, version) {
  const params = new URLSearchParams({
    appType: '1',
    curr: 'rub',
    dest: '-1257786',
    lang: 'ru',
    page: '1',
    query,
    resultset: 'catalog',
    sort: 'popular',
    spp: '30',
  });
  const url = `https://search.wb.ru/exactmatch/ru/common/${version}/search?${params}`;
  const res = await fetch(url, { headers: wbHeaders(query) });
  const text = await res.text();
  if (res.status === 429) {
    const err = new Error('WB rate limit 429');
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`WB HTTP ${res.status}`);
  }
  if (!text || text.trimStart().startsWith('<')) {
    throw new Error('WB вернул не-JSON');
  }
  return JSON.parse(text);
}

/**
 * Search Wildberries catalog via public frontend endpoint.
 * Returns { products, raw, version } or throws.
 */
async function searchWildberries(query, { retries = 3 } = {}) {
  let lastErr;
  for (const version of WB_SEARCH_VERSIONS) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const raw = await fetchWbSearchOnce(query, version);
        const products = extractProducts(raw);
        return { products, raw, version };
      } catch (err) {
        lastErr = err;
        const wait = err.status === 429 ? 900 * (attempt + 1) : 350 * (attempt + 1);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error('WB search failed');
}

async function searchWildberriesOffers(query, limit = 20) {
  const { products, raw, version } = await searchWildberries(query);
  const offers = normalizeWbProducts(products, query).slice(0, limit);
  return { offers, raw, version };
}

module.exports = {
  searchWildberries,
  searchWildberriesOffers,
  normalizeWbProducts,
  wbThumbnailUrl,
};
