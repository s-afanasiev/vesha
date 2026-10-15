// Реестр документов исследования «Сила экономики» (docs/economic-strength/).
// Строит Приложение А плана из полей «Ожидаемый артефакт» и шапок файлов-документов:
// у документа с файлом — ссылка и статус из шапки, без файла — статус «план».
// Запуск: node scripts/economic-strength-registry.mjs [--check]
// --check — ничего не пишет, выходит с кодом 1, если реестр в плане устарел.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'economic-strength');
const PLAN = join(DIR, 'economic-strength-roadmap.md');
const HEAD = '## Приложение А. Реестр артефактов';
const ART_RE = /^- \*\*Ожидаемый артефакт:\*\* \*Документ (\S+) \[([A-Z])\]: (.+)\*$/;
const STATUSES = ['план', 'черновик', 'ревью', 'принят', 'на пересмотре', 'устарел'];
const TYPES = ['W', 'A', 'D', 'K', 'M', 'S'];
const BLOCKS = {
  1: 'Блок 1. Фундаментальный макроэкономический анализ',
  2: 'Блок 2. Тактические драйверы',
  3: 'Блок 3. Разработчик ПО и IT-вектор',
  4: 'Блок 4. Матрица продуктов и методология',
  'Σ': 'Итоговый синтез',
};

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// Волна по коду — та же раскладка, что в таблице волн плана (0.7).
function wave(code) {
  if (/^1\.0-|^4\.2|^3\.0-A$|^4\.1-A$/.test(code)) return 0;
  if (/^1\.[1-6]-|^3\.0-B$/.test(code)) return 1;
  if (/^1-Σ$|^2[.-]|^3\.1-/.test(code)) return 2;
  if (/^3\.[23]-/.test(code)) return 3;
  return 4;
}
const blockOf = (code) => (/^\d/.test(code) ? code[0] : 'Σ');

function planArtifacts(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(ART_RE);
    if (m) out.push({ code: m[1], type: m[2], title: m[3] });
  }
  return out;
}

function mdFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'data') out.push(...mdFiles(p));
    } else if (name.endsWith('.md') && p !== PLAN) out.push(p);
  }
  return out;
}

function frontMatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].split(' #')[0].trim();
  }
  return fm;
}

const plan = read(PLAN);
const arts = planArtifacts(plan);
const problems = [];
const seen = new Set();
for (const a of arts) {
  if (seen.has(a.code)) problems.push(`в плане дважды код ${a.code}`);
  seen.add(a.code);
}

// Документы на диске: код → файл и статус.
const files = new Map();
let cards = 0;
for (const f of mdFiles(DIR)) {
  const rel = relative(DIR, f).split('\\').join('/');
  const fm = frontMatter(read(f));
  if (!fm || !fm.code) { problems.push(`${rel}: нет шапки с полем code`); continue; }
  if (!STATUSES.includes(fm.status)) problems.push(`${rel}: неизвестный статус «${fm.status}»`);
  if (/^4\.1-E\/\d+$/.test(fm.code)) { cards++; continue; }
  if (!seen.has(fm.code)) problems.push(`${rel}: кода ${fm.code} нет в плане`);
  if (files.has(fm.code)) problems.push(`${rel}: код ${fm.code} уже занят файлом ${files.get(fm.code).rel}`);
  files.set(fm.code, { rel, status: fm.status, type: fm.type });
}
for (const a of arts) {
  const f = files.get(a.code);
  if (f && f.type && f.type !== a.type) problems.push(`${f.rel}: тип ${f.type}, в плане ${a.type}`);
}

const count = (key) => arts.reduce((acc, a) => ((acc[key(a)] = (acc[key(a)] || 0) + 1), acc), {});
const status = (a) => files.get(a.code)?.status || 'план';
const byType = count((a) => a.type);
const byWave = count((a) => wave(a.code));
const byStatus = count(status);

let reg = `${HEAD}\n\nРеестр строит скрипт \`scripts/economic-strength-registry.mjs\` из полей «Ожидаемый артефакт» этого плана и шапок файлов-документов; руками не править. `;
reg += `Всего документов: **${arts.length}** — ${TYPES.filter((t) => byType[t]).map((t) => `${t}: ${byType[t]}`).join(', ')}. `;
reg += `По волнам: ${[0, 1, 2, 3, 4].map((w) => `${w} — ${byWave[w] || 0}`).join(', ')}. `;
reg += `По статусам: ${STATUSES.filter((s) => byStatus[s]).map((s) => `${s} — ${byStatus[s]}`).join(', ')}.`;
if (cards) reg += ` Скоринговых карточек 4.1-E: ${cards}.`;
reg += '\n';
for (const b of Object.keys(BLOCKS)) {
  const rows = arts.filter((a) => blockOf(a.code) === b);
  if (!rows.length) continue;
  reg += `\n### ${BLOCKS[b]}\n\n| Код | Тип | Документ | Волна | Статус |\n|---|---|---|---|---|\n`;
  for (const a of rows) {
    const f = files.get(a.code);
    const title = f ? `[${a.title}](${f.rel})` : a.title;
    reg += `| ${a.code} | ${a.type} | ${title} | ${wave(a.code)} | ${status(a)} |\n`;
  }
}

const start = plan.indexOf(HEAD);
const end = plan.indexOf('\n---\n', start);
if (start < 0 || end < 0) {
  console.error('В плане нет раздела реестра или разделителя после него');
  process.exit(1);
}
const next = plan.slice(0, start) + reg + plan.slice(end);

if (problems.length) console.log('Замечания:\n- ' + problems.join('\n- '));
if (process.argv.includes('--check')) {
  console.log(next === plan ? 'Реестр актуален' : 'Реестр устарел: запустите без --check');
  process.exit(next === plan ? 0 : 1);
}
writeFileSync(PLAN, next, 'utf8');
console.log(`Реестр обновлён: ${arts.length} документов, с файлами — ${files.size}.`);
