// 1.1-A. Панель ПИИ и инвестиционной квоты для вопроса 3 + динамика ПИИ России.
// Запуск: node docs/economic-strength/data/1.1-A/calc-property.mjs
// Выходы: panel-fdi-investment.csv, fdi-rus-2010-2025.csv. Сырьё — data/economic-strength/1.1-A/raw/.
// Панель стран берётся из пилота 1.0-A (pilot-30-countries.csv), + Россия в списке.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.1-A', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

// Список стран панели из пилота 1.0-A
const pilotCsv = readFileSync(join(HERE, '..', '1.0-A', 'pilot-30-countries.csv'), 'utf8').split(/\r?\n/);
const countries = [];
for (const line of pilotCsv.slice(1)) {
  if (!line.trim()) continue;
  const cells = line.split(';');
  countries.push({ iso3: cells[2], ru: cells[1] });
}
if (!countries.some((c) => c.iso3 === 'RUS')) countries.push({ iso3: 'RUS', ru: 'Россия' });
console.log(`Стран в панели: ${countries.length}`);

const IND = [
  { id: 'fdi_gdp', code: 'BX.KLT.DINV.WD.GD.ZS' },
  { id: 'fdi_usd', code: 'BX.KLT.DINV.CD.WD' },
  { id: 'inv_share', code: 'NE.GDI.TOTL.ZS' },
];

const f = (x, d = 2) => (x == null ? 'NA' : Number(x).toFixed(d));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function fetchInd(code) {
  const cc = countries.map((c) => c.iso3).join(';');
  const url = `https://api.worldbank.org/v2/country/${cc}/indicator/${code}?date=2010:2025&format=json&per_page=20000`;
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

const avgWindow = (s, a, b) => {
  if (!s) return null;
  const vals = [];
  for (let t = a; t <= b; t++) if (s[t] != null) vals.push(s[t]);
  return vals.length ? mean(vals) : null;
};

// Панельная таблица: средние 2015–2019 («до») и 2020–2024 («после»)
const rows = [];
const med = { fdi1519: [], fdi2024: [], inv1519: [], inv2024: [] };
for (const c of countries) {
  const fdi = series.fdi_gdp[c.iso3], inv = series.inv_share[c.iso3];
  const r = {
    iso3: c.iso3, ru: c.ru,
    fdi1519: avgWindow(fdi, 2015, 2019), fdi2024: avgWindow(fdi, 2020, 2024),
    inv1519: avgWindow(inv, 2015, 2019), inv2024: avgWindow(inv, 2020, 2024),
  };
  if (r.fdi1519 != null) med.fdi1519.push(r.fdi1519);
  if (r.fdi2024 != null) med.fdi2024.push(r.fdi2024);
  if (r.inv1519 != null) med.inv1519.push(r.inv1519);
  if (r.inv2024 != null) med.inv2024.push(r.inv2024);
  rows.push([r.iso3, r.ru, f(r.fdi1519), f(r.fdi2024), f(r.inv1519, 1), f(r.inv2024, 1),
    f(r.fdi2024 != null && r.fdi1519 != null ? r.fdi2024 - r.fdi1519 : null),
    f(r.inv2024 != null && r.inv1519 != null ? r.inv2024 - r.inv1519 : null, 1)]);
}

// Ранг России по инвестиционной квоте 2020–2024
const invSorted = rows.filter((r) => r[5] !== 'NA').map((r) => [r[0], Number(r[5])]).sort((a, b) => b[1] - a[1]);
const rusRank = invSorted.findIndex((x) => x[0] === 'RUS') + 1;

console.log('\nМедианы панели:');
console.log(`  ПИИ % ВВП: 2015–2019 = ${f(median(med.fdi1519))} (n=${med.fdi1519.length}); 2020–2024 = ${f(median(med.fdi2024))} (n=${med.fdi2024.length})`);
console.log(`  Инвестквота % ВВП: 2015–2019 = ${f(median(med.inv1519), 1)} (n=${med.inv1519.length}); 2020–2024 = ${f(median(med.inv2024), 1)} (n=${med.inv2024.length})`);
console.log(`Россия по инвестквоте 2020–2024: место ${rusRank} из ${invSorted.length}`);
const rus = rows.find((r) => r[0] === 'RUS');
console.log(`Россия: ПИИ % ВВП ${rus[2]} → ${rus[3]} (Δ ${rus[6]}); инвестквота ${rus[4]} → ${rus[5]} (Δ ${rus[7]})`);

// Погодовые ПИИ России
const fdiRus = [];
{
  const g = series.fdi_gdp.RUS ?? {}, u = series.fdi_usd.RUS ?? {};
  for (let t = 2010; t <= 2025; t++) {
    if (g[t] == null && u[t] == null) continue;
    fdiRus.push([t, f(g[t]), f(u[t] != null ? u[t] / 1e9 : null, 1)]);
  }
}
console.log('\nПИИ России по годам (год; % ВВП; млрд долл.):');
for (const r of fdiRus) console.log(`  ${r[0]}: ${r[1]} %; ${r[2]} млрд`);

const csv = (rs) => '\uFEFF' + rs.map((r) => r.join(';')).join('\n') + '\n';
writeFileSync(join(HERE, 'panel-fdi-investment.csv'),
  csv([['iso3', 'country', 'fdi_gdp_2015_2019', 'fdi_gdp_2020_2024', 'inv_share_2015_2019', 'inv_share_2020_2024', 'fdi_delta', 'inv_delta'], ...rows]));
writeFileSync(join(HERE, 'fdi-rus-2010-2025.csv'), csv([['year', 'fdi_pct_gdp', 'fdi_bln_usd'], ...fdiRus]));
console.log('\nГотово: panel-fdi-investment.csv, fdi-rus-2010-2025.csv');
