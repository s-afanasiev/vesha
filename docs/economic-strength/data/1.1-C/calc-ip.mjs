// 1.1-C. Патентная активность, НИОКР и исследователи: Россия и страны-ориентиры.
// Запуск: node docs/economic-strength/data/1.1-C/calc-ip.mjs
// Выходы: patents-rus.csv, ip-panel.csv. Сырьё — data/economic-strength/1.1-C/raw/ (корень репозитория).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.1-C', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

const COUNTRIES = [
  { iso3: 'RUS', ru: 'Россия' },
  { iso3: 'JPN', ru: 'Япония' },
  { iso3: 'KOR', ru: 'Южная Корея' },
  { iso3: 'CHN', ru: 'Китай' },
  { iso3: 'POL', ru: 'Польша' },
];

const IND = [
  { id: 'pat_res', code: 'IP.PAT.RESD' },
  { id: 'pat_nres', code: 'IP.PAT.NRES' },
  { id: 'rnd_gdp', code: 'GB.XPD.RSDV.GD.ZS' },
  { id: 'researchers', code: 'SP.POP.SCIE.RD.P6' },
];

const f = (x, d = 2) => (x == null ? 'NA' : Number(x).toFixed(d));
const ln = Math.log;

async function fetchInd(code) {
  const cc = COUNTRIES.map((c) => c.iso3).join(';');
  const url = `https://api.worldbank.org/v2/country/${cc}/indicator/${code}?date=1980:2025&format=json&per_page=20000`;
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

// Погодовой ряд патентов России
const patRows = [];
{
  const res = series.pat_res.RUS ?? {}, nres = series.pat_nres.RUS ?? {};
  const years = Object.keys(res).map(Number).sort((a, b) => a - b);
  for (const t of years) patRows.push([t, f(res[t], 0), f(nres[t] != null ? nres[t] : null, 0)]);
}

// Сводка по странам: последние значения и периоды роста
const panelRows = [];
const period = (s, a, b) => (s[a] != null && s[b] != null) ? (ln(s[b]) - ln(s[a])) / (b - a) * 100 : null;
for (const c of COUNTRIES) {
  const pr = series.pat_res[c.iso3] ?? {};
  const yrs = Object.keys(pr).map(Number).sort((a, b) => a - b);
  const lastY = yrs[yrs.length - 1];
  const rnd = series.rnd_gdp[c.iso3] ?? {};
  const rndYrs = Object.keys(rnd).map(Number).sort((a, b) => a - b);
  const rndY = rndYrs[rndYrs.length - 1];
  const res = series.researchers[c.iso3] ?? {};
  const resYrs = Object.keys(res).map(Number).sort((a, b) => a - b);
  const resY = resYrs[resYrs.length - 1];
  panelRows.push([
    c.iso3, c.ru,
    f(pr[lastY], 0), lastY,
    f(pr[2000], 0), f(pr[2010], 0),
    f(rnd[rndY], 2), rndY,
    f(res[resY], 0), resY,
    f(period(pr, 2000, 2010)), f(period(pr, 2010, lastY)),
  ]);
  console.log(`${c.ru}: заявки резидентов ${f(pr[2000], 0)} (2000) → ${f(pr[2010], 0)} (2010) → ${f(pr[lastY], 0)} (${lastY}); НИОКР ${f(rnd[rndY], 2)} % ВВП (${rndY}); исследователи ${f(res[resY], 0)} на млн (${resY})`);
}

console.log('\nПатентные заявки резидентов России по годам (2005+):');
for (const r of patRows.filter((r) => r[0] >= 2005)) console.log(`  ${r[0]}: резиденты ${r[1]}, нерезиденты ${r[2]}`);

const csv = (rs) => '\uFEFF' + rs.map((r) => r.join(';')).join('\n') + '\n';
writeFileSync(join(HERE, 'patents-rus.csv'), csv([['year', 'applications_residents', 'applications_nonresidents'], ...patRows]));
writeFileSync(join(HERE, 'ip-panel.csv'), csv([['iso3', 'country', 'pat_res_last', 'year_last', 'pat_res_2000', 'pat_res_2010', 'rnd_gdp_pct', 'rnd_year', 'researchers_per_mln', 'researchers_year', 'pat_growth_2000_2010', 'pat_growth_2010_last'], ...panelRows]));
console.log('\nГотово: patents-rus.csv, ip-panel.csv');
