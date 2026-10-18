// 1.2-A. Исследовательский корпус: численность, публикационная динамика, кооперация, поля науки.
// Запуск: node docs/economic-strength/data/1.2-A/research-workforce.mjs
// Источники: OpenAlex (публикации РФ по годам; международное соавторство; поля науки),
//            WDI (исследователи), UNESCO UIS (попытка; иначе статус).
// Сырьё: data/economic-strength/1.2-A/raw/ (корень репозитория).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.2-A', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

async function getJson(url, { tries = 3, timeout = 30000 } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1000 * i)); }
    finally { clearTimeout(t); }
  }
  throw new Error(`${url}: ${lastErr.message}`);
}
const csv = (rows) => '\uFEFF' + rows.map((r) => r.join(';')).join('\n') + '\n';

mkdirSync(RAW_DIR, { recursive: true });

// ── 1. OpenAlex: работы и международная кооперация по годам ──
console.log('1) OpenAlex: публикации РФ…');
const ai = await getJson('https://api.openalex.org/works?filter=authorships.countries:ru&group_by=publication_year&per_page=60');
const intl = await getJson('https://api.openalex.org/works?filter=authorships.countries:ru,countries_distinct_count:%3E1&group_by=publication_year&per_page=60');
writeFileSync(join(RAW_DIR, `openalex_ru_years_${RUN_DATE}.json`), JSON.stringify(ai));
writeFileSync(join(RAW_DIR, `openalex_ru_intl_years_${RUN_DATE}.json`), JSON.stringify(intl));
const wByYear = Object.fromEntries((ai.group_by ?? []).map((g) => [Number(g.key), g.count]));
const iByYear = Object.fromEntries((intl.group_by ?? []).map((g) => [Number(g.key), g.count]));
const pubRows = [['year', 'works_total', 'works_intl', 'intl_share_pct']];
for (let y = 2010; y <= 2026; y++) {
  if (wByYear[y] == null) continue;
  const sh = iByYear[y] != null ? (100 * iByYear[y]) / wByYear[y] : null;
  pubRows.push([y, wByYear[y], iByYear[y] ?? 'NA', sh != null ? sh.toFixed(1) : 'NA']);
}
writeFileSync(join(HERE, 'openalex-ru-publications.csv'), csv(pubRows));
console.log('   ', pubRows.slice(1).map((r) => `${r[0]}:${r[1]}${r[3] !== 'NA' ? `(${r[3]}%)` : ''}`).join(' '));

// ── 2. Поля науки: 2021 (пик) против 2024 ──
console.log('2) Поля науки (2021 vs 2024)…');
const fieldRows = [['year', 'field', 'works']];
for (const y of [2021, 2024]) {
  const f = await getJson(`https://api.openalex.org/works?filter=authorships.countries:ru,publication_year:${y}&group_by=primary_topic.field.id&per_page=30`);
  writeFileSync(join(RAW_DIR, `openalex_ru_fields_${y}_${RUN_DATE}.json`), JSON.stringify(f));
  for (const g of f.group_by ?? []) fieldRows.push([y, g.key_display_name, g.count]);
  console.log(`   ${y}:`, (f.group_by ?? []).slice(0, 6).map((g) => `${g.key_display_name}:${g.count}`).join(' '));
  await new Promise((res) => setTimeout(res, 600));
}
writeFileSync(join(HERE, 'openalex-ru-fields.csv'), csv(fieldRows));

// ── 3. WDI: исследователи (численность и на млн) ──
console.log('3) WDI: исследователи…');
const ISO = ['RUS', 'CHN', 'KOR', 'JPN', 'USA', 'DEU', 'POL'];
const wdiRows = [['iso3', 'year', 'researchers_total', 'researchers_per_million']];
for (const [code, key] of [['SP.POP.SCIE.RD', 'researchers_total'], ['SP.POP.SCIE.RD.P6', 'researchers_per_million']]) {
  try {
    const j = await getJson(`https://api.worldbank.org/v2/country/${ISO.join(';')}/indicator/${code}?date=2010:2026&format=json&per_page=20000`);
    writeFileSync(join(RAW_DIR, `wdi_${code}_${RUN_DATE}.json`), JSON.stringify(j));
    for (const row of j[1] ?? []) {
      if (row.value == null) continue;
      const ex = wdiRows.find((r) => r[0] === row.countryiso3code && r[1] === Number(row.date));
      if (ex) ex[key === 'researchers_total' ? 2 : 3] = Number(row.value).toFixed(0);
      else {
        const nr = [row.countryiso3code, Number(row.date), 'NA', 'NA'];
        nr[key === 'researchers_total' ? 2 : 3] = Number(row.value).toFixed(0);
        wdiRows.push(nr);
      }
    }
    console.log(`   ${code}: ок`);
  } catch (e) { console.log(`   ${code}: ${e.message}`); }
  await new Promise((res) => setTimeout(res, 400));
}
const rus = wdiRows.filter((r) => r[0] === 'RUS');
console.log('   Россия (последние):', rus.slice(-5).map((r) => `${r[1]}: ${r[2]} чел., ${r[3]}/млн`).join(' | '));
writeFileSync(join(HERE, 'wdi-researchers.csv'), csv(wdiRows));

// ── 4. UNESCO UIS: попытка получить индикаторы исследователей (запасной источник) ──
console.log('4) UNESCO UIS…');
try {
  const def = await getJson('https://api.uis.unesco.org/api/public/definitions/indicators', { tries: 1, timeout: 20000 });
  const sci = (Array.isArray(def) ? def : []).filter((x) => /researcher/i.test(x.name || ''));
  console.log('   определений про исследователей:', sci.length, sci.slice(0, 3).map((s) => s.indicatorCode));
} catch (e) { console.log('   UIS: недоступно в этом запуске — статус (ручной/повтор позже):', e.message.slice(0, 80)); }

console.log('\nГотово: openalex-ru-publications.csv, openalex-ru-fields.csv, wdi-researchers.csv');
