// 1.0-A. Пилотный расчёт индекса силы экономики для панели стран (v0.1).
// Воспроизводимость: node docs/economic-strength/data/1.0-A/calc-index.mjs
// Данные: WDI API (Всемирный банк). Сырые ответы сохраняются в data/economic-strength/1.0-A/raw/.
// Выходные файлы (в папке скрипта): pilot-30-countries.csv, crisis-episodes.csv, retro-check.csv.
// Правила методики: docs/economic-strength/1-foundations/1.0-A-strength-index.md (разделы 3.1–3.4).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..'); // корень репозитория
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.0-A', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

// --- Панель: Россия (объект сравнения) + референтные группы (0.4). Тайвань отсутствует в WDI — исключён из пилота (v1: IMF WEO/ADB). ---
const COUNTRIES = [
  { iso3: 'RUS', ru: 'Россия' },
  { iso3: 'KOR', ru: 'Южная Корея' }, { iso3: 'CHN', ru: 'Китай' },
  { iso3: 'SGP', ru: 'Сингапур' },    { iso3: 'POL', ru: 'Польша' },
  { iso3: 'DEU', ru: 'Германия' },    { iso3: 'JPN', ru: 'Япония' },
  { iso3: 'USA', ru: 'США' },         { iso3: 'CHE', ru: 'Швейцария' },
  { iso3: 'FIN', ru: 'Финляндия' },   { iso3: 'NOR', ru: 'Норвегия' },
  { iso3: 'AUS', ru: 'Австралия' },   { iso3: 'CAN', ru: 'Канада' },
  { iso3: 'CHL', ru: 'Чили' },        { iso3: 'BWA', ru: 'Ботсвана' },
  { iso3: 'VEN', ru: 'Венесуэла' },   { iso3: 'NGA', ru: 'Нигерия' },
  { iso3: 'NLD', ru: 'Нидерланды' },  { iso3: 'ARG', ru: 'Аргентина' },
  { iso3: 'BRA', ru: 'Бразилия' },    { iso3: 'MEX', ru: 'Мексика' },
  { iso3: 'MYS', ru: 'Малайзия' },    { iso3: 'THA', ru: 'Таиланд' },
  { iso3: 'TUR', ru: 'Турция' },      { iso3: 'IRN', ru: 'Иран' },
  { iso3: 'IND', ru: 'Индия' },       { iso3: 'ISR', ru: 'Израиль' },
  { iso3: 'BLR', ru: 'Беларусь' },    { iso3: 'EST', ru: 'Эстония' },
  { iso3: 'KAZ', ru: 'Казахстан' },   { iso3: 'ARM', ru: 'Армения' },
  { iso3: 'UZB', ru: 'Узбекистан' },
];

// --- Ряды WDI (паспорта: data/1.0-A/passports.md). dir: 1 — больше лучше, -1 — меньше лучше. ---
const INDICATORS = [
  { id: 'gdp_pc_ppp',        wdi: 'NY.GDP.PCAP.PP.KD', dir: 1 },
  { id: 'gdp_per_worker',    wdi: 'SL.GDP.PCAP.EM.KD', dir: 1 },
  { id: 'high_tech_exports', wdi: 'TX.VAL.TECH.MF.ZS', dir: 1 },
  { id: 'medhigh_mva',       wdi: 'NV.MNF.TECH.ZS.UN', dir: 1 },
  { id: 'savings_gdp',       wdi: 'NY.GNS.ICTR.ZS',    dir: 1 },
  { id: 'inv_gdp',           wdi: 'NE.GDI.TOTL.ZS',    dir: 1 },
  { id: 'energy_imports_net',wdi: 'EG.IMP.CONS.ZS',    dir: -1 },
  { id: 'reserves_months',   wdi: 'FI.RES.TOTL.MO',    dir: 1 },
];

// Минимальный порог данных для включения страны в композит: >= 7 входов из 10 (8 рядов + 2 расчётных).
const MIN_INPUTS = 7;

// --- Эпизоды шоков (методика 3.4) ---
const EPISODES = [
  { id: '2008-2009', peak: 2007, from: 2008, to: 2009 },
  { id: '2014-2015', peak: 2013, from: 2014, to: 2016 },
  { id: '2020',      peak: 2019, from: 2020, to: 2020 },
  { id: '2022',      peak: 2021, from: 2022, to: 2023 },
];

// Экспертные веса v0.1 (временный профиль, раздел 3.2): D1 0,30; D2 0,25; D3 0,25; D4 0,20.
const W_EXPERT = [0.30, 0.25, 0.25, 0.20];
const W_EQUAL  = [0.25, 0.25, 0.25, 0.25];

