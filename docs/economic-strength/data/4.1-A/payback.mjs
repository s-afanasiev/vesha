// Срок окупаемости для команды T (параметр P формулы ИСЦП; документ 4.1-A, 3.3): помесячный денежный поток продукта.
// Общий модуль для 4.1-E (все кандидаты, t-model.mjs) и 2.2-E (мониторинг станков, model.mjs).

export const FTE_MONTH = 4e6 / 12; // полная стоимость FTE в месяц (4.1-A, 3.3)
export const SERVICE = 0.2;         // поддержка и сопровождение клиентов — доля выручки от подписки, одна для всех [Э]

// Команда до первой продажи — из слагаемых «время» и «капитал» лёгкости входа E (4.1-A, 3.3):
// время → месяцы до запуска (верхняя граница интервала шкалы), капитал → человеко-годы (середина интервала,
// для «2–10» — геометрическая).
const BUILD_MONTHS = { 0: 2, 1: 6, 2: 12, 3: 18 };
const BUILD_PY = { 0: 0.3, 1: 1, 2: 4.5, 3: 10 };
export const buildOf = (time, capital) => ({
  buildMonths: BUILD_MONTHS[time],
  fteBuild: (BUILD_PY[capital] * 12) / BUILD_MONTHS[time],
});

// s — сценарий продукта:
//   price     ₽ за единицу (станок, клиент) в месяц      units    единиц у клиента
//   setupFee  разовая плата клиента за внедрение, ₽      onboard  наши разовые затраты на клиента, ₽
//   varCost   ₽ на единицу в месяц (облако, модель)      churn    отток единиц в месяц
//   fteBuild, buildMonths — команда до первой продажи (buildOf); после запуска она остаётся — развитие продукта
// Поддержка растёт вместе с выручкой: SERVICE от подписки.
// T — первый месяц после запуска, когда накопленный поток неотрицателен; Infinity — не за horizon месяцев.
export function payback(s, clientsPerMonth, horizon = 120) {
  let cash = 0, units = 0;
  for (let m = 1; m <= horizon; m++) {
    const live = m > s.buildMonths;
    const c = live ? clientsPerMonth : 0;
    units = units * (1 - s.churn) + c * s.units;
    cash += units * (s.price * (1 - SERVICE) - s.varCost) + c * ((s.setupFee ?? 0) - s.onboard) - s.fteBuild * FTE_MONTH;
    if (live && cash >= 0) return m;
  }
  return Infinity;
}

// Сколько новых клиентов в месяц нужно, чтобы окупиться не позже target месяцев.
export function clientsFor(s, target) {
  if (payback(s, 200) > target) return Infinity;
  let lo = 0.01, hi = 200;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (payback(s, mid) <= target) hi = mid; else lo = mid; }
  return hi;
}
