// 1.1-D. Индекс регуляторной изменчивости России 2010–2026 (на базе Russian EPU, Baker–Bloom–Davis)
//         и его связь с инвестиционной квотой.
// Запуск: node docs/economic-strength/data/1.1-D/calc-volatility.mjs
// Выходы: epu-ru-monthly.csv, regulatory-volatility-2010-2026.csv.
// Сырьё — data/economic-strength/1.1-D/raw/ (корень репозитория). Лицензия данных EPU: CC BY 4.0.

import { inflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.1-D', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

// --- минимальный ZIP-reader (xlsx) ---
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD не найден');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + fnLen);
    const lfnLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lfnLen + lextraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    files[name] = method === 0 ? data : inflateRawSync(data);
    off += 46 + fnLen + extraLen + commentLen;
  }
  return files;
}

function parseSheet(xml, sharedXml) {
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[2].matchAll(/<c ([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = (cm[1].match(/r="([A-Z]+)\d+"/) || [])[1];
      const t = (cm[1].match(/t="(\w+)"/) || [])[1] || 'n';
      let val = (cm[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's' && val != null) val = shared[Number(val)] ?? val;
      else if (val == null) {
        const is = cm[2].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        if (is) val = is[1];
      }
      if (ref != null && val != null) cells[ref] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// --- скачивание Russian EPU (с кэшем и повторами) ---
const pageUrl = 'https://www.policyuncertainty.com/russia_monthly.html';
const rawName = `russia-epu_${RUN_DATE}.xlsx`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let buf = null;
mkdirSync(RAW_DIR, { recursive: true });
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const cached = readdirSync(RAW_DIR).filter((f) => /^russia-epu_\d{4}-\d{2}-\d{2}\.xlsx$/.test(f)).sort().pop();
  if (cached) {
    buf = readFileSync(join(RAW_DIR, cached));
    console.log(`EPU: использую локальную копию ${cached} (${buf.length} байт)`);
  } else {
    let lastErr;
    for (let attempt = 1; attempt <= 4 && buf == null; attempt++) {
      try {
        const html = await (await fetch(pageUrl)).text();
        const linkMatch = html.match(/href="([^"]*(?:russia)[^"]*\.xlsx?)"/i);
        if (!linkMatch) throw new Error('Ссылка на файл EPU не найдена на странице');
        const fileUrl = new URL(linkMatch[1], pageUrl).href;
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} при загрузке EPU`);
        buf = Buffer.from(await resp.arrayBuffer());
        writeFileSync(join(RAW_DIR, rawName), buf);
        console.log(`EPU загружен: ${fileUrl} (${buf.length} байт)`);
      } catch (e) { lastErr = e; console.log(`Попытка ${attempt}: ${e.message}`); await sleep(1500 * attempt); }
    }
    if (buf == null) throw new Error(`EPU не загружен: ${lastErr.message}`);
  }
}

const files = readZip(buf);
const sheet = files['xl/worksheets/sheet1.xml'].toString('utf8');
const sharedXml = files['xl/sharedStrings.xml'].toString('utf8');
const rows = parseSheet(sheet, sharedXml);

// Строки: A=год, B=месяц, C=индекс
const monthly = [];
for (const r of rows) {
  const y = Number(r.A), m = Number(r.B), v = Number(r.C);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(v)) continue;
  if (y < 1994 || y > 2030) continue;
  monthly.push([y, m, v]);
}
console.log(`Месячных наблюдений: ${monthly.length} (с ${monthly[0][0]}-${monthly[0][1]} по ${monthly[monthly.length - 1][0]}-${monthly[monthly.length - 1][1]})`);

// --- инвестиционная квота России (WDI) ---
const wdiUrl = 'https://api.worldbank.org/v2/country/RUS/indicator/NE.GDI.TOTL.ZS?date=2010:2024&format=json&per_page=2000';
const wdiResp = await fetch(wdiUrl);
const wdiJson = await wdiResp.json();
writeFileSync(join(RAW_DIR, `wdi_NE.GDI.TOTL.ZS_RUS_${RUN_DATE}.json`), JSON.stringify(wdiJson));
const invShare = {};
for (const row of wdiJson[1]) if (row.value != null) invShare[Number(row.date)] = Number(row.value);
console.log('Инвестквота России (WDI) загружена: 2010–2024');

// --- годовая агрегация ---
const byYear = {};
for (const [y, m, v] of monthly) (byYear[y] ??= []).push([m, v]);
const years = Object.keys(byYear).map(Number).sort((a, b) => a - b).filter((y) => y >= 2010);
const baseYears = years.filter((y) => y >= 2010 && y <= 2019);
const baseMean = baseYears.reduce((s, y) => s + byYear[y].reduce((a, [m, v]) => a + v, 0) / byYear[y].length, 0) / baseYears.length;

const annualRows = [];
for (const y of years) {
  const vals = byYear[y].map(([, v]) => v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  let maxV = -Infinity, maxM = null;
  for (const [m, v] of byYear[y]) if (v > maxV) { maxV = v; maxM = m; }
  const rvIndex = mean / baseMean * 100;
  annualRows.push([y, vals.length, mean.toFixed(1), maxV.toFixed(1), maxM, std.toFixed(1), rvIndex.toFixed(1), invShare[y] != null ? invShare[y].toFixed(1) : 'NA']);
}

// --- корреляции (описательно, малые выборки) ---
const ranks = (arr) => {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  idx.forEach(([, i], k) => { r[i] = k + 1; });
  return r;
};
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
};
const spearman = (a, b) => pearson(ranks(a), ranks(b));
{
  const pairs = annualRows.filter((r) => r[7] !== 'NA');
  const epuA = pairs.map((r) => Number(r[2]));
  const invA = pairs.map((r) => Number(r[7]));
  console.log(`\nСвязь ИРВ (годовое среднее EPU) и инвестквоты: n = ${pairs.length}`);
  console.log(`  одновременно: Пирсон ${pearson(epuA, invA).toFixed(2)}, Спирмен ${spearman(epuA, invA).toFixed(2)}`);
  const epuL = epuA.slice(0, -1), invL = invA.slice(1);
  console.log(`  EPU(t) → инвестквота(t+1): Пирсон ${pearson(epuL, invL).toFixed(2)}, Спирмен ${spearman(epuL, invL).toFixed(2)} (n = ${epuL.length})`);
}

console.log('\nГодовой ряд 2010–2026 (год: среднее EPU; ИРВ; инвестквота % ВВП):');
for (const r of annualRows) console.log(`  ${r[0]}: EPU ${r[2]} (макс ${r[3]} в м.${r[4]}); ИРВ ${r[6]}; инвестквота ${r[7]} (месяцев: ${r[1]})`);

const csv = (rs) => '\uFEFF' + rs.map((r) => r.join(';')).join('\n') + '\n';
writeFileSync(join(HERE, 'epu-ru-monthly.csv'), csv([['year', 'month', 'epu_index'], ...monthly.map(([y, m, v]) => [y, m, v.toFixed(2)])]));
writeFileSync(join(HERE, 'regulatory-volatility-2010-2026.csv'),
  csv([['year', 'months', 'epu_mean', 'epu_max', 'epu_max_month', 'epu_std', 'rv_index_2010_2019_100', 'inv_share_pct', 'n_laws_amend_nk', 'share_lag_lt_6m'], ...annualRows.map((r) => [...r, 'NA', 'NA'])]));
console.log('\nГотово: epu-ru-monthly.csv, regulatory-volatility-2010-2026.csv');
