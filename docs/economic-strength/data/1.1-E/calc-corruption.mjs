// 1.1-E. Опросные индикаторы коррупции на уровне фирм (Enterprise Surveys через WDI):
//        Россия и страны сравнения (Грузия — кейс реформы; Польша, Турция, Казахстан, Малайзия).
// Запуск: node docs/economic-strength/data/1.1-E/calc-corruption.mjs
// Выходы: firm-surveys-corruption.csv. Сырьё — data/economic-strength/1.1-E/raw/ (корень репозитория).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.1-E', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

const COUNTRIES = [
  { iso3: 'RUS', ru: 'Россия' },
  { iso3: 'GEO', ru: 'Грузия' },
  { iso3: 'POL', ru: 'Польша' },
  { iso3: 'TUR', ru: 'Турция' },
  { iso3: 'KAZ', ru: 'Казахстан' },
  { iso3: 'MYS', ru: 'Малайзия' },
];

const IND = [
  { id: 'brib', code: 'IC.FRM.BRIB.ZS' }, // Bribery incidence: доля фирм с хотя бы одним запросом взятки
  { id: 'pay', code: 'IC.FRM.CORR.ZS' },  // Неформальные платежи чиновникам, % фирм
];

async function fetchInd(code) {
  const cc = COUNTRIES.map((c) => c.iso3).join(';');
  const url = `https://api.worldbank.org/v2/country/${cc}/indicator/${code}?date=2000:2026&format=json&per_page=20000`;
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

const f = (x, d = 1) => (x == null ? 'NA' : Number(x).toFixed(d));

const rows = [];
for (const c of COUNTRIES) {
  const brib = series.brib[c.iso3] ?? {};
  const pay = series.pay[c.iso3] ?? {};
  const years = [...new Set([...Object.keys(brib), ...Object.keys(pay)].map(Number))].sort((a, b) => a - b);
  const partsB = [], partsP = [];
  for (const t of years) {
    rows.push([c.iso3, c.ru, t, f(brib[t]), f(pay[t])]);
    if (brib[t] != null) partsB.push(`${t}:${f(brib[t])}%`);
    if (pay[t] != null) partsP.push(`${t}:${f(pay[t])}%`);
  }
  console.log(`\n${c.ru}:`);
  console.log(`  Запрос взятки (incidence): ${partsB.join('  ') || 'нет данных'}`);
  console.log(`  Неформальные платежи:      ${partsP.join('  ') || 'нет данных'}`);
}

const csv = (rs) => '\uFEFF' + rs.map((r) => r.join(';')).join('\n') + '\n';
writeFileSync(join(HERE, 'firm-surveys-corruption.csv'),
  csv([['iso3', 'country', 'year', 'bribery_incidence_pct', 'informal_payments_pct'], ...rows]));
console.log('\nГотово: firm-surveys-corruption.csv');
