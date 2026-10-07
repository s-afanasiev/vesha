// Пульт сбора сырых данных 2ГИС (pain-radar): одна очередь запросов с троттлингом,
// счётчики обращений (чтобы не злоупотреблять источником), живой лог, записи в файлы корпуса.
// Роут /api/pain-radar/scrape/* тонкий, вся механика здесь. Рекурсивный setTimeout, не setInterval.

const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const REVIEWS_KEY = '6e7e1929-4ea9-4a5d-8c05-d601860389bd'; // публичный фронтовый ключ 2ГИС
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const LIMITS = {
  minIntervalMs: 1200,      // пауза между любыми обращениями к 2ГИС
  maxPages: 20,             // потолок страниц листинга за джобу
  maxReviewsPerOrg: 300,    // потолок отзывов на организацию
  maxOrgsPerJob: 120,       // потолок организаций за джобу (чекбоксы в UI)
  sessionLimit: 600,        // стоп после N обращений за жизнь процесса
  logKeep: 400,             // строк живого лога в памяти
};

const state = {
  dataDir: 'data/pain-radar-corpus',
  paused: false,
  blockReason: null,
  counters: { total: 0, byKind: {}, startedAt: null },
  minute: [],               // метки времени обращений за последнюю минуту
  perBase: new Map(),       // path без query → сколько раз дёргали
  log: [],                  // кольцевой буфер { ts, kind, status, ms, url }
  queue: [],
  jobs: new Map(),
  jobSeq: 0,
  current: null,
  lastFetchAt: 0,
};

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dataDirAbs(custom) {
  const rel = custom && typeof custom === 'string' && custom.trim() ? custom.trim() : state.dataDir;
  const abs = path.resolve(PROJECT_ROOT, rel);
  if (!abs.startsWith(PROJECT_ROOT)) throw new Error('Путь должен быть внутри проекта');
  fs.mkdirSync(abs, { recursive: true });
  fs.mkdirSync(path.join(abs, 'raw'), { recursive: true });
  return { rel, abs };
}

function fileStats() {
  let { abs } = dataDirAbs();
  let ndjsonLines = 0, rawFiles = 0, orgFiles = 0;
  try {
    const nd = path.join(abs, 'reviews.ndjson');
    if (fs.existsSync(nd)) ndjsonLines = fs.readFileSync(nd, 'utf8').split('\n').filter(Boolean).length;
    const raw = fs.readdirSync(path.join(abs, 'raw'));
    rawFiles = raw.length;
    orgFiles = fs.readdirSync(abs).filter(f => /^orgs-/.test(f)).length;
  } catch {}
  return { dataDir: state.dataDir, ndjsonLines, rawFiles, orgFiles };
}

function baseOf(url) {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch { return url.slice(0, 120); }
}

function logLine(kind, status, ms, url, note) {
  state.log.push({ ts: nowIso(), kind, status, ms, url, note: note || '' });
  if (state.log.length > LIMITS.logKeep) state.log.splice(0, state.log.length - LIMITS.logKeep);
}

async function waitTurn() {
  if (state.blockReason) throw new Error(`Сбор остановлен: ${state.blockReason}`);
  while (state.paused) {
    logLine('paused', 0, 0, '', 'пауза');
    await sleep(800);
    if (state.blockReason) throw new Error(`Сбор остановлен: ${state.blockReason}`);
  }
  if (state.counters.total >= LIMITS.sessionLimit) {
    state.blockReason = `лимит сессии ${LIMITS.sessionLimit} обращений`;
    throw new Error(state.blockReason);
  }
  const left = LIMITS.minIntervalMs - (Date.now() - state.lastFetchAt);
  if (left > 0) await sleep(left);
}

async function fetch2gis(kind, url) {
  await waitTurn();
  const started = Date.now();
  let status = 0;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    status = res.status;
    state.counters.total++;
    state.counters.byKind[kind] = (state.counters.byKind[kind] || 0) + 1;
    state.minute.push(Date.now());
    const base = baseOf(url);
    state.perBase.set(base, (state.perBase.get(base) || 0) + 1);
    logLine(kind, status, Date.now() - started, url);
    if (status === 403 || status === 429) {
      state.blockReason = `источник ответил ${status} — стоп, продолжить только после перезапуска сервера`;
      throw new Error(state.blockReason);
    }
    if (!res.ok) throw new Error(`HTTP ${status}: ${baseOf(url)}`);
    return res;
  } catch (e) {
    if (status === 0) logLine(kind, 'net', Date.now() - started, url, String(e));
    throw e;
  } finally {
    state.lastFetchAt = Date.now();
  }
}