// ---------- небольшая статистика ----------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function percentile(sorted, p) {
  const idx = (sorted.length - 1) * p / 100;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function pearson(a, b) {
  const n = a.length, ma = mean(a), mb = mean(b);
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
  const den = Math.sqrt(sa * sb);
  return den === 0 ? 0 : sab / den;
}

function ranks(xs) { // средние ранги при совпадениях
  const order = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
const spearman = (a, b) => pearson(ranks(a), ranks(b));

// ---------- загрузка WDI ----------
async function fetchIndicator(code) {
  const cc = COUNTRIES.map((c) => c.iso3).join(';');
  const url = `https://api.worldbank.org/v2/country/${cc}/indicator/${code}?date=1990:2024&format=json&per_page=20000`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j) || !Array.isArray(j[1])) throw new Error('неожиданный формат ответа API');
      return j;
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 800 * attempt)); }
  }
  throw new Error(`WDI ${code}: ${lastErr.message}. Проверьте доступ к сети.`);
}

function buildSeries(json) {
  const out = {};
  for (const row of json[1]) {
    if (row.value === null || row.value === undefined) continue;
    (out[row.countryiso3code] ??= {})[Number(row.date)] = Number(row.value);
  }
  return out;
}

// ---------- опорный год по индикатору ----------
function pickRefYear(series) {
  for (const y of [2024, 2023, 2022, 2021]) {
    const n = COUNTRIES.filter((c) => series[c.iso3]?.[y] != null).length;
    if (n >= 26) return y;
  }
  let best = null, bn = -1;
  for (const y of [2024, 2023, 2022, 2021, 2020]) {
    const n = COUNTRIES.filter((c) => series[c.iso3]?.[y] != null).length;
    if (n > bn) { bn = n; best = y; }
  }
  return best;
}

// ---------- нормализация (методика 3.1) ----------
function normalizeMap(valuesByKey, dir) {
  const xs = Object.values(valuesByKey).filter((x) => x != null).slice().sort((a, b) => a - b);
  const p5 = percentile(xs, 5), p95 = percentile(xs, 95);
  const span = (p95 - p5) || 1e-9;
  const out = {};
  for (const [k, x] of Object.entries(valuesByKey)) {
    if (x == null) continue;
    const n = dir === 1 ? (x - p5) / span : (p95 - x) / span;
    out[k] = clamp(n, 0, 1);
  }
  return out;
}

// ---------- эпизоды ----------
function episodeStats(s, ep) {
  const P = s?.[ep.peak];
  if (P == null) return { depth: null, rec: null, troughYear: null };
  let T = null, tYear = null;
  for (let y = ep.from; y <= ep.to; y++) {
    const v = s[y];
    if (v != null && (T == null || v < T)) { T = v; tYear = y; }
  }
  if (T == null) return { depth: null, rec: null, troughYear: null };
  const depth = Math.max(0, (P - T) / P * 100);
  let rec = null;
  if (depth === 0) rec = 0;
  else {
    for (let y = tYear + 1; y <= 2024; y++) {
      const v = s[y];
      if (v != null && v >= P) { rec = y - tYear; break; }
    }
  }
  return { depth, rec, troughYear: tYear };
}

// ---------- Монте-Карло (методика 3.2) ----------
function createRng(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}
const rng = createRng(42);
const rnd = (a, b) => a + (b - a) * rng();

function monteCarlo(cur, nCountries) {
  const MEMBERS = {
    D1: ['gdp_pc_ppp', 'gdp_per_worker'],
    D2: ['high_tech_exports', 'medhigh_mva'],
    D3: ['savings_gdp', 'inv_gdp', 'resilience'],
    D4: ['energy_imports_net', 'reserves_months'],
  };
  const rankStore = Array.from({ length: nCountries }, () => []);
  const ITER = 1000;
  for (let it = 0; it < ITER; it++) {
    const w = W_EXPERT.map((x) => Math.max(0.01, x * (1 + rnd(-0.25, 0.25))));
    const wsum = w.reduce((a, b) => a + b, 0);
    const wn = w.map((x) => x / wsum);
    const scores = [];
    for (let i = 0; i < nCountries; i++) {
      let S = 0;
      for (const [dk, members] of Object.entries(MEMBERS)) {
        const vals = [];
        for (const m of members) {
          const x = cur[m][i];
          if (x == null) continue;
          vals.push(clamp(x * (1 + rnd(-0.10, 0.10)), 0, 1));
        }
        const dim = vals.length ? mean(vals) : null;
        if (dim != null) S += wn[Number(dk[1]) - 1] * dim;
      }
      scores.push(S);
    }
    const r = ranks(scores.map((s) => -s)); // ранг 1 — наибольший балл
    for (let i = 0; i < nCountries; i++) rankStore[i].push(r[i]);
  }
  return rankStore.map((r) => {
    const s = r.slice().sort((a, b) => a - b);
    const p05 = percentile(s, 5), p95 = percentile(s, 95), med = percentile(s, 50);
    return { med, p05, p95, spread: p95 - p05 };
  });
}

