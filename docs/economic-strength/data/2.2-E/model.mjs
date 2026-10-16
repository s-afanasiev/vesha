// Эффект и цена мониторинга станков (документ 2.2-E, v0.1): цены конкурентов в ₽ за станок в месяц,
// эффект у клиента r по Монте-Карло, срок окупаемости команды T (общая модель 4.1-A/payback.mjs),
// ИСЦП кандидата 4.1-E/01 против разбора заявки 08.
// Запуск: node docs/economic-strength/data/2.2-E/model.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, loadGroup, parseCsv, quadrant } from '../4.1-A/isc.mjs';
import { buildOf, clientsFor, payback } from '../4.1-A/payback.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const n0 = (v) => Math.round(v).toLocaleString('ru-RU');
const n1 = (v) => v.toFixed(1).replace('.', ',');
const n2 = (v) => v.toFixed(2).replace('.', ',');

// ---------- 1. Цены: нормировка в ₽ за станок в месяц ----------
const FX = { RUB: 1, USD: 83.4839, GBP: 110.299 }; // ЦБ РФ на 03.10.2026 [Ф]
const AMORT = 36;                                   // разовые затраты — на три года, как стоимость владения в 4.1-A
const DAYS = 30;

function perMonth(row, v) {
  const rub = v * FX[row.currency];
  switch (row.per) {
    case 'machine_month': return rub;
    case 'machine_day': return rub * DAYS;
    case 'machine_year': return rub / 12;
    case 'package_month': return rub / Number(row.fleet);
    case 'machine_once': return rub / AMORT;
    case 'project_once': return rub / Number(row.fleet) / AMORT;
    default: return null; // on_request, unclear
  }
}

const prices = parseCsv(readFileSync(join(HERE, 'prices.csv'), 'utf8'));
console.log('1. Цены, ₽ за станок в месяц (разовое — на 36 мес.; оборудование станка — отдельно и в сумме)');
console.log('| id | Поставщик | Способ | Подписка или эквивалент | Оборудование разово | Всего в месяц на 3 года |');
console.log('|---|---|---|---|---|---|');
const published = [];
for (const row of prices) {
  const lo = perMonth(row, Number(row.value_min));
  if (lo === null) {
    console.log(`| ${row.id} | ${row.vendor} | ${row.method} | ${row.per === 'unclear' ? 'неясно, за что' : 'по запросу'} | — | — |`);
    continue;
  }
  const hi = row.value_max ? perMonth(row, Number(row.value_max)) : lo;
  const hwLo = row.hw_once_min ? Number(row.hw_once_min) * FX[row.currency] : 0;
  const hwHi = row.hw_once_max ? Number(row.hw_once_max) * FX[row.currency] : hwLo;
  const totLo = lo + hwLo / AMORT, totHi = hi + hwHi / AMORT;
  published.push({ ...row, lo, hi, totLo, totHi });
  const rng = (a, b) => (Math.abs(a - b) < 1 ? n0(a) : `${n0(a)}–${n0(b)}`);
  console.log(`| ${row.id} | ${row.vendor} | ${row.method} | ${rng(lo, hi)} | ${hwLo ? rng(hwLo, hwHi) : '—'} | ${rng(totLo, totHi)} |`);
}
const ru = published.filter((p) => p.currency === 'RUB' && p.per !== 'machine_once' && p.per !== 'project_once');
const ruSorted = ru.map((p) => p.totLo).sort((a, b) => a - b);
console.log(`\nОпубликованные подписки в России: ${ru.length} строк, от ${n0(ruSorted[0])} до ${n0(ruSorted.at(-1))} ₽ за станок в месяц`);
console.log(`Строк в таблице: ${prices.length}, источников цены: ${new Set(prices.map((p) => p.vendor)).size}, с ценой «по запросу» или неясной: ${prices.filter((p) => ['on_request', 'unclear'].includes(p.per)).length}`);