function parseInitialState(html) {
  const marker = "var initialState = JSON.parse('";
  const s = html.indexOf(marker);
  if (s < 0) return null;
  const start = s + marker.length;
  const end = html.indexOf("');", start);
  if (end < 0) return null;
  return JSON.parse(html.slice(start, end).replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

// ---- задачи ----

function callRunner(job) {
  const p = job.params || {};
  switch (job.kind) {
    case 'rubrics': return RUNNERS.rubrics(job, p.city, p.dataDir);
    case 'subrubrics': return RUNNERS.subrubrics(job, p.city, p.groupId, p.dataDir);
    case 'listing': return RUNNERS.listing(job, p.city, p.slug, p.rubricId, p.maxPages, p.dataDir);
    case 'search': return RUNNERS.search(job, p.city, p.query, p.maxPages, p.dataDir);
    case 'firmScan': return RUNNERS.firmScan(job, p.city, p.branchIds || [], p.dataDir);
    case 'reviews': return RUNNERS.reviews(job, p.city, p.branchIds || [], p.maxPerOrg, p.dataDir);
    default: throw new Error(`Нет раннера для ${job.kind}`);
  }
}

function createJob(kind, label, params) {
  const job = { id: `j${++state.jobSeq}`, kind, label, params, status: 'queued', progress: { done: 0, total: 0 }, result: null, error: null, created: nowIso() };
  state.jobs.set(job.id, job);
  state.queue.push(job);
  if (!state.current) runQueue();
  return job;
}

let queueRunning = false;
async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (state.queue.length) {
    const job = state.queue.shift();
    state.current = job;
    job.status = 'running';
    job.started = nowIso();
    try {
      job.result = await callRunner(job);
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = String(e.message || e);
    }
    job.finished = nowIso();
    state.current = null;
  }
  queueRunning = false;
}

function orgFromProfile(id, d) {
  const rv = d?.reviews || {};
  return {
    branch_id: id,
    name: d?.name ?? null,
    rating: rv.general_rating ?? rv.rating ?? null,
    reviews_count: rv.general_review_count ?? rv.count ?? null,
    address: d?.address_name ?? null,
    site: extractWebsite(d),
    phones: extractPhones(d).length,
    socials: extractSocials(d).length,
  };
}

function contactsOf(d) {
  const out = { website: [], phone: [], social: [] };
  for (const g of d?.contact_groups || []) {
    for (const c of g?.contacts || []) {
      const t = c?.type || '';
      const url = c?.url || c?.value || '';
      if (t === 'website') out.website.push(url);
      else if (t === 'phone') out.phone.push(c?.text || url);
      else out.social.push(url);
    }
  }
  return out;
}
function extractWebsite(d) { return contactsOf(d).website[0] || null; }
function extractPhones(d) { return contactsOf(d).phone; }
function extractSocials(d) { return contactsOf(d).social; }

function rubricsFromState(st) {
  const rub = st?.data?.rubricator || {};
  const items = rub.items || {};
  const lists = rub.lists || {};
  const rootList = Object.values(lists).find(l => Array.isArray(l?.data)) || { data: [] };
  return rootList.data
    .map(id => items[id])
    .filter(Boolean)
    .filter(it => it.type !== 'pseudorubric')
    .map(it => ({ id: it.id, name: it.name, type: it.type, branch_count: it.branch_count ?? null }));
}

function subrubricsFromState(st, groupId) {
  const rub = st?.data?.rubricator || {};
  const items = rub.items || {};
  const list = listsFind(rub.lists, groupId);
  return (list || [])
    .map(id => items[id])
    .filter(Boolean)
    .filter(it => it.type !== 'pseudorubric')
    .map(it => ({ id: it.id, name: it.name, type: it.type, branch_count: it.branch_count ?? null }));
}
function listsFind(lists, groupId) {
  const key = Object.keys(lists || {}).find(k => k.endsWith(`_${groupId}_ru_RU`));
  return key ? lists[key].data : null;
}

function orgsFromListingState(st) {
  const profile = st?.data?.entity?.profile || {};
  const out = [];
  for (const [id, p] of Object.entries(profile)) {
    const d = p?.data || {};
    if (!d?.name) continue;
    out.push(orgFromProfile(id, d));
  }
  return out;
}

function paginationTotal(st) {
  const profiles = st?.data?.search?.profile || {};
  const entry = Object.values(profiles)[0];
  const d = entry?.data || entry || {};
  return typeof d.total === 'number' ? d.total : null;
}

const RUNNERS = {
  async rubrics(job, city, dataDir) {
    const { abs, rel } = dataDirAbs(dataDir);
    const url = `https://2gis.ru/${city}/rubrics`;
    const res = await fetch2gis('rubrics', url);
    const st = parseInitialState(await res.text());
    if (!st) throw new Error('initialState не найден — вёрстка изменилась');
    const items = rubricsFromState(st);
    fs.writeFileSync(path.join(abs, `raw/rubrics-${city}.json`), JSON.stringify({ city, url, fetched_at: nowIso(), items }, null, 1));
    return { city, url, count: items.length, items };
  },

  async subrubrics(job, city, groupId, dataDir) {
    const { abs } = dataDirAbs(dataDir);
    const url = `https://2gis.ru/${city}/rubrics/subrubrics/${groupId}`;
    const res = await fetch2gis('subrubrics', url);
    const st = parseInitialState(await res.text());
    if (!st) throw new Error('initialState не найден');
    const items = subrubricsFromState(st, groupId);
    fs.writeFileSync(path.join(abs, `raw/subrubrics-${groupId}.json`), JSON.stringify({ city, groupId, url, fetched_at: nowIso(), items }, null, 1));
    return { city, groupId, url, count: items.length, items };
  },

  async listing(job, city, slug, rubricId, maxPages, dataDir) {
    const { abs } = dataDirAbs(dataDir);
    const enc = encodeURIComponent(slug);
    const base = rubricId
      ? `https://2gis.ru/${city}/search/${enc}/rubricId/${rubricId}`
      : `https://2gis.ru/${city}/search/${enc}`;
    const pages = Math.min(maxPages || 1, LIMITS.maxPages);
    job.progress.total = pages;
    const merged = new Map();
    let total = null;
    for (let p = 1; p <= pages; p++) {
      const url = p === 1 ? base : `${base}/page/${p}`;
      const res = await fetch2gis('listing', url);
      const st = parseInitialState(await res.text());
      if (!st) throw new Error('initialState не найден на странице листинга');
      total = paginationTotal(st) ?? total;
      let fresh = 0;
      for (const o of orgsFromListingState(st)) {
        if (!merged.has(o.branch_id)) { merged.set(o.branch_id, o); fresh++; }
      }
      job.progress.done = p;
      job.progress.found = merged.size;
      if (total && merged.size >= total) break;
      await sleep(50); // троттлинг делает fetch2gis
    }
    const orgs = [...merged.values()].slice(0, LIMITS.maxOrgsPerJob);
    const file = `orgs-${rubricId || 'search'}.json`;
    const fileAbs = path.join(abs, file);
    const prev = fs.existsSync(fileAbs) ? JSON.parse(fs.readFileSync(fileAbs, 'utf8')) : { items: [] };
    const byId = new Map(prev.items.map(o => [o.branch_id, o]));
    for (const o of orgs) byId.set(o.branch_id, { ...byId.get(o.branch_id), ...o });
    const payload = { city, rubricId: rubricId || null, slug, url: base, total, fetched_at: nowIso(), items: [...byId.values()] };
    fs.writeFileSync(fileAbs, JSON.stringify(payload, null, 1));
    return { file, total, collected: orgs.length, items: orgs };
  },

  async firmScan(job, city, branchIds, dataDir) {
    const { abs } = dataDirAbs(dataDir);
    job.progress.total = branchIds.length;
    const found = [];
    for (const id of branchIds.slice(0, LIMITS.maxOrgsPerJob)) {
      const url = `https://2gis.ru/${city}/firm/${id}`;
      const res = await fetch2gis('firm', url);
      const st = parseInitialState(await res.text());
      const d = st ? Object.values(st?.data?.entity?.profile || {})[0]?.data : null;
      const org = d?.name ? orgFromProfile(id, d) : null;
      if (org) { org.site = extractWebsite(d); org.site_scanned = true; found.push(org); }
      job.progress.done++;
      await sleep(50);
    }
    // вливаем контакты во все orgs-файлы папки
    const byId = new Map(found.map(o => [o.branch_id, o]));
    for (const f of fs.readdirSync(abs).filter(f => /^orgs-.*\.json$/.test(f))) {
      const p = path.join(abs, f);
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        let changed = false;
        for (const it of data.items || []) {
          const upd = byId.get(it.branch_id);
          if (upd) { Object.assign(it, upd); changed = true; }
        }
        if (changed) fs.writeFileSync(p, JSON.stringify(data, null, 1));
      } catch {}
    }
    return { scanned: found.length, items: found };
  },

  async reviews(job, city, branchIds, maxPerOrg, dataDir) {
    const { abs } = dataDirAbs(dataDir);
    job.progress.total = branchIds.length;
    const nd = path.join(abs, 'reviews.ndjson');
    let savedTotal = 0;
    for (const id of branchIds.slice(0, LIMITS.maxOrgsPerJob)) {
      if (state.blockReason) break;
      let saved = 0, offset = 0;
      const cap = Math.min(maxPerOrg || LIMITS.maxReviewsPerOrg, LIMITS.maxReviewsPerOrg);
      while (offset < cap && !state.blockReason) {
        const url = `https://public-api.reviews.2gis.com/3.0/branches/${id}/reviews` +
          `?limit=50&offset=${offset}&is_advertiser=false&fields=meta.branch_rating,meta.branch_reviews_count,meta.total_count` +
          `&rated=true&sort_by=date_edited&key=${REVIEWS_KEY}&locale=ru_RU`;
        let j;
        try {
          const res = await fetch2gis('reviews', url);
          j = await res.json();
        } catch {
          break;
        }
        const reviews = j.reviews || [];
        fs.writeFileSync(path.join(abs, 'raw', `reviews-${id}.json`), JSON.stringify({ branch_id: id, fetched_at: nowIso(), offset, payload: j }, null, 1));
        for (const r of reviews.slice(0, Math.max(0, cap - offset))) {
          fs.appendFileSync(nd, JSON.stringify({
            branch_id: id, review_id: r.id, rating: r.rating,
            date_created: r.date_created, date_edited: r.date_edited,
            provider: r.provider, text: r.text ?? '', has_official_answer: !!r.official_answer,
          }) + '\n');
          saved++;
        }
        const total = j.meta?.total_count ?? 0;
        offset += 50;
        if (reviews.length < 50 || offset >= Math.min(total, cap)) break;
        await sleep(50);
      }
      savedTotal += saved;
      job.progress.done++;
      job.progress.reviews = savedTotal;
    }
    return { savedTotal };
  },

  async search(job, city, query, maxPages, dataDir) {
    return RUNNERS.listing(job, city, query, null, maxPages, dataDir);
  },
};

