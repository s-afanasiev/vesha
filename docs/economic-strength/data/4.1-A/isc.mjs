// Формула ИСЦП v0.2 (документ 4.1-A, раздел 3): баллы из параметров, свёртка, квадрант,
// загрузка параметров оценщиков. Общий модуль для score.mjs и анализа чувствительности.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MU = 1;          // межотраслевой коэффициент; до документа 4.1-B равен 1
export const OWN_CAP_M = 5;   // потолок M для своего продукта без полевого замера (стандарт 4.2, 3.E.4)
const W_M = 0.6, W_K = 0.4, SECOND = 0.25, W_CH = 0.85, W_X = 0.15;

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
export const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// ---------- шкалы ----------
const clip = (v) => Math.max(0, Math.min(10, v));
const scoreM = (r, rho, capped) => {
  const m = clip((10 * Math.log(1 + r * (1 - rho) * MU)) / Math.log(11));
  return capped ? Math.min(m, OWN_CAP_M) : m;
};
const scoreI = (s, c, d) => clip(10 * s * c * d);
const scoreK = (q) => (q <= 1 ? 0 : clip((10 * Math.log(q)) / Math.log(50)));
const scoreE = (p) => clip(10 - (p.time + p.capital + p.cert + p.expertise + p.competition));
const scoreP = (t) => clip((10 * (Math.log(84) - Math.log(t))) / (Math.log(84) - Math.log(6)));

// Оценка продукта p при заданных r, q, T (точка или выборка Монте-Карло).
export function evaluate(p, r, q, t) {
  const M = scoreM(r, p.rho, p.own && !p.measured);
  const I = scoreI(p.s, p.c, p.d);
  const X = clip(p.x);
  const K = scoreK(q);
  const E = scoreE(p);
  const P = scoreP(t);
  const Vp = W_M * M + W_K * K;                                         // канал производительности
  const Vch = Math.min(10, Math.max(Vp, I) + SECOND * Math.min(Vp, I)); // главный канал + четверть второго
  const V = W_CH * Vch + W_X * X;
  const R = 0.5 * E + 0.5 * P;
  const isc = (a) => p.G * V ** a * R ** (1 - a);
  const V01 = 0.4 * M + 0.25 * I + 0.15 * X + 0.2 * K;               // формула плана v0.1 — для сравнения
  return { M, I, X, K, E, P, Vp, V, V01, R, isc6: isc(0.6), isc4: isc(0.4) };
}
export const evaluateMode = (p) => evaluate(p, p.r_mode, p.q_mode, p.t_mode);

export function quadrant(V, R, G, theta = 5) {
  if (!G) return 'не оценивается';
  if (V >= theta) return R >= theta ? 'делать сейчас' : 'стратегическая ставка';
  return R >= theta ? 'быстрые деньги' : 'не делать';
}

// ---------- параметры оценщиков ----------
const NUM = ['g2', 'g3', 'g4', 'r_min', 'r_mode', 'r_max', 'rho', 's', 'c', 'd', 'x', 'q_min', 'q_mode', 'q_max',
  'time', 'capital', 'cert', 'expertise', 'competition', 't_min', 't_mode', 't_max'];

// Параметры группы (pilot-<group>.csv) вместе с описанием продуктов; null, если файла нет.
export function loadGroup(dir, group) {
  const file = join(dir, `pilot-${group}.csv`);
  if (!existsSync(file)) return null;
  const products = Object.fromEntries(parseCsv(readFileSync(join(dir, 'products.csv'), 'utf8')).map((p) => [p.id, p]));
  const out = [];
  for (const raw of parseCsv(readFileSync(file, 'utf8'))) {
    const meta = products[raw.id];
    if (!meta) { console.warn(`${group}: ${raw.id} нет в products.csv`); continue; }
    const p = { ...raw, product: meta.product, own: meta.own === '1', measured: meta.measured === '1' };
    for (const k of NUM) p[k] = Number(raw[k]);
    p.g1 = p.rho > 0.5 ? 0 : 1;                                       // основной эффект перераспределительный
    p.G = p.g1 && p.g2 && p.g3 && p.g4 ? 1 : 0;
    out.push(p);
  }
  return out;
}