// ---------- 2. Кейсы: что заявлено ----------
const cases = parseCsv(readFileSync(join(HERE, 'cases.csv'), 'utf8'));
console.log('\n2. Кейсы: относительное изменение показателя');
console.log('| id | Где | Показатель | Изменение | Независимый |');
console.log('|---|---|---|---|---|');
const gains = [];
for (const c of cases) {
  let ch = c.change ? Number(c.change) : null;
  if (ch === null && c.before && c.after) ch = Number(c.after) / Number(c.before) - 1;
  if (ch !== null && ch > 0) gains.push(ch);
  console.log(`| ${c.id} | ${c.enterprise} | ${c.metric} | ${ch === null ? '—' : `${ch > 0 ? '+' : ''}${Math.round(ch * 100)} %`} | ${c.independent === '1' ? 'да' : 'нет'} |`);
}
gains.sort((a, b) => a - b);
console.log(`Заявленный рост (загрузка, эффективность, производительность): ${gains.length} кейсов, медиана +${Math.round(gains[Math.floor(gains.length / 2)] * 100)} %, от +${Math.round(gains[0] * 100)} до +${Math.round(gains.at(-1) * 100)} %`);

// ---------- 3. Эффект у клиента и r ----------
// Параметры — треугольные распределения [мин, мода, макс]; обоснование — в документе 2.2-E, раздел 2.
const P = {
  hours: [2000, 3000, 4000],      // фонд времени станка, ч в год: одна–две смены [Э]
  u0: [0.25, 0.35, 0.5],          // доля фонда под резанием до внедрения [Ф: кейсы C01, C08, C09]
  use: 0.6,                       // вероятность, что клиент заведёт разбор данных [Э]
  gUse: [0.05, 0.15, 0.35],       // рост машинного времени при разборе [Ф: кейсы, со скидкой на отбор]
  gIdle: [0, 0.02, 0.05],         // без разбора — только эффект наблюдения [Ф: САПР и графика; Э]
  kappa: [0.3, 0.6, 1.0],         // доля высвобожденных часов, ставших продажами или сбережёнными затратами [Э]
  value: [1200, 2000, 3500],      // маржинальный доход часа резания, ₽ [Э; ММК 2018 — ~1000 ₽ за час простоя]
  camera: [5000, 6000, 7000],     // камера на станок, ₽ разово [Ф: AI Indicator]
  staffH: [8, 18, 40],            // часы сотрудников клиента на станок в год: причины простоя, разбор [Э]
  staffRate: [700, 1000, 1400],   // полная стоимость часа мастера или оператора, ₽ [О: вакансии hh.ru]
  onboardH: [1, 3, 6],            // часы клиента на подключение станка, разово [Э; Энкост: 1–3 дня на цех]
};
const DRAWS = 10000;
function rng(seed) { // mulberry32, как в 4.1-A/score.mjs
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tri(u, [a, m, b]) {
  if (b === a) return m;
  const f = (m - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const pct = (xs) => { const s = [...xs].sort((a, b) => a - b); return { p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) }; };

// Выборки эффекта и затрат клиента без подписки; одни и те же для всех цен (общие случайные числа).
function draws(over = {}) {
  const p = { ...P, ...over };
  const rand = rng(20261016);
  const out = [];
  for (let i = 0; i < DRAWS; i++) {
    const used = rand() < p.use;
    const g = used ? tri(rand(), p.gUse) : tri(rand(), p.gIdle);
    const effect = tri(rand(), p.hours) * tri(rand(), p.u0) * g * tri(rand(), p.kappa) * tri(rand(), p.value);
    const rate = tri(rand(), p.staffRate);
    const own = tri(rand(), p.camera) / 3 + tri(rand(), p.staffH) * rate + (tri(rand(), p.onboardH) * rate) / 3;
    out.push({ effect, own });
  }
  return out;
}
const rAt = (ds, price) => {
  const rs = ds.map((d) => d.effect / (12 * price + d.own));
  return { ...pct(rs), below1: rs.filter((r) => r < 1).length / rs.length };
};

const base = draws();
const eff = pct(base.map((d) => d.effect));
const own = pct(base.map((d) => d.own));
console.log('\n3. Эффект у клиента на станок в год, ₽ (P10 / P50 / P90)');
console.log(`  эффект: ${n0(eff.p10)} / ${n0(eff.p50)} / ${n0(eff.p90)}`);
console.log(`  затраты клиента без подписки (камера, время сотрудников, подключение): ${n0(own.p10)} / ${n0(own.p50)} / ${n0(own.p90)}`);

const PRICES = [600, 1500, 3000, 4500, 6000, 9000];
console.log('\n  r = эффект ÷ стоимость владения, по цене подписки (₽ за станок в месяц)');
console.log('| Цена | r P10 | r P50 | r P90 | Доля клиентов с r < 1 |');
console.log('|---|---|---|---|---|');
for (const price of PRICES) {
  const r = rAt(base, price);
  console.log(`| ${n0(price)} | ${n2(r.p10)} | ${n2(r.p50)} | ${n2(r.p90)} | ${Math.round(r.below1 * 100)} % |`);
}

console.log('\n  Что двигает r при цене 3000 ₽ (P50): один параметр — в крайние значения');
const SENS = [
  ['разбор данных: никогда / всегда', { use: 0 }, { use: 1 }],
  ['спрос на высвобожденные часы κ', { kappa: [0.3, 0.3, 0.3] }, { kappa: [1, 1, 1] }],
  ['маржа часа резания', { value: [1200, 1200, 1200] }, { value: [3500, 3500, 3500] }],
  ['фонд времени (смены)', { hours: [2000, 2000, 2000] }, { hours: [4000, 4000, 4000] }],
  ['загрузка до внедрения', { u0: [0.25, 0.25, 0.25] }, { u0: [0.5, 0.5, 0.5] }],
  ['время сотрудников клиента', { staffH: [40, 40, 40] }, { staffH: [8, 8, 8] }],
];
console.log('| Параметр | r при худшем | r при лучшем |');
console.log('|---|---|---|');
for (const [name, lo, hi] of SENS) console.log(`| ${name} | ${n2(rAt(draws(lo), 3000).p50)} | ${n2(rAt(draws(hi), 3000).p50)} |`);

// ---------- 4. Окупаемость для команды T — общая модель (4.1-A/payback.mjs), сценарий E01 из 4.1-E/payback.csv ----------
const E_DIR = join(HERE, '..', '4.1-E');
const pool = loadGroup(E_DIR, 'a');
const e01 = pool.find((p) => p.id === 'E01');
const e08 = pool.find((p) => p.id === 'E08');
const raw01 = parseCsv(readFileSync(join(E_DIR, 'payback.csv'), 'utf8')).find((s) => s.id === 'E01');
const SCEN = {
  units: Number(raw01.units), setupFee: Number(raw01.setup_fee), onboard: Number(raw01.onboard),
  varCost: Number(raw01.var_cost), churn: Number(raw01.churn), ...buildOf(e01.time, e01.capital),
};
const at = (price) => ({ ...SCEN, price });
const PACE = Number(raw01.n3) / (36 - SCEN.buildMonths); // темп из масштаба q: 150 заводов к концу третьего года
const tStr = (t) => (t > 84 ? '> 84' : String(t));
const cap = (t) => Math.min(t, 84);
const RAMPS = [1, 2.5, PACE];
console.log(`\n4. Срок окупаемости для команды T, мес. (новых заводов в месяц после MVP; ${n1(PACE)} — темп из масштаба q)`);
console.log(`| Цена | ${RAMPS.map((c) => `${n1(c)} в мес.`).join(' | ')} | Заводов в месяц для T ≤ 22 |`);
console.log(`|---|${RAMPS.map(() => '---').join('|')}|---|`);
for (const price of PRICES) {
  const need = clientsFor(at(price), 22);
  console.log(`| ${n0(price)} | ${RAMPS.map((c) => tStr(payback(at(price), c))).join(' | ')} | ${need === Infinity ? 'недостижимо' : n1(need)} |`);
}

// ---------- 5. ИСЦП кандидата 01 против разбора заявки 08 (параметры 08 — из 4.1-E/pilot-a.csv) ----------
const lead = evaluate(e08, e08.r_mode, e08.q_mode, e08.t_mode).isc6;
const SCALE = { plants: Number(raw01.n3), perPlant: SCEN.units, fte: 8 }; // масштаб K — как в карточке 01
const qOf = (effect) => (SCALE.plants * SCALE.perPlant * effect) / (SCALE.fte * 4e6);
const qNew = { min: qOf(eff.p10), mode: qOf(eff.p50), max: qOf(eff.p90) };
// В формулу — с округлением, как в pilot-a.csv: r до сотых, q до десятых.
const r2 = (v) => Math.round(v * 100) / 100;
const q1 = (v) => Math.round(v * 10) / 10;

function table(ds, q) {
  console.log('| Цена | r P50 | T при темпе из q | ИСЦП | T при 1 заводе в мес. | ИСЦП | Обгоняет 08 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const price of PRICES) {
    const r = rAt(ds, price);
    const tFast = payback(at(price), PACE), tSlow = payback(at(price), 1);
    const iFast = evaluate(e01, r2(r.p50), q1(q), cap(tFast)).isc6, iSlow = evaluate(e01, r2(r.p50), q1(q), cap(tSlow)).isc6;
    const flips = iSlow > lead ? 'да' : iFast > lead ? 'только при темпе из q' : 'нет';
    console.log(`| ${n0(price)} | ${n2(r.p50)} | ${tStr(tFast)} | ${n2(iFast)} | ${tStr(tSlow)} | ${n2(iSlow)} | ${flips} |`);
  }
}
console.log(`\n5. ИСЦП (α 0,6) кандидата 01 по цене; разбор заявки 08 — ${n2(lead)} (4.1-E v0.3)`);
console.log(`  q по эффекту (${SCALE.plants} заводов × ${SCALE.perPlant} станков, ${SCALE.fte} FTE): ${n1(qNew.min)} / ${n1(qNew.mode)} / ${n1(qNew.max)}`);
table(base, qNew.mode);

// Сценарий «мониторинг и разбор как услуга»: клиент всегда заводит разбор (use = 1).
const svc = draws({ use: 1 });
const effS = pct(svc.map((d) => d.effect));
const qS = qOf(effS.p50);
console.log(`\n  Сценарий «разбор как часть услуги» (use = 1): эффект P50 ${n0(effS.p50)} ₽, q ${n1(qS)}`);
table(svc, qS);

// Сверка с 4.1-E/pilot-a.csv (E01) при цене карточки 01 (3–6 тыс. ₽ за станок в месяц, середина — 4500 ₽).
const CARD_PRICE = 4500;
const rC = rAt(base, CARD_PRICE);
const tC = [payback(at(CARD_PRICE), 2 * PACE), payback(at(CARD_PRICE), PACE), payback(at(CARD_PRICE), PACE / 2)];
console.log(`\n6. E01 при цене карточки ${n0(CARD_PRICE)} ₽: r ${n2(rC.p10)} / ${n2(rC.p50)} / ${n2(rC.p90)}; ` +
  `q ${n1(qNew.min)} / ${n1(qNew.mode)} / ${n1(qNew.max)}; T ${tC.map(tStr).join(' / ')} мес.`);
console.log(`  в pilot-a.csv: r ${e01.r_min} / ${e01.r_mode} / ${e01.r_max}; q ${e01.q_min} / ${e01.q_mode} / ${e01.q_max}; T ${e01.t_min} / ${e01.t_mode} / ${e01.t_max}`);
const show = (e) => `ИСЦП ${n2(e.isc6)} (M ${n2(e.M)}, K ${n2(e.K)}, P ${n2(e.P)}, V ${n2(e.V)}, R ${n2(e.R)}, ${quadrant(e.V, e.R, e01.G)})`;
console.log(`  01: ${show(evaluate(e01, r2(rC.p50), q1(qNew.mode), cap(tC[1])))}`);
console.log(`  01 при 1 заводе в месяц: ${show(evaluate(e01, r2(rC.p50), q1(qNew.mode), cap(payback(at(CARD_PRICE), 1))))}`);
console.log(`  08: ИСЦП ${n2(lead)}`);