// ---- API сервиса ----

function publicState() {
  const cut = Date.now() - 60000;
  state.minute = state.minute.filter(t => t > cut);
  const perBase = [...state.perBase.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([base, count]) => ({ base, count }));
  const jobs = [...state.jobs.values()].slice(-12).map(j => ({
    id: j.id, kind: j.kind, label: j.label, status: j.status,
    progress: j.progress, error: j.error, finished: j.finished, result: j.result,
  }));
  return {
    config: { dataDir: state.dataDir, limits: LIMITS },
    paused: state.paused,
    blockReason: state.blockReason,
    counters: { ...state.counters, perMinute: state.minute.length },
    perBase,
    log: state.log.slice(-40),
    jobs,
    current: state.current ? { id: state.current.id, kind: state.current.kind, label: state.current.label, progress: state.current.progress } : null,
    fileStats: fileStats(),
  };
}

module.exports = {
  LIMITS,
  state,
  publicState,
  setDataDir(rel) { state.dataDir = rel; dataDirAbs(rel); return state.dataDir; },
  setPaused(v) { state.paused = !!v; return state.paused; },
  startJob(kind, params = {}) {
    if (!RUNNERS[kind]) throw new Error(`Неизвестный вид задачи: ${kind}`);
    if (!state.counters.startedAt) state.counters.startedAt = nowIso();
    if (params.city) params.city = String(params.city).replace(/[^0-9a-zа-яё\-]/gi, '');
    if (params.branchIds && !Array.isArray(params.branchIds)) params.branchIds = [];
    return createJob(kind, params.label || kind, params).id;
  },
  getJob(id) {
    const j = state.jobs.get(id);
    if (!j) return null;
    const { params, ...rest } = j;
    return rest;
  },
  readOrgs(dataDir, file) {
    const { abs } = dataDirAbs(dataDir);
    const safe = path.basename(file);
    const p = path.join(abs, safe);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  },
  // «Текущая» выборка организаций: свежайший orgs-*.json папки корпуса по mtime.
  // Листинг/поиск дописывают файл, скан контактов обновляет его же — источник
  // для таблицы organizations без отдельного состояния.
  latestOrgs() {
    const { abs } = dataDirAbs();
    let files = [];
    try {
      files = fs.readdirSync(abs)
        .filter((f) => /^orgs(-[\w-]+)?\.json$/.test(f))
        .map((f) => ({ f, m: fs.statSync(path.join(abs, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m);
    } catch {}
    for (const { f } of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8'));
        if (Array.isArray(data.items)) return { file: f, ...data };
      } catch {}
    }
    return null;
  },
};