// ---------- PCA (методика 3.2) ----------
function pcaWeights(cols) {
  const k = cols.length;
  const M = [];
  for (let i = 0; i < k; i++) {
    M.push([]);
    for (let j = 0; j < k; j++) M[i].push(pearson(cols[i], cols[j]));
  }
  let v = new Array(k).fill(1 / Math.sqrt(k));
  for (let it = 0; it < 500; it++) {
    const nv = M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
    const norm = Math.sqrt(nv.reduce((s, x) => s + x * x, 0)) || 1;
    v = nv.map((x) => x / norm);
  }
  const sq = v.map((x) => x * x);
  const s = sq.reduce((a, b) => a + b, 0) || 1;
  return sq.map((x) => x / s);
}

// ---------- сбор данных ----------
mkdirSync(RAW_DIR, { recursive: true });
console.log(`Опорная дата запуска: ${RUN_DATE}`);
const seriesById = {};
for (const ind of INDICATORS) {
  const json = await fetchIndicator(ind.wdi);
  writeFileSync(join(RAW_DIR, `wdi_${ind.wdi}_${RUN_DATE}.json`), JSON.stringify(json));
  seriesById[ind.id] = buildSeries(json);
  await new Promise((res) => setTimeout(res, 400)); // бережливый сбор
  console.log(`Загружен ряд: ${ind.id} (${ind.wdi})`);
}

// Опорные годы
const refYear = {};
for (const ind of INDICATORS) refYear[ind.id] = pickRefYear(seriesById[ind.id]);
console.log('Опорные годы:', refYear);

// Эпизоды (по gdp_pc_ppp)
const gdpSeries = seriesById['gdp_pc_ppp'];
const ep = {};
for (const e of EPISODES) {
  ep[e.id] = {};
  for (const c of COUNTRIES) ep[e.id][c.iso3] = episodeStats(gdpSeries[c.iso3], e);
}

// Значения на опорный год + производные 2020
const vals = {};
for (const ind of INDICATORS) {
  vals[ind.id] = {};
  for (const c of COUNTRIES) vals[ind.id][c.iso3] = seriesById[ind.id][c.iso3]?.[refYear[ind.id]] ?? null;
}
vals['crisis_depth_2020'] = {};
vals['recovery_2020'] = {};
for (const c of COUNTRIES) {
  const st = ep['2020'][c.iso3];
  vals['crisis_depth_2020'][c.iso3] = st.depth;
  vals['recovery_2020'][c.iso3] = st.rec != null ? st.rec : (st.troughYear != null ? (2024 - st.troughYear) + 1 : null);
}

// Нормализация
const normVals = {};
for (const ind of INDICATORS) normVals[ind.id] = normalizeMap(vals[ind.id], ind.dir);
normVals['crisis_depth_2020'] = normalizeMap(vals['crisis_depth_2020'], -1);
normVals['recovery_2020'] = normalizeMap(vals['recovery_2020'], -1);
normVals['resilience'] = {};
for (const c of COUNTRIES) {
  const a = normVals['crisis_depth_2020'][c.iso3], b = normVals['recovery_2020'][c.iso3];
  if (a != null && b != null) normVals['resilience'][c.iso3] = (a + b) / 2;
  else if (a != null || b != null) normVals['resilience'][c.iso3] = a ?? b;
}

// Включение стран (>= MIN_INPUTS входов из 10)
const INPUTS = [...INDICATORS.map((i) => i.id), 'crisis_depth_2020', 'recovery_2020'];
const included = [], excluded = [];
for (const c of COUNTRIES) {
  const n = INPUTS.filter((id) => vals[id][c.iso3] != null).length;
  if (n >= MIN_INPUTS) included.push(c.iso3); else excluded.push({ iso3: c.iso3, inputs: n });
}
console.log(`Стран в композите: ${included.length}; исключены: ${excluded.map((e) => `${e.iso3} (${e.inputs}/10)`).join(', ') || 'нет'}`);

