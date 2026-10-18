// 1.0-C. Декомпозиция роста России по Солоу (4 периода), межстрановое сравнение, сценарии 2026–2035.
// Запуск: node docs/economic-strength/data/1.0-C/calc-growth.mjs
// Выходы (в этой папке): growth-decomposition-2000-2025.csv, sector-growth-rus.csv,
//   tfp-sensitivity.csv, potential-growth-scenarios.csv, potential-sensitivity.csv.
// Сырьё — в data/economic-strength/1.0-C/raw/ (корень репозитория).
// Допущения модели (раздел 2 документа): α_K = 0,4; α_L = 0,6; норма выбытия δ = 5 %/год;
//   начальный капитал K(2000) = 2,5 × ВВП(2000). TFP — остаток Солоу. Качество труда (Q_L) не выделено (нет данных).
// Выгрузка WDI: 2026-10-18, винтаж 2026-10-08. Последний период: 2022–последний год с полными данными страны.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.0-C', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

const COUNTRIES = [
  { iso3: 'RUS', ru: 'Россия' },
  { iso3: 'POL', ru: 'Польша' },
  { iso3: 'TUR', ru: 'Турция' },
  { iso3: 'KAZ', ru: 'Казахстан' },
  { iso3: 'MYS', ru: 'Малайзия' },
];

const IND = [
  { id: 'gdp_real', code: 'NY.GDP.MKTP.KN' },        // ВВП, постоянные нац. валюты
  { id: 'investment_real', code: 'NE.GDI.FTOT.KN' }, // ВНОК, постоянные нац. валюты (NE.GDI.TOTL.KN у Турции пуст)
  { id: 'labor_force', code: 'SL.TLF.TOTL.IN' },
  { id: 'pop_1564', code: 'SP.POP.1564.TO' },
  { id: 'va_agr', code: 'NV.AGR.TOTL.KD' },
  { id: 'va_manf', code: 'NV.IND.MANF.KD' },
];

const ALPHA_K = 0.4, ALPHA_L = 0.6, DELTA = 0.05, KY0 = 2.5;
const PERIODS_FIXED = [
  { label: '2000–2008', a: 2000, b: 2008 },
  { label: '2009–2013', a: 2009, b: 2013 },
  { label: '2014–2021', a: 2014, b: 2021 },
];

const ln = Math.log;
const f = (x, d = 2) => (x == null ? 'NA' : Number(x).toFixed(d));

async function fetchInd(code) {
  const cc = COUNTRIES.map((c) => c.iso3).join(';');
  const url = `https://api.worldbank.org/v2/country/${cc}/indicator/${code}?date=1990:2025&format=json&per_page=20000`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j) || !Array.isArray(j[1])) throw new Error('неожиданный формат ответа');
      return j;
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 800 * attempt)); }
  }
  throw new Error(`WDI ${code}: ${lastErr.message}`);
}

mkdirSync(RAW_DIR, { recursive: true });
const series = {};
for (const ind of IND) {
  const j = await fetchInd(ind.code);
  writeFileSync(join(RAW_DIR, `wdi_${ind.code}_${RUN_DATE}.json`), JSON.stringify(j));
  series[ind.id] = {};
  for (const row of j[1]) {
    if (row.value == null) continue;
    (series[ind.id][row.countryiso3code] ??= {})[Number(row.date)] = Number(row.value);
  }
  await new Promise((res) => setTimeout(res, 400));
  console.log(`Загружен ряд: ${ind.id} (${ind.code})`);
}

// Перпетуальный запас капитала
function buildK(y, i) {
  const years = Object.keys(y).map(Number).sort((a, b) => a - b).filter((t) => t >= 1995 && t <= 2025);
  const K = {};
  const start = years.find((t) => y[t] != null && t >= 2000);
  if (start == null) return K;
  K[start] = KY0 * y[start];
  for (const t of years) {
    if (t <= start) continue;
    if (K[t - 1] == null || i[t] == null) { K[t] = K[t - 1] ?? null; continue; }
    K[t] = K[t - 1] * (1 - DELTA) + i[t];
  }
  return K;
}

// Последний год периода 2022+ с полными данными страны
function lastFullYear(y, i, l) {
  for (let t = 2025; t >= 2022; t--) if (y[t] != null && i[t] != null && l[t] != null) return t;
  return 2024;
}

