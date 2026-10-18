// 1.0-B. Проверка панели «Индикаторы силы экономики».
// Запуск: node docs/economic-strength/data/1.0-B/validate-panel.mjs
// Проверяет: (1) структурную целостность реестра рядов и его соответствие паспортам и документу;
// (2) при наличии выгруженных серий в series/ — пропуски лет и скачки больше 3σ.
// Ошибки (пересечение id, неполные поля, неверный уровень) — код возврата 1; предупреждения не блокируют.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, '..', '..', '1-foundations', '1.0-B-indicators-panel.md');
const PASSPORTS = join(HERE, 'passports.md');
const CSV = join(HERE, 'panel-v1.csv');
const SERIES_DIR = join(HERE, 'series');

const errors = [];
const warnings = [];
const idsFromPattern = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

// 1. id из документа (матрица 3.1 и реестр 3.4)
const docText = readFileSync(DOC, 'utf8');
const docIdsArr = idsFromPattern(docText, /^\| `((?:macro|inst|hum|infra|tech|trade|geo)_[a-z0-9_]+)`/gm);
const docCounts = new Map();
for (const id of docIdsArr) docCounts.set(id, (docCounts.get(id) ?? 0) + 1);
const docIds = new Set(docIdsArr);

// 2. id из паспортов
const ppText = readFileSync(PASSPORTS, 'utf8');
const ppIds = new Set(idsFromPattern(ppText, /^- \*\*`([a-z0-9_]+)` —/gm));

// 3. реестр panel-v1.csv
const csvRaw = readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
const lines = csvRaw.trim().split(/\r?\n/);
const header = lines[0].split(';').map((x) => x.trim());
const EXPECTED_COLS = ['id', 'group', 'name', 'unit', 'freq', 'coverage', 'source', 'level', 'url', 'subst_status'];
if (header.join(';') !== EXPECTED_COLS.join(';')) errors.push(`CSV: шапка «${header.join(';')}» вместо «${EXPECTED_COLS.join(';')}»`);

const rows = lines.slice(1).map((l) => l.split(';'));
const csvIds = new Set();
const ALLOWED_SUBST = ['—', 'замена действует', 'замена частичная', 'данные закрыты', 'данные не обновляются', 'два ряда параллельно', 'протокол полноты'];
const FREQ_OK = /^(М|К|Г|МК|МГ|КГ|МКГ|ГК|статика)$/;
const COV_OK = /^(\d{4}-\d{4}|статика)$/;

for (let i = 0; i < rows.length; i++) {
  const ln = i + 2;
  const r = rows[i].map((x) => x.trim());
  if (r.length !== EXPECTED_COLS.length) { errors.push(`CSV строка ${ln}: колонок ${r.length} вместо ${EXPECTED_COLS.length}`); continue; }
  const [id, group, name, unit, freq, cov, src, level, url, subst] = r;
  if (!id) { errors.push(`CSV строка ${ln}: пустой id`); continue; }
  if (csvIds.has(id)) errors.push(`CSV: дубль id ${id}`);
  csvIds.add(id);
  for (const [k, v] of Object.entries({ name, unit, freq, cov, src, level, url })) if (!v) errors.push(`CSV ${id}: пустое поле «${k}»`);
  if (!FREQ_OK.test(freq)) errors.push(`CSV ${id}: частота «${freq}» вне словаря`);
  if (!COV_OK.test(cov)) errors.push(`CSV ${id}: покрытие «${cov}» вне формата`);
  const lv = Number(level);
  if (!Number.isInteger(lv) || lv < 1 || lv > 6) errors.push(`CSV ${id}: уровень «${level}» (нужно целое 1–6)`);
  if (!ALLOWED_SUBST.includes(subst)) errors.push(`CSV ${id}: статус замещения «${subst}» вне словаря`);
  if (!/^(macro|inst|hum|infra|tech|trade|geo)$/.test(group)) errors.push(`CSV ${id}: группа «${group}» вне словаря`);
}
if (rows.length !== 54) errors.push(`CSV: рядов ${rows.length}, ожидается 54`);

// 4. совпадение множеств id: документ ↔ CSV ↔ паспорта
const diff = (a, b) => [...a].filter((x) => !b.has(x));
const missCsv = diff(docIds, csvIds), extraCsv = diff(csvIds, docIds);
const missPp = diff(docIds, ppIds), extraPp = diff(ppIds, docIds);
if (missCsv.length || extraCsv.length) errors.push(`id реестр↔CSV: нет в CSV [${missCsv.join(', ')}]; нет в реестре [${extraCsv.join(', ')}]`);
if (missPp.length || extraPp.length) errors.push(`id реестр↔паспорта: нет в паспортах [${missPp.join(', ')}]; нет в реестре [${extraPp.join(', ')}]`);
for (const [id, n] of docCounts) if (n < 2) errors.push(`реестр: id ${id} встречается ${n} раз (ожидается не меньше 2: матрица 3.1 и реестр 3.4)`);

// 5. числовые проверки серий (если выгружены)
let seriesCount = 0;
if (existsSync(SERIES_DIR)) {
  const files = readdirSync(SERIES_DIR).filter((f) => f.endsWith('.csv'));
  for (const f of files) {
    seriesCount++;
    const raw = readFileSync(join(SERIES_DIR, f), 'utf8').replace(/^\uFEFF/, '');
    const ls = raw.trim().split(/\r?\n/);
    const hdr = ls[0].split(';').map((x) => x.trim().toLowerCase());
    const yi = hdr.indexOf('year'), vi = hdr.indexOf('value');
    if (yi < 0 || vi < 0) { errors.push(`ряд ${f}: нет колонок year и value`); continue; }
    const pts = [];
    for (const l of ls.slice(1)) {
      const c = l.split(';');
      const y = Number(c[yi]);
      if (!Number.isFinite(y)) continue;
      const v = Number(c[vi]);
      if (Number.isFinite(v)) pts.push([y, v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    let gaps = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][0] - pts[i - 1][0] > 1) gaps++;
    if (gaps) warnings.push(`ряд ${f}: пропусков лет ${gaps}`);
    const ch = [];
    for (let i = 1; i < pts.length; i++) if (pts[i - 1][1] !== 0) ch.push((pts[i][1] - pts[i - 1][1]) / Math.abs(pts[i - 1][1]));
    if (ch.length > 3) {
      const m = ch.reduce((s, x) => s + x, 0) / ch.length;
      const sd = Math.sqrt(ch.reduce((s, x) => s + (x - m) ** 2, 0) / ch.length);
      if (sd > 0) for (let i = 0; i < ch.length; i++) {
        const z = Math.abs(ch[i] - m) / sd;
        if (z > 3) warnings.push(`ряд ${f}: скачок ${ch[i] > 0 ? '+' : ''}${(ch[i] * 100).toFixed(1)} % около ${pts[i + 1][0]} г. (z = ${z.toFixed(1)})`);
      }
    }
  }
}

// 6. отчёт
console.log(`Проверка панели 1.0-B: рядов в документе ${docIds.size}, в CSV ${rows.length}, в паспортах ${ppIds.size}; выгруженных серий: ${seriesCount}`);
for (const w of warnings) console.log('  ПРЕДУПРЕЖДЕНИЕ:', w);
if (errors.length) {
  for (const e of errors) console.log('  ОШИБКА:', e);
  console.log(`\nПроверка НЕ пройдена: ошибок ${errors.length}.`);
  process.exit(1);
}
console.log('Проверка пройдена без ошибок.');