// Субиндексы
const D = { D1: [], D2: [], D3: [], D4: [] };
const MEMBERS = {
  D1: ['gdp_pc_ppp', 'gdp_per_worker'],
  D2: ['high_tech_exports', 'medhigh_mva'],
  D3: ['savings_gdp', 'inv_gdp', 'resilience'],
  D4: ['energy_imports_net', 'reserves_months'],
};
for (const dk of Object.keys(D)) {
  for (const iso of included) {
    const xs = MEMBERS[dk].map((m) => normVals[m][iso]).filter((x) => x != null);
    D[dk].push(xs.length ? mean(xs) : null);
  }
}

const comp = (w) => included.map((_, i) => {
  let s = 0, ws = 0;
  for (let k = 0; k < 4; k++) { const d = D[`D${k + 1}`][i]; if (d != null) { s += w[k] * d; ws += w[k]; } }
  return ws ? s / ws : null;
});

const S_equal = comp(W_EQUAL);
const S_expert = comp(W_EXPERT);
const pcaW = pcaWeights([D.D1.map((x) => x ?? 0), D.D2.map((x) => x ?? 0), D.D3.map((x) => x ?? 0), D.D4.map((x) => x ?? 0)]);
const S_pca = comp(pcaW);

const rankOf = (scores) => ranks(scores.map((s) => -s));
const rEqual = rankOf(S_equal), rExpert = rankOf(S_expert), rPca = rankOf(S_pca);

const MEMBER_KEYS = ['gdp_pc_ppp', 'gdp_per_worker', 'high_tech_exports', 'medhigh_mva', 'savings_gdp', 'inv_gdp', 'energy_imports_net', 'reserves_months', 'resilience'];
const cur = {};
for (const m of MEMBER_KEYS) cur[m] = included.map((iso) => normVals[m][iso] ?? null);
const mc = monteCarlo(cur, included.length);

// Согласие схем
const rhoEE = spearman(rEqual, rExpert), rhoEP = spearman(rEqual, rPca), rhoXP = spearman(rExpert, rPca);

// ---------- ретро-проверка 2005 → 2005–2024 ----------
const growth = {};
for (const c of COUNTRIES) {
  const s = gdpSeries[c.iso3];
  const v0 = s?.[2005];
  if (v0 == null) continue;
  let endYear = null;
  for (const y of [2024, 2023, 2022]) if (s[y] != null) { endYear = y; break; }
  if (endYear == null) continue;
  growth[c.iso3] = (Math.pow(s[endYear] / v0, 1 / (endYear - 2005)) - 1) * 100;
}
const retro = [];
for (const ind of INDICATORS) {
  const a = [], b = [];
  for (const c of COUNTRIES) {
    const x = seriesById[ind.id][c.iso3]?.[2005];
    if (x != null && growth[c.iso3] != null) { a.push(x); b.push(growth[c.iso3]); }
  }
  retro.push({ id: ind.id, rho: a.length >= 8 ? spearman(a, b) : null, n: a.length });
}
// Композит 2005 (D3 без устойчивости: savings + inv)
{
  const n2005 = {};
  for (const ind of INDICATORS) {
    const v = {}; for (const c of COUNTRIES) v[c.iso3] = seriesById[ind.id][c.iso3]?.[2005] ?? null;
    n2005[ind.id] = normalizeMap(v, ind.dir);
  }
  const a = [], b = [];
  for (const c of COUNTRIES) {
    if (growth[c.iso3] == null) continue;
    const dims = [
      [n2005.gdp_pc_ppp[c.iso3], n2005.gdp_per_worker[c.iso3]],
      [n2005.high_tech_exports[c.iso3], n2005.medhigh_mva[c.iso3]],
      [n2005.savings_gdp[c.iso3], n2005.inv_gdp[c.iso3]],
      [n2005.energy_imports_net[c.iso3], n2005.reserves_months[c.iso3]],
    ].map((xs) => { const f = xs.filter((x) => x != null); return f.length ? mean(f) : null; });
    let s = 0, ws = 0;
    for (let k = 0; k < 4; k++) if (dims[k] != null) { s += W_EXPERT[k] * dims[k]; ws += W_EXPERT[k]; }
    if (!ws || dims.filter((d) => d == null).length > 1) continue;
    a.push(s / ws); b.push(growth[c.iso3]);
  }
  retro.push({ id: 'composite_2005', rho: a.length >= 8 ? spearman(a, b) : null, n: a.length });
}