const rows = [];
const check = [];
for (const c of COUNTRIES) {
  const y = series.gdp_real[c.iso3] ?? {};
  const i = series.investment_real[c.iso3] ?? {};
  const l = series.labor_force[c.iso3] ?? {};
  const K = buildK(y, i);
  const bLast = lastFullYear(y, i, l);
  const periods = [...PERIODS_FIXED, { label: `2022–${bLast}`, a: 2022, b: bLast }];
  for (const p of periods) {
    const n = p.b - p.a;
    if (y[p.a] == null || y[p.b] == null || K[p.a] == null || K[p.b] == null || l[p.a] == null || l[p.b] == null) {
      rows.push([c.iso3, c.ru, p.label, n, 'NA', 'NA', 'NA', 'NA', 'NA']);
      continue;
    }
    const gY = (ln(y[p.b]) - ln(y[p.a])) / n * 100;
    const gK = (ln(K[p.b]) - ln(K[p.a])) / n * 100;
    const gL = (ln(l[p.b]) - ln(l[p.a])) / n * 100;
    const cK = ALPHA_K * gK, cL = ALPHA_L * gL;
    const tfp = gY - cK - cL;
    check.push(Math.abs(cK + cL + tfp - gY));
    let sum = 0, cnt = 0;
    for (let t = p.a; t <= p.b; t++) if (y[t] && i[t] != null) { sum += i[t] / y[t]; cnt++; }
    rows.push([c.iso3, c.ru, p.label, n, f(gY), f(cK), f(cL), f(tfp), f(cnt ? sum / cnt * 100 : null, 1)]);
  }
}
const maxDiff = Math.max(...check);
console.log(`\nКонтроль тождества (сумма вкладов = темп роста): макс. отклонение ${maxDiff.toExponential(2)} п.п.`);

// Отраслевой разрез России (укрупнённый; вместо KLEMS)
const sectRows = [];
{
  const y = series.gdp_real.RUS, i = series.investment_real.RUS, l = series.labor_force.RUS;
  const bRus = lastFullYear(y, i, l);
  for (const [sid, name] of [['va_agr', 'Сельское хозяйство'], ['va_manf', 'Обрабатывающая промышленность'], ['gdp_real', 'ВВП (вся экономика)']]) {
    const s = series[sid]?.RUS ?? {};
    const periods = [...PERIODS_FIXED, { label: `2022–${bRus}`, a: 2022, b: bRus }];
    for (const p of periods) {
      const n = p.b - p.a;
      const bEff = (s[p.b] != null) ? p.b : null;
      const g = (s[p.a] != null && bEff != null) ? (ln(s[bEff]) - ln(s[p.a])) / (bEff - p.a) * 100 : null;
      const label = bEff != null && bEff !== p.b ? `${p.label} (факт по ${bEff})` : p.label;
      sectRows.push([name, sid, label, f(g)]);
    }
  }
}

// Чувствительность TFP России к доле капитала
const sensRows = [];
{
  const y = series.gdp_real.RUS, i = series.investment_real.RUS, l = series.labor_force.RUS;
  const K = buildK(y, i);
  const bRus = lastFullYear(y, i, l);
  const periods = [...PERIODS_FIXED, { label: `2022–${bRus}`, a: 2022, b: bRus }];
  for (const a of [0.35, 0.4, 0.45]) {
    for (const p of periods) {
      const n = p.b - p.a;
      if (y[p.a] == null || y[p.b] == null) { sensRows.push([a, p.label, 'NA']); continue; }
      const gY = (ln(y[p.b]) - ln(y[p.a])) / n * 100;
      const gK = (ln(K[p.b]) - ln(K[p.a])) / n * 100;
      const gL = (ln(l[p.b]) - ln(l[p.a])) / n * 100;
      sensRows.push([a, p.label, f(gY - a * gK - (1 - a) * gL)]);
    }
  }
}

// База сценариев: последний год России
const yR = series.gdp_real.RUS, iR = series.investment_real.RUS, lR = series.labor_force.RUS;
const popR = series.pop_1564.RUS;
const KMODEL = buildK(yR, iR);
const BASE_YEAR = lastFullYear(yR, iR, lR);
const y0 = yR[BASE_YEAR], l0 = lR[BASE_YEAR], k0 = KMODEL[BASE_YEAR];
const gLPop = (popR[2024] != null && popR[2014] != null) ? (ln(popR[2024]) - ln(popR[2014])) / 10 * 100 : null;
let sSum = 0, sCnt = 0;
for (let t = BASE_YEAR - 4; t <= BASE_YEAR; t++) if (yR[t] && iR[t] != null) { sSum += iR[t] / yR[t]; sCnt++; }
const sBase = sSum / sCnt;

