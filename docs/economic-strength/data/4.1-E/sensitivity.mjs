// Чувствительность выбора продукта (документ 4.1-E, раздел 3.5): какие параметры и при каких
// значениях меняют лидера короткого списка.
// Запуск: node docs/economic-strength/data/4.1-E/sensitivity.mjs

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMode, loadGroup } from '../4.1-A/isc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const base = loadGroup(HERE, 'a').filter((p) => p.G);
const isc = (p) => evaluateMode(p).isc6;
const n2 = (v) => v.toFixed(2).replace('.', ',');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Диапазоны «правдоподобный минимум — максимум» для каждого параметра.
const RANGES = {
  r: (p) => [{ r_mode: p.r_min }, { r_mode: p.r_max }],
  q: (p) => [{ q_mode: p.q_min }, { q_mode: p.q_max }],
  T: (p) => [{ t_mode: p.t_max }, { t_mode: p.t_min }],
  'ρ': (p) => [{ rho: clamp(p.rho + 0.15, 0, 1) }, { rho: clamp(p.rho - 0.15, 0, 1) }],
  'конкуренция': () => [{ competition: 1.5 }, { competition: 0 }],
  'время до продажи': (p) => [{ time: clamp(p.time + 1, 0, 3) }, { time: clamp(p.time - 1, 0, 3) }],
  'замер у клиента': (p) => (p.own ? [{}, { measured: true }] : null),
};
const withG = (p) => ({ ...p, G: p.rho > 0.5 ? 0 : p.G });

const ranked = [...base].sort((a, b) => isc(b) - isc(a));
const leader = ranked[0], second = ranked[1];
console.log(`Лидер в точке: ${leader.id} (${n2(isc(leader))}), второй: ${second.id} (${n2(isc(second))})\n`);

console.log('Торнадо: ИСЦП (α 0,6) при худшем и лучшем значении параметра, остальные — наиболее вероятные');
console.log('| Кандидат | Параметр | Худшее | Лучшее | Размах | Меняет лидера |');
console.log('|---|---|---|---|---|---|');
for (const p of ranked) {
  const rows = [];
  for (const [name, range] of Object.entries(RANGES)) {
    const pair = range(p);
    if (!pair) continue;
    const [lo, hi] = pair.map((patch) => isc(withG({ ...p, ...patch })));
    let flips = '—';
    if (p === leader) {
      const rivals = Math.max(...ranked.slice(1).map(isc));
      if (lo < rivals) flips = `да: при худшем уступает (${n2(lo)} < ${n2(rivals)})`;
    } else if (hi > isc(leader)) flips = `да: при лучшем обгоняет ${leader.id} (${n2(hi)} > ${n2(isc(leader))})`;
    rows.push({ name, lo, hi, flips });
  }
  rows.sort((a, b) => b.hi - b.lo - (a.hi - a.lo));
  for (const r of rows) console.log(`| ${p.id} | ${r.name} | ${n2(r.lo)} | ${n2(r.hi)} | ${n2(r.hi - r.lo)} | ${r.flips} |`);
}

// Переломные значения: при каком значении одного параметра кандидат догоняет лидера.
function solve(p, key, lo, hi, target, extra = {}) {
  const f = (v) => isc(withG({ ...p, ...extra, [key]: v })) - target;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
const target = isc(leader);
console.log(`\nПереломные значения: при каком значении параметра кандидат догоняет ${leader.id} (${n2(target)})`);
for (const p of ranked.slice(1)) {
  const extra = p.own ? { measured: true } : {};
  const note = p.own ? ' (с полевым замером)' : '';
  const rStar = solve(p, 'r_mode', 0.1, 50, target, extra);
  const tStar = solve(p, 't_mode', 6, 84, target, extra);
  const qStar = solve(p, 'q_mode', 1, 200, target, extra);
  console.log(`  ${p.id}${note}: r ≥ ${rStar ? n2(rStar) : 'недостижимо'} (сейчас ${n2(p.r_mode)}); ` +
    `T ≤ ${tStar ? n2(tStar) : 'недостижимо'} мес. (сейчас ${n2(p.t_mode)}); q ≥ ${qStar ? n2(qStar) : 'недостижимо'} (сейчас ${n2(p.q_mode)})`);
}
const runner = Math.max(...ranked.slice(1).map((p) => isc(p.own ? { ...p, measured: true } : p)));
const tDown = solve(leader, 't_mode', 6, 84, runner);
const rDown = solve(leader, 'r_mode', 0.1, 50, runner);
console.log(`  ${leader.id} теряет первое место (порог ${n2(runner)} — лучший соперник с замером), если T ≥ ${tDown ? n2(tDown) : 'никогда'} мес. ` +
  `(сейчас ${n2(leader.t_mode)}) или r ≤ ${rDown ? n2(rDown) : 'никогда'} (сейчас ${n2(leader.r_mode)})`);

console.log('\nПерспектива команды (α 0,4):', [...base].sort((a, b) => evaluateMode(b).isc4 - evaluateMode(a).isc4)
  .map((p) => `${p.id} ${n2(evaluateMode(p).isc4)}`).join(' > '));
