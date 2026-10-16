// Срок окупаемости для команды T по одной модели для всех кандидатов (документ 4.1-E v0.3, раздел 2).
// Темп продаж — из масштаба q: n3 клиентов к концу третьего года, то есть n3 ÷ (36 − месяцев до запуска) в месяц.
// t_min — при вдвое быстрых продажах, t_mode — при расчётном темпе, t_max — при вдвое медленных.
// Запуск: node docs/economic-strength/data/4.1-E/t-model.mjs [--write]
// --write — записывает t_min, t_mode, t_max в pilot-a.csv.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvCell, evaluate, loadGroup, parseCsv } from '../4.1-A/isc.mjs';
import { buildOf, clientsFor, payback } from '../4.1-A/payback.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP = 84; // P = 0 при T ≥ 84 мес. (4.1-A, 3.3)
const n0 = (v) => Math.round(v).toLocaleString('ru-RU');
const n1 = (v) => v.toFixed(1).replace('.', ',');
const tOut = (t) => Math.min(t, CAP);
const tStr = (t) => (t > CAP ? `> ${CAP}` : String(t));

const pilotFile = join(HERE, 'pilot-a.csv');
const pilotText = readFileSync(pilotFile, 'utf8');
const pilot = parseCsv(pilotText);
const scen = Object.fromEntries(parseCsv(readFileSync(join(HERE, 'payback.csv'), 'utf8')).map((s) => [s.id, s]));

// Цена за единицу, при которой T ≤ target при расчётном темпе.
function priceFor(s, pace, target) {
  let lo = 0, hi = 1e6;
  if (payback({ ...s, price: hi }, pace) > target) return Infinity;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (payback({ ...s, price: mid }, pace) <= target) hi = mid; else lo = mid; }
  return hi;
}
const P5 = 22; // P = 5 при T ≈ 22 мес. (4.1-A, 3.3)

console.log('| Кандидат | Цена, ₽ в мес. | Единиц у клиента | Команда до запуска | Клиентов в месяц | T: ×2 / расчётный / ×0,5 | Клиентов в месяц для T ≤ 22 | Цена для T ≤ 22 |');
console.log('|---|---|---|---|---|---|---|---|');
const out = {};
const atP5 = {};
for (const p of pilot) {
  const raw = scen[p.id];
  if (!raw) { console.warn(`${p.id}: нет в payback.csv`); continue; }
  const s = {
    price: Number(raw.price), units: Number(raw.units), setupFee: Number(raw.setup_fee), onboard: Number(raw.onboard),
    varCost: Number(raw.var_cost), churn: Number(raw.churn),
    ...buildOf(Number(p.time), Number(p.capital)),
  };
  const pace = Number(raw.n3) / (36 - s.buildMonths);
  const t = [payback(s, 2 * pace), payback(s, pace), payback(s, pace / 2)];
  out[p.id] = t.map(tOut);
  const need = clientsFor(s, P5);
  const price = priceFor(s, pace, P5);
  atP5[p.id] = { price, base: s.price };
  console.log(`| ${p.id} | ${n0(s.price)} за ${raw.unit} | ${raw.units} | ${n1(s.fteBuild)} FTE × ${s.buildMonths} мес. | ${n1(pace)} | ` +
    `${t.map(tStr).join(' / ')} | ${need === Infinity ? 'недостижимо' : n1(need)} | ${n0(price)} |`);
}

if (process.argv.includes('--write')) {
  const head = pilotText.replace(/\r\n/g, '\n').split('\n')[0].split(',');
  const rows = pilot.map((p) => {
    if (out[p.id]) [p.t_min, p.t_mode, p.t_max] = out[p.id].map(String);
    return head.map((h) => csvCell(p[h])).join(',');
  });
  writeFileSync(pilotFile, `${[head.join(','), ...rows].join('\n')}\n`);
  console.log('\npilot-a.csv: t_min, t_mode, t_max обновлены');
}

// Цена связывает r и T: дороже подписка — короче окупаемость, но ниже r. Грубая проверка для всех одинаково:
// стоимость владения ≈ подписка, поэтому r меняется обратно цене; T = 22 мес.; q не меняется. Точнее для 01 — 2.2-E.
const params = loadGroup(HERE, 'a');
console.log('\nЕсли сменить цену на ту, что даёт окупаемость за 22 мес. (r ∝ 1 ÷ цена, грубо)');
console.log('| Кандидат | Цена сейчас → для T ≤ 22 | r сейчас → после | ИСЦП сейчас → после |');
console.log('|---|---|---|---|');
for (const p of params) {
  const x = atP5[p.id];
  if (!x || x.price === Infinity) continue;
  const k = x.base / x.price;
  const now = evaluate(p, p.r_mode, p.q_mode, p.t_mode).isc6;
  const after = evaluate(p, p.r_mode * k, p.q_mode, P5).isc6;
  const n2 = (v) => v.toFixed(2).replace('.', ',');
  console.log(`| ${p.id} | ${n0(x.base)} → ${n0(x.price)} | ${n2(p.r_mode)} → ${n2(p.r_mode * k)} | ${n2(now)} → ${n2(after)} |`);
}