// ---------- CSV ----------
const csv = (rows) => '\uFEFF' + rows.map((r) => r.join(';')).join('\n') + '\n';
const f = (x, d = 3) => (x == null ? 'NA' : Number(x).toFixed(d));

const idx = Object.fromEntries(included.map((iso, i) => [iso, i]));
{
  const rows = [['rank_expert', 'country', 'iso3', 'D1', 'D2', 'D3', 'D4', 'S_equal', 'S_expert', 'S_pca', 'rank_equal', 'rank_pca', 'mc_p05', 'mc_p95', 'rank_spread', 'устойчивый_к_весам']];
  const order = included.map((_, i) => i).sort((p, q) => rExpert[p] - rExpert[q]);
  for (const i of order) {
    const m = mc[i];
    const stable = m.spread <= 0.2 * included.length ? 'да' : 'нет';
    rows.push([Math.round(rExpert[i]), COUNTRIES.find((c) => c.iso3 === included[i]).ru, included[i],
      f(D.D1[i]), f(D.D2[i]), f(D.D3[i]), f(D.D4[i]),
      f(S_equal[i]), f(S_expert[i]), f(S_pca[i]), Math.round(rEqual[i]), Math.round(rPca[i]),
      Math.round(m.p05), Math.round(m.p95), Math.round(m.spread), stable]);
  }
  writeFileSync(join(HERE, 'pilot-30-countries.csv'), csv(rows));
}
{
  const rows = [['country', 'iso3', 'depth_2008_2009', 'rec_2008_2009', 'depth_2014_2015', 'rec_2014_2015', 'depth_2020', 'rec_2020', 'depth_2022', 'rec_2022']];
  for (const c of COUNTRIES) {
    const g = (id, k) => ep[id][c.iso3][k];
    rows.push([c.ru, c.iso3,
      f(g('2008-2009', 'depth'), 1), f(g('2008-2009', 'rec'), 1),
      f(g('2014-2015', 'depth'), 1), f(g('2014-2015', 'rec'), 1),
      f(g('2020', 'depth'), 1), f(g('2020', 'rec'), 1),
      f(g('2022', 'depth'), 1), f(g('2022', 'rec'), 1)]);
  }
  writeFileSync(join(HERE, 'crisis-episodes.csv'), csv(rows));
}
{
  const rows = [['indicator', 'spearman_rho_2005_vs_growth', 'n']];
  for (const r of retro) rows.push([r.id, f(r.rho, 2), r.n]);
  writeFileSync(join(HERE, 'retro-check.csv'), csv(rows));
}

// ---------- отчёт в консоль ----------
console.log('\n=== Топ-10 (экспертные веса) ===');
const order = included.map((_, i) => i).sort((p, q) => rExpert[p] - rExpert[q]);
for (const i of order.slice(0, 10)) console.log(`${Math.round(rExpert[i])}. ${COUNTRIES.find((c) => c.iso3 === included[i]).ru} — S=${f(S_expert[i])} (равн. ранг ${Math.round(rEqual[i])}, PCA ${Math.round(rPca[i])}, МК ${Math.round(mc[i].med)}, размах ${Math.round(mc[i].spread)})`);
console.log('\n=== Хвост-5 ===');
for (const i of order.slice(-5)) console.log(`${Math.round(rExpert[i])}. ${COUNTRIES.find((c) => c.iso3 === included[i]).ru} — S=${f(S_expert[i])}`);
console.log('\n=== Веса PCA ===', pcaW.map((x) => x.toFixed(3)).join(', '));
console.log('=== Согласие схем (Спирмен) ===', `равные-эксперт: ${rhoEE.toFixed(3)}; равные-PCA: ${rhoEP.toFixed(3)}; эксперт-PCA: ${rhoXP.toFixed(3)}`);
console.log('\n=== Ретро-проверка (rho Спирмена, 2005 vs рост 2005–2024) ===');
for (const r of retro.sort((a, b) => Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0))) console.log(`${r.id}: rho=${f(r.rho, 2)} (n=${r.n})`);
console.log('\n=== 2020: глубина и восстановление (примеры) ===');
for (const iso of ['RUS', 'USA', 'DEU', 'CHN', 'KOR'].filter((x) => COUNTRIES.some((c) => c.iso3 === x))) {
  const st = ep['2020'][iso];
  console.log(`${iso}: глубина ${f(st.depth, 1)}%, восстановление ${st.rec == null ? 'нет к 2024' : st.rec + ' лет'}`);
}
console.log('\nГотово. Файлы: pilot-30-countries.csv, crisis-episodes.csv, retro-check.csv');
