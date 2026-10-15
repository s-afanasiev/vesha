// ИСЦП v0.2 (документ 4.1-A): баллы из параметров оценки, интервалы методом Монте-Карло,
// согласие двух независимых групп оценщиков.
// Запуск: node docs/economic-strength/data/4.1-A/score.mjs [--theta 5] [--dir <папка с products.csv и pilot-a.csv>]
// Вход: products.csv, pilot-a.csv и, если есть, pilot-b.csv (та же форма, что pilot-a).
// Выход: results-a.csv (и results-b.csv), таблица в markdown и согласие групп в консоль.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvCell, evaluate, quadrant as quadrantAt, loadGroup } from './isc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const THETA = Number(arg('--theta', 5)); // порог квадрантов матрицы
const DIR = arg('--dir', HERE);           // чужой набор продуктов, например data/4.1-E
const DRAWS = 10000;
const quadrant = (V, R, G) => quadrantAt(V, R, G, THETA);

// ---------- Монте-Карло ----------
function rng(seed) { // mulberry32 — воспроизводимые выборки
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function triangular(u, a, m, b) {
  if (b === a) return m;
  const f = (m - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}
const quantile = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];

function simulate(p, point) {
  const rand = rng(20261015);
  const isc = [];
  let same = 0;
  for (let i = 0; i < DRAWS; i++) {
    const e = evaluate(p,
      triangular(rand(), p.r_min, p.r_mode, p.r_max),
      triangular(rand(), p.q_min, p.q_mode, p.q_max),
      triangular(rand(), p.t_min, p.t_mode, p.t_max));
    isc.push(e.isc6);
    if (quadrant(e.V, e.R, p.G) === point) same++;
  }
  isc.sort((a, b) => a - b);
  return { p10: quantile(isc, 0.1), p50: quantile(isc, 0.5), p90: quantile(isc, 0.9), stable: same / DRAWS };
}

// ---------- прогон группы ----------
function run(group) {
  const params = loadGroup(DIR, group);
  if (!params) return null;
  const out = [];
  for (const p of params) {
    const e = evaluate(p, p.r_mode, p.q_mode, p.t_mode);
    const quad = quadrant(e.V, e.R, p.G);
    const mc = p.G ? simulate(p, quad) : { p10: 0, p50: 0, p90: 0, stable: 1 };
    out.push({ id: p.id, product: p.product, G: p.G, ...e, delta: e.isc6 - e.isc4, quad, quad01: quadrant(e.V01, e.R, p.G), ...mc });
  }
  const cols = ['id', 'product', 'G', 'M', 'I', 'X', 'K', 'E', 'P', 'V', 'V01', 'R', 'isc6', 'isc4', 'delta', 'quad', 'quad01', 'p10', 'p50', 'p90', 'stable'];
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v);
  writeFileSync(join(DIR, `results-${group}.csv`),
    [cols.join(','), ...out.map((o) => cols.map((c) => csvCell(fmt(o[c]))).join(','))].join('\n') + '\n', 'utf8');
  return out;
}

// ---------- согласие групп ----------
function icc21(pairs) { // ICC(2,1): двухфакторная случайная модель, абсолютное согласие, k = 2
  const n = pairs.length, k = 2;
  const all = pairs.flat();
  const gm = all.reduce((a, b) => a + b, 0) / all.length;
  const rowMeans = pairs.map(([a, b]) => (a + b) / 2);
  const colMeans = [0, 1].map((j) => pairs.reduce((s, r) => s + r[j], 0) / n);
  const ssr = k * rowMeans.reduce((s, m) => s + (m - gm) ** 2, 0);
  const ssc = n * colMeans.reduce((s, m) => s + (m - gm) ** 2, 0);
  const sst = all.reduce((s, v) => s + (v - gm) ** 2, 0);
  const mse = (sst - ssr - ssc) / ((n - 1) * (k - 1));
  const msr = ssr / (n - 1), msc = ssc / (k - 1);
  return (msr - mse) / (msr + (k - 1) * mse + (k * (msc - mse)) / n);
}
function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let t = i; t <= j; t++) r[order[t][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

// ---------- вывод ----------
const n2 = (v) => v.toFixed(2).replace('.', ',');
const a = run('a');
if (!a) { console.error('Нет pilot-a.csv'); process.exit(1); }
console.log(`Группа A, порог квадрантов ${THETA}\n`);
console.log('| № | Продукт | G | M | I | X | K | E | P | V | R | ИСЦП 0,6 | 80 % интервал | ИСЦП 0,4 | Δ | Квадрант | Устойчивость |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const o of a) {
  if (!o.G) { console.log(`| ${o.id} | ${o.product} | 0 | — | — | — | — | — | — | — | — | 0 | — | 0 | — | ${o.quad} | — |`); continue; }
  console.log(`| ${o.id} | ${o.product} | 1 | ${[o.M, o.I, o.X, o.K, o.E, o.P, o.V, o.R, o.isc6].map(n2).join(' | ')} | ${n2(o.p10)}–${n2(o.p90)} | ${n2(o.isc4)} | ${o.delta >= 0 ? '+' : '−'}${n2(Math.abs(o.delta))} | ${o.quad} | ${Math.round(o.stable * 100)} % |`);
}

const pearson = (x, y) => {
  const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
};
const sc = a.filter((o) => o.G);
const span = (k) => `${n2(Math.min(...sc.map((o) => o[k])))}–${n2(Math.max(...sc.map((o) => o[k])))}`;
console.log(`
Размах: V ${span('V')}, V по формуле 0.1 ${span('V01')}, R ${span('R')}`);
console.log(`Корреляция M и K (Пирсон): ${n2(pearson(sc.map((o) => o.M), sc.map((o) => o.K)))}`);
console.log(`Главный канал — суверенитет (I > Vп): ${sc.filter((o) => o.I > o.Vp).map((o) => o.id).join(', ') || 'нет'}`);
console.log(`Квадрант по формуле 0.1 иначе: ${sc.filter((o) => o.quad01 !== o.quad).map((o) => `${o.id} ${o.quad01} → ${o.quad}`).join('; ') || 'нет'}`);

const b = run('b');
if (b) {
  const byId = Object.fromEntries(b.map((o) => [o.id, o]));
  const both = a.filter((o) => byId[o.id]);
  console.log(`\nСогласие групп A и B (${both.length} продуктов)`);
  for (const c of ['M', 'I', 'X', 'K', 'E', 'P']) {
    const pairs = both.filter((o) => o.G && byId[o.id].G).map((o) => [o[c], byId[o.id][c]]);
    console.log(`  ${c}: ICC(2,1) = ${n2(icc21(pairs))}`);
  }
  const scored = both.filter((o) => o.G && byId[o.id].G);
  console.log(`  ИСЦП (α = 0,6): Спирмен = ${n2(spearman(scored.map((o) => o.isc6), scored.map((o) => byId[o.id].isc6)))}`);
  console.log(`  совпадение G: ${Math.round((100 * both.filter((o) => o.G === byId[o.id].G).length) / both.length)} %`);
  console.log(`  совпадение квадранта: ${Math.round((100 * both.filter((o) => o.quad === byId[o.id].quad).length) / both.length)} %`);
}