// Сценарии 2026–2035 для России — динамическая симуляция 10 лет (K, L, A; затухающая отдача капитала)
const scRows = [];
{
  const gL = gLPop / 100; // рабочая сила следует за населением 15–64 (тренд 2014–2024)
  const A0 = y0 / (Math.pow(k0, ALPHA_K) * Math.pow(l0, ALPHA_L));
  const sim = (s, tfp, kYOverride) => {
    const kStart = kYOverride != null ? kYOverride * y0 : k0;
    let K = kStart, L = l0, A = y0 / (Math.pow(kStart, ALPHA_K) * Math.pow(l0, ALPHA_L)), Y = y0;
    for (let t = 1; t <= 10; t++) {
      Y = A * Math.pow(K, ALPHA_K) * Math.pow(L, ALPHA_L);
      K = K * (1 - DELTA) + s * Y;
      L = L * (1 + gL);
      A = A * (1 + tfp);
    }
    return { gY: ln(Y / y0) / 10 * 100, gK: ln(K / kStart) / 10 * 100 };
  };
  console.log(`\nКалибровка симуляции (база ${BASE_YEAR}): K/Y = ${f(k0 / y0, 2)}; норма накопления (среднее ${BASE_YEAR - 4}–${BASE_YEAR}): ${f(sBase * 100, 1)} % ВВП; тренд рабочей силы 2014–2024: ${f(gLPop)} %/год`);
  const scen = [
    { name: 'Инерционный', s: sBase, tfp: 0, note: `норма накопления = среднее ${BASE_YEAR - 4}–${BASE_YEAR}, TFP = 0, труд по тренду 2014–2024` },
    { name: 'Капиталоёмкий', s: sBase + 0.05, tfp: 0, note: 'норма накопления +5 п.п. к базовой, TFP = 0, труд по тренду' },
    { name: 'Производительностный', s: sBase, tfp: 0.02, note: 'TFP +2 п.п./год, норма накопления базовая, труд по тренду' },
  ];
  for (const sc of scen) {
    const r = sim(sc.s, sc.tfp);
    scRows.push([sc.name, f(r.gK), f(gLPop), f(sc.tfp * 100, 1), f(r.gY), sc.note]);
  }
}

// Чувствительность сценариев к начальному K/Y (базовый год)
const kSensRows = [];
{
  const kYModel = Number((k0 / y0).toFixed(2));
  const kYSet = Array.from(new Set([2.5, kYModel, 3.5, 4.0])).sort((a, b) => a - b);
  const gL = gLPop / 100;
  const run = (kY, tfp) => {
    const kStart = kY * y0;
    let K = kStart, L = l0, A = y0 / (Math.pow(kStart, ALPHA_K) * Math.pow(l0, ALPHA_L)), Y = y0;
    for (let t = 1; t <= 10; t++) {
      Y = A * Math.pow(K, ALPHA_K) * Math.pow(L, ALPHA_L);
      K = K * (1 - DELTA) + sBase * Y;
      L = L * (1 + gL);
      A = A * (1 + tfp);
    }
    return ln(Y / y0) / 10 * 100;
  };
  for (const kY of kYSet) kSensRows.push([kY.toFixed(2), f(run(kY, 0)), f(run(kY, 0.02))]);
}

const csv = (rs) => '\uFEFF' + rs.map((r) => r.join(';')).join('\n') + '\n';
writeFileSync(join(HERE, 'growth-decomposition-2000-2025.csv'),
  csv([['iso3', 'country', 'period', 'years', 'gY_pa_pct', 'contrib_K_pa_pct', 'contrib_L_pa_pct', 'TFP_pa_pct', 'inv_share_avg_pct'], ...rows]));
writeFileSync(join(HERE, 'sector-growth-rus.csv'), csv([['sector', 'id', 'period', 'g_pa_pct'], ...sectRows]));
writeFileSync(join(HERE, 'tfp-sensitivity.csv'), csv([['alpha_K', 'period', 'tfp_pa_pct'], ...sensRows]));
writeFileSync(join(HERE, 'potential-growth-scenarios.csv'), csv([['scenario', 'gK_pa_pct', 'gL_pa_pct', 'TFP_pa_pct', 'gY_pa_pct', 'assumptions'], ...scRows]));
writeFileSync(join(HERE, 'potential-sensitivity.csv'), csv([['kY_base_year', 'gY_inertial_pa_pct', 'gY_tfp2_pa_pct'], ...kSensRows]));

console.log('\n=== Декомпозиция (вклады в п.п. ВВП в год) ===');
for (const r of rows) console.log(`${r[1].padEnd(10)} ${r[2].padEnd(11)} gY=${r[4]}\tcK=${r[5]}\tcL=${r[6]}\tTFP=${r[7]}\tинв.=${r[8]}%`);
console.log('\n=== Сценарии России 2026–2035 ===');
for (const r of scRows) console.log(`${r[0]}: gK=${r[1]} gL=${r[2]} TFP=${r[3]} → gY=${r[4]} %/год`);
console.log('\n=== Чувствительность к K/Y ===');
for (const r of kSensRows) console.log(`K/Y=${r[0]}: TFP=0 → ${r[1]} %/год; TFP=2 → ${r[2]} %/год`);
console.log('\nГотово: growth-decomposition-2000-2025.csv, sector-growth-rus.csv, tfp-sensitivity.csv, potential-growth-scenarios.csv, potential-sensitivity.csv');
