// Адаптер 2ГИС — первый ресурс карточного контракта каркаса
// (docs/collectors-architecture.md, ступень 2): листинг поиска, карточка места,
// лента оценок места (публичный reviews API). Устройство страниц 2ГИС живёт только
// здесь: наружу уходят нормализованные записи, разбор страниц радары не знают.
// Пауза и стоп по 403/429 — обёртка Patience, а не этот файл (П19).
//
// Контракт:
//   listing(city, query, page, { signal }) → [{ branch_id, name, address, rubrics }]; за концом выдачи — []
//   firm(city, branchId, { signal })       → карточка места или null
//   reviews(branchId, { limit, signal }) → [{ review_id, rating, date_created, date_edited, provider, text, has_official_answer }]

const { fetchText, fetchJson, SourceHttpError } = require('./http');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

// Состояние страницы 2ГИС лежит строкой в var initialState = JSON.parse('…').
function parseInitialState(html) {
  const marker = "var initialState = JSON.parse('";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const s = start + marker.length;
  const end = html.indexOf("');", s);
  return end < 0 ? null : JSON.parse(html.slice(s, end).replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

function placesOf(state) {
  return Object.entries((state && state.data && state.data.entity && state.data.entity.profile) || {})
    .map(([id, p]) => ({ id, d: (p && p.data) || {} }))
    .filter(({ d }) => d.name)
    .map(({ id, d }) => ({
      branch_id: id,
      name: d.name,
      address: d.address_name || '',
      rubrics: (d.rubrics || []).map((r) => r.name).filter(Boolean),
    }));
}

function cardOf(branchId, d) {
  const contacts = (d.contact_groups || []).flatMap((g) => g.contacts || []);
  const ofType = (...types) => contacts.filter((c) => types.includes(c.type)).map((c) => String(c.text || c.value || c.url || ''));
  const attributes = (d.attribute_groups || []).flatMap((g) => (g.attributes || []).map((a) => a.name));
  return {
    branch_id: branchId,
    name: d.name,
    address: d.address_name || null,
    rubrics: (d.rubrics || []).map((r) => r.name).filter(Boolean),
    phones: ofType('phone'),
    websites: ofType('website'),
    messengers: ofType('whatsapp', 'telegram', 'viber'),
    socials: ofType('vkontakte', 'instagram', 'facebook', 'ok', 'youtube', 'twitter', 'rutube', 'zen'),
    email: ofType('email').length > 0,
    schedule: Boolean(d.schedule && Object.keys(d.schedule).length),
    attributes,
    unconfirmed: attributes.some((a) => /Актуальность данных не подтверждена/i.test(a)),
    hasGoods: Boolean(d.has_goods || d.has_pinned_goods),
    promoted: Boolean(d.is_promoted),
    branches: (d.org && d.org.branch_count) || 1,
    rating: d.reviews ? d.reviews.general_rating ?? d.reviews.rating ?? null : null,
    reviewsCount: d.reviews ? d.reviews.general_review_count ?? d.reviews.count ?? null : null,
  };
}

function reviewOf(r) {
  return {
    review_id: String(r.id),
    rating: r.rating,
    date_created: r.date_created,
    date_edited: r.date_edited || null,
    provider: r.provider || null,
    text: r.text || '',
    has_official_answer: !!r.official_answer,
  };
}

class TwoGis {
  constructor({ reviewsKey, timeoutMs = 20000, maxBytes = 8 * 1024 * 1024 }) {
    this.reviewsKey = reviewsKey;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.methods = ['listing', 'firm', 'reviews'];
  }

  async listing(city, query, page, { signal } = {}) {
    const base = `https://2gis.ru/${city}/search/${encodeURIComponent(query)}`;
    try {
      const { text } = await fetchText(page === 1 ? base : `${base}/page/${page}`, this._opts(signal, BROWSER_HEADERS));
      return placesOf(parseInitialState(text));
    } catch (err) {
      if (err instanceof SourceHttpError && err.status === 404) return []; // за концом выдачи
      throw err;
    }
  }

  async firm(city, branchId, { signal } = {}) {
    try {
      const { text } = await fetchText(`https://2gis.ru/${city}/firm/${branchId}`, this._opts(signal, BROWSER_HEADERS));
      const state = parseInitialState(text);
      const d = state && Object.values((state.data && state.data.entity && state.data.entity.profile) || {})[0];
      return d && d.data ? cardOf(branchId, d.data) : null;
    } catch (err) {
      if (err instanceof SourceHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async reviews(branchId, { limit = 10, signal } = {}) {
    const url = `https://public-api.reviews.2gis.com/3.0/branches/${branchId}/reviews`
      + `?limit=${limit}&offset=0&is_advertiser=false&fields=meta.total_count`
      + `&rated=true&sort_by=date_edited&key=${this.reviewsKey}&locale=ru_RU`;
    const data = await fetchJson(url, this._opts(signal, { 'User-Agent': BROWSER_HEADERS['User-Agent'] }));
    return (data.reviews || []).map(reviewOf);
  }

  _opts(signal, headers) {
    return { signal, timeoutMs: this.timeoutMs, maxBytes: this.maxBytes, headers };
  }
}

module.exports = { TwoGis, parseInitialState, placesOf, cardOf, reviewOf, BROWSER_HEADERS };
