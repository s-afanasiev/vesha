// Разовый сбор сырого корпуса отзывов 2ГИС для радара болей (выборка, не продукт).
// Правила бережливости: троттлинг между запросами, последовательный обход, без ретраев против защиты,
// при 403/429 — остановка с причиной. recursive setTimeout вместо setInterval.
// Выход: data/pain-radar-corpus/ — orgs.json, raw/reviews-<id>.json, reviews.ndjson, log.jsonl.

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'pain-radar-corpus');

const CONFIG = {
  city: 'kursk',
  rubric: { slug: 'Шиномонтаж', rubricId: '7689' },
  listingPages: 7,          // «Места 195» — 7 страниц выдачи
  throttleMs: 1600,         // пауза между запросами
  maxReviewsPerOrg: 150,    // потолок на организацию (limit 50 × 3 страницы)
  reviewsLimit: 50,
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};
const REVIEWS_KEY = '6e7e1929-4ea9-4a5d-8c05-d601860389bd'; // публичный фронтовый ключ 2ГИС

const logFile = join(OUT, 'log.jsonl');
let throttle = () => new Promise(r => setTimeout(r, CONFIG.throttleMs));
let stopped = null;

function log(entry) {
  appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

async function fetchOnce(url, kind) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: kind === 'api' ? { 'User-Agent': UA } : HEADERS });
    const bytes = Number(res.headers.get('content-length') || 0);
    log({ url: url.slice(0, 160), kind, status: res.status, ms: Date.now() - started, bytes });
    return res;
  } catch (e) {
    log({ url: url.slice(0, 160), kind, error: String(e), ms: Date.now() - started });
    throw e;
  }
}

// 403/429 — источник просит остановиться: фиксируем причину и прерываем сбор целиком
function guard(res, url) {
  if (res.status === 403 || res.status === 429) {
    stopped = `${res.status} на ${url.slice(0, 100)}`;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url.slice(0, 100)}`);
  return res;
}

// initialState = JSON.parse('<js-строка в одинарных кавычках>')
function parseInitialState(html) {
  const start = html.indexOf("var initialState = JSON.parse('");
  if (start < 0) return null;
  const s = start + "var initialState = JSON.parse('".length;
  const end = html.indexOf("');", s);
  if (end < 0) return null;
  const literal = html.slice(s, end).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  return JSON.parse(literal);
}

function orgsFromListing(html) {
  const st = parseInitialState(html);
  const profile = st?.data?.entity?.profile || {};
  const out = [];
  for (const [id, p] of Object.entries(profile)) {
    const d = p?.data || {};
    if (!d.name) continue;
    out.push({
      branch_id: id,
      name: d.name,
      rating: d.reviews?.rating ?? null,
      reviews_count: d.reviews?.count ?? null,
      address: d.address_name ?? null,
      main_rubric: d.main_rubric?.name ?? null,
    });
  }
  return out;
}

async function listingStage() {
  const slug = encodeURIComponent(CONFIG.rubric.slug);
  const base = `https://2gis.ru/${CONFIG.city}/search/${slug}/rubricId/${CONFIG.rubric.rubricId}`;
  const orgs = new Map();
  for (let page = 1; page <= CONFIG.listingPages; page++) {
    if (stopped) break;
    const url = page === 1 ? base : `${base}/page/${page}`;
    const res = guard(await fetchOnce(url, 'listing'), url);
    const html = await res.text();
    const found = orgsFromListing(html);
    let fresh = 0;
    for (const o of found) if (!orgs.has(o.branch_id)) { orgs.set(o.branch_id, o); fresh++; }
    console.log(`листинг стр.${page}: ${found.length} организаций, новых ${fresh}`);
    await throttle();
  }
  return orgs;
}

async function reviewsStage(orgs) {
  mkdirSync(join(OUT, 'raw'), { recursive: true });
  const ndjson = join(OUT, 'reviews.ndjson');
  const fields = 'meta.branch_rating,meta.branch_reviews_count,meta.total_count';
  let done = 0;
  for (const org of orgs.values()) {
    if (stopped) break;
    let offset = 0, saved = 0;
    while (offset < CONFIG.maxReviewsPerOrg && !stopped) {
      const url = `https://public-api.reviews.2gis.com/3.0/branches/${org.branch_id}/reviews` +
        `?limit=${CONFIG.reviewsLimit}&offset=${offset}&is_advertiser=false&fields=${fields}` +
        `&rated=true&sort_by=date_edited&key=${REVIEWS_KEY}&locale=ru_RU`;
      let j;
      try {
        j = await (await guard(await fetchOnce(url, 'api'), url)).json();
      } catch {
        break; // сетевая ошибка на организации — пропускаем её, продолжаем сбор
      }
      const reviews = j.reviews || [];
      writeFileSync(join(OUT, 'raw', `reviews-${org.branch_id}.json`), JSON.stringify({ org: org.branch_id, fetched_at: new Date().toISOString(), page_offset: offset, payload: j }, null, 1));
      for (const r of reviews) {
        appendFileSync(ndjson, JSON.stringify({
          branch_id: org.branch_id, org_name: org.name, review_id: r.id,
          rating: r.rating, date_created: r.date_created, date_edited: r.date_edited,
          provider: r.provider, text: r.text ?? '', has_official_answer: !!r.official_answer,
        }) + '\n');
        saved++;
      }
      const total = j.meta?.total_count ?? 0;
      offset += CONFIG.reviewsLimit;
      if (reviews.length < CONFIG.reviewsLimit || offset >= total) break;
      await throttle();
    }
    done++;
    console.log(`[${done}/${orgs.size}] ${org.name}: отзывов ${saved}`);
    await throttle();
  }
}

const meta = () => ({
  config: CONFIG, started: new Date().toISOString(),
});

if (existsSync(logFile)) { try { appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), session: 'start', config: CONFIG }) + '\n'); } catch {} }
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta(), null, 1));

console.log('=== Этап 1: листинг рубрики', CONFIG.rubric.slug, CONFIG.city, '===');
const orgs = await listingStage();
if (stopped) {
  console.error('СБОР ОСТАНОВЛЕН НА ЭТАПЕ ЛИСТИНГА:', stopped);
  log({ stopped });
  process.exit(2);
}
writeFileSync(join(OUT, 'orgs.json'), JSON.stringify([...orgs.values()], null, 1));
console.log(`Итого организаций: ${orgs.size}`);

console.log('=== Этап 2: отзывы по организациям ===');
await reviewsStage(orgs);

if (stopped) {
  console.error('СБОР ОСТАНОВЛЕН (источник попросил):', stopped);
  log({ stopped });
  process.exit(2);
}
console.log('Готово. Лог:', logFile);
