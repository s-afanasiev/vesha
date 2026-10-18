// 1.1-F. Цена капитала и отсечение проектов.
// Считает: годовые ряды ключевой ставки РФ, стоимость капитала (WACC) по панели стран,
// максимальный срок окупаемости проекта при заданной ставке и маржинальности (NPV = 0),
// IRR типовых профилей проектов и прохождение фильтра при WACC 10/18/25 %.
//
// Запуск: node docs/economic-strength/data/1.1-F/wacc-cutoff.mjs
// Источники: ЦБ РФ (ключевая ставка, кривая ОФЗ), FRED (10-летние госдоходности),
//            Damodaran (страновые премии), WDI (ставки по кредитам/депозитам, инфляция), ФРП.
// Сырьё: data/economic-strength/1.1-F/raw/ (корень репозитория).
// Модельные параметры помечены [О] и собраны в блоке PARAMS ниже — правятся в одном месте.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RAW_DIR = join(ROOT, 'data', 'economic-strength', '1.1-F', 'raw');
const RUN_DATE = new Date().toISOString().slice(0, 10);

// ── [О] Модельные параметры WACC (стандартный промышленный проект, прозрачная рамка) ──
const PARAMS = {
  wE: 0.6,          // доля собственного капитала (базовый сценарий)
  wD: 0.4,          // доля долга
  beta: 1.0,        // базовая бета (равна рыночной); чувствительность проверяется отдельно
  taxRU: 0.20,      // налог на прибыль РФ в 2024 г. (основная ставка НК РФ; с 2025 г. — 25 %);
                    // в таблице Дамодарана значение налога для РФ искажено (8,14 % = дубль ERP) — не используем
  waccThresholds: [0.10, 0.18, 0.25], // пороги фильтра из плана (S3)
};

// ── [О] Типовые профили проектов: денежный поток года t как доля от инвестиции I ──
// Параметры экспертные (модельные): год выхода на поток и устойчивая маржа. Правятся здесь.
const PROJECT_CLASSES = [
  { name: 'Быстрый SaaS / инженерный инструмент', cf: [0.10, 0.35, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55] },
  { name: 'Роботизированная ячейка (интеграция)', cf: [0.20, 0.45, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50] },
  { name: 'Завод станков', cf: [0.00, 0.10, 0.25, 0.35, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40] },
  { name: 'Фабрика ЭКБ (микроэлектроника)', cf: [0.00, 0.00, 0.05, 0.15, 0.20, 0.28, 0.28, 0.28, 0.28, 0.28, 0.28, 0.28] },
  { name: 'Тяжёлый САПР / PLM', cf: [0.00, 0.10, 0.30, 0.45, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50] },
];

// ── Служебное ──
async function fetchBuf(url, { timeout = 45000, tries = 3 } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1200 * i)); }
    finally { clearTimeout(t); }
  }
  throw new Error(`${url}: ${lastErr.message}`);
}
const csv = (rows) => '\uFEFF' + rows.map((r) => r.join(';')).join('\n') + '\n';
const f2 = (x, d = 2) => (x == null || Number.isNaN(x) ? 'NA' : Number(x).toFixed(d));

mkdirSync(RAW_DIR, { recursive: true });

// ── 1. Ключевая ставка РФ (дневной ряд ЦБ) ──
console.log('1) Ключевая ставка ЦБ РФ…');
const krHtml = (await fetchBuf('https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=17.09.2013&UniDbQuery.To=17.10.2027')).toString('utf8');
writeFileSync(join(RAW_DIR, `cbr_keyrate_${RUN_DATE}.html`), krHtml);
const krDaily = [];
for (const m of krHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim());
  const ds = cells.find((c) => /^\d{2}\.\d{2}\.\d{4}$/.test(c));
  const rs = cells.find((c) => /^\d+[,.]\d+$/.test(c));
  if (ds && rs) {
    const [d, mo, y] = ds.split('.').map(Number);
    krDaily.push({ date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, year: y, rate: Number(rs.replace(',', '.')) });
  }
}
krDaily.sort((a, b) => a.date.localeCompare(b.date));
console.log(`   дней: ${krDaily.length}; последний: ${krDaily.at(-1).date} = ${krDaily.at(-1).rate}%`);
writeFileSync(join(HERE, 'keyrate-daily.csv'), csv([['date', 'rate_pct'], ...krDaily.map((r) => [r.date, f2(r.rate, 2)])]));
const krYears = {};
for (const r of krDaily) (krYears[r.year] ??= []).push(r.rate);
const krAnnual = Object.keys(krYears).sort().map((y) => [y, f2(krYears[y].reduce((s, x) => s + x, 0) / krYears[y].length)]);
writeFileSync(join(HERE, 'keyrate-annual.csv'), csv([['year', 'keyrate_avg_pct'], ...krAnnual]));
console.log('   годовые средние:', krAnnual.map((r) => `${r[0]}:${r[1]}`).join(' '));

// ── 2. Кривая ОФЗ (последняя доступная дата; исторические даты сайт не отдаёт) ──
console.log('2) Кривая ОФЗ (последняя доступная)…');
const zcHtml = (await fetchBuf('https://www.cbr.ru/hd_base/zcyc_params/zcyc/')).toString('utf8');
writeFileSync(join(RAW_DIR, `cbr_zcyc_${RUN_DATE}.html`), zcHtml);
const zcDate = (zcHtml.match(/Данные на (\d{2}\.\d{2}\.\d{4})/) ?? zcHtml.match(/>(\d{2}\.\d{2}\.\d{4})</) ?? [])[1] ?? '?';
let ofzCurve = [];
for (const m of zcHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim());
  if (cells[0]?.includes('Срок') && cells.some((c) => /10[,.]?0?0/.test(c))) {
    const terms = cells.slice(1).map((c) => Number(c.replace(',', '.')));
    ofzCurve = { kind: 'terms', terms };
  } else if (cells[0]?.includes('Доходность')) {
    const vals = cells.slice(1).map((c) => Number(c.replace(',', '.')));
    if (ofzCurve.kind === 'terms' && vals.length === ofzCurve.terms.length) {
      ofzCurve.body = ofzCurve.terms.map((t, i) => [t, vals[i]]);
    }
  }
}
if (ofzCurve.body) {
  writeFileSync(join(HERE, 'ofz-curve-latest.csv'), csv([['term_years', 'yield_pct', 'curve_date'], ...ofzCurve.body.map(([t, v]) => [t, f2(v), zcDate])]));
  const y10 = ofzCurve.body.find(([t]) => t === 10);
  console.log(`   дата ${zcDate}; точек: ${ofzCurve.body.length}; ОФЗ 10 лет: ${y10 ? f2(y10[1]) : 'NA'}%`);
} else console.log('   кривая не распознана');

// ── 3. FRED: 10-летние госдоходности панели ──
console.log('3) 10-летние госдоходности (FRED)…');
const FRED = [
  ['USA', 'DGS10'], ['DEU', 'IRLTLT01DEM156N'], ['KOR', 'IRLTLT01KRM156N'],
  ['TUR', 'IRLTLT01TRM156N'], ['BRA', 'IRLTLT01BRM156N'], ['CHN', 'IRLTLT01CNM156N'],
  ['RUS', 'IRLTLT01RUM156N'], // исторический ряд РФ (если ещё доступен)
];
const yields = {}; // iso3 -> год -> среднее
for (const [iso, id] of FRED) {
  try {
    const csvTxt = (await fetchBuf(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`)).toString('utf8');
    writeFileSync(join(RAW_DIR, `fred_${id}_${RUN_DATE}.csv`), csvTxt);
    const byYear = {};
    for (const line of csvTxt.split(/\r?\n/).slice(1)) {
      const [d, v] = line.split(',');
      if (!v || v === '.' || v === '') continue;
      const y = Number(d.slice(0, 4));
      (byYear[y] ??= []).push(Number(v));
    }
    yields[iso] = {};
    for (const y of Object.keys(byYear)) yields[iso][y] = byYear[y].reduce((s, x) => s + x, 0) / byYear[y].length;
    const last = Object.keys(yields[iso]).sort().at(-1);
    console.log(`   ${iso} (${id}): последний год ${last} = ${f2(yields[iso][last])}%`);
  } catch (e) { console.log(`   ${iso} (${id}): ${e.message}`); }
  await new Promise((res) => setTimeout(res, 500));
}

// ── 4. Damodaran: страновые премии ──
console.log('4) Damodaran (страновые премии)…');
const dmHtml = (await fetchBuf('https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html')).toString('utf8');
writeFileSync(join(RAW_DIR, `damodaran_ctryprem_${RUN_DATE}.html`), dmHtml);
const dmRows = [...dmHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
  [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()));
const hdr = dmRows.find((r) => r[0] === 'Country' && r.some((c) => /default spread/i.test(c)));
const col = (rx) => hdr.findIndex((c) => rx.test(c));
const iSpread = col(/adj\.? default spread|default spread/i), iCrp = col(/country risk premium/i), iErp = col(/^equity risk premium/i), iTax = col(/corporate tax rate/i);
const dmDate = (dmHtml.replace(/<[^>]+>/g, ' ').match(/updated\s+([A-Z][a-z]+ \d{4})/) ?? ['', ''])[1];
const dmCtry = {};
for (const iso of ['Russia', 'China', 'Germany', 'United States', 'Korea', 'Turkey', 'Brazil']) {
  const r = dmRows.find((x) => x[0]?.replace(/\s*\(updated[^)]*\)/i, '').trim() === iso);
  if (!r) { console.log(`   ${iso}: не найдено`); continue; }
  let tax = /NA/.test(r[iTax]) ? null : parseFloat(r[iTax]) / 100;
  let taxNote = '';
  if (iso === 'Russia') { tax = PARAMS.taxRU; taxNote = ' (в таблице Дамодарана налог искажён — использована ставка НК РФ 2024 г.)'; }
  dmCtry[iso] = { rating: r[1], spread: parseFloat(r[iSpread]) / 100, crp: parseFloat(r[iCrp]) / 100, erp: parseFloat(r[iErp]) / 100, tax };
  console.log(`   ${iso}: рейтинг ${r[1]}, спред ${r[iSpread]}, CRP ${r[iCrp]}, ERP ${r[iErp]}, налог ${r[iTax]}${taxNote}`);
}
const matureERP = dmCtry.Germany?.erp ?? null;
writeFileSync(join(HERE, 'damodaran-crp.csv'), csv([
  ['country', 'rating', 'default_spread_pct', 'crp_pct', 'total_erp_pct', 'tax_rate_pct', 'date'],
  ...['Russia', 'China', 'Germany', 'United States', 'Korea', 'Turkey', 'Brazil'].filter((c) => dmCtry[c])
    .map((c) => [c, dmCtry[c].rating, f2(dmCtry[c].spread * 100), f2(dmCtry[c].crp * 100), f2(dmCtry[c].erp * 100), dmCtry[c].tax == null ? 'NA' : f2(dmCtry[c].tax * 100), dmDate || RUN_DATE]),
]));

// ── 5. WDI: ставки по кредитам/депозитам и инфляция ──
console.log('5) WDI: ставки и инфляция…');
const WDI = [['FR.INR.LEND', 'lending'], ['FR.INR.RINR', 'real_lending'], ['FR.INR.DPST', 'deposit'], ['FP.CPI.TOTL.ZG', 'inflation']];
const wdi = {}; // iso3 -> series -> year -> value
const ISO = ['RUS', 'CHN', 'USA', 'DEU', 'KOR', 'TUR', 'BRA'];
for (const [code, key] of WDI) {
  const j = JSON.parse((await fetchBuf(`https://api.worldbank.org/v2/country/${ISO.join(';')}/indicator/${code}?date=2010:2026&format=json&per_page=20000`)).toString('utf8'));
  writeFileSync(join(RAW_DIR, `wdi_${code}_${RUN_DATE}.json`), JSON.stringify(j));
  for (const row of j[1] ?? []) {
    if (row.value == null) continue;
    ((wdi[row.countryiso3code] ??= {})[key] ??= {})[Number(row.date)] = Number(row.value);
  }
  console.log(`   ${code}: получен`);
  await new Promise((res) => setTimeout(res, 400));
}

// ── 6. ФРП: условия программ (страница) ──
console.log('6) ФРП: условия займов…');
try {
  const frpHtml = (await fetchBuf('https://frprf.ru/zaymy/')).toString('utf8');
  writeFileSync(join(RAW_DIR, `frprf_zaymy_${RUN_DATE}.html`), frpHtml);
  const txt = frpHtml.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = txt.match(/займы[^.]*ставк[^.]*3% и 5%[^.]*\./i) ?? txt.match(/3% и 5%[^.]*\./);
  writeFileSync(join(HERE, 'frp-facts.txt'), `ФРП, страница программ (выгрузка ${RUN_DATE}):\n${m ? m[0].trim() : 'фрагмент не распознан'}\n`);
  console.log('   факт:', m ? m[0].trim().slice(0, 160) : 'не распознан');
} catch (e) { console.log('   ФРП:', e.message); }

// ── 7. Модель: WACC по панели (валютная рамка Дамодарана, 2024) ──
// Рамка: безрисковая = 10Y США; Ke = Rf + ERP (Дамодаран, включает страновую премию);
// Kd = Rf + суверенный спред (прокси корпоративного), после налога СТРАНЫ.
// Сопоставимая база (валютная) — для ответа на вопрос 1 «из чего складывается».
console.log('\n7) WACC по панели (валютная рамка Дамодарана, год 2024)…');
const YEAR = '2024';
const RU_KEYRATE_2024 = krYears[2024] ? krYears[2024].reduce((s, x) => s + x, 0) / krYears[2024].length : null;
const US10Y_2024 = yields.USA?.[YEAR] != null ? yields.USA[YEAR] / 100 : null;
const NAME = { RUS: 'Россия', CHN: 'Китай', USA: 'США', DEU: 'Германия', KOR: 'Корея', TUR: 'Турция', BRA: 'Бразилия' };
const DMKEY = { RUS: 'Russia', CHN: 'China', USA: 'United States', DEU: 'Germany', KOR: 'Korea', TUR: 'Turkey', BRA: 'Brazil' };
const waccRows = [['iso3', 'country', 'rf_usd_pct', 'default_spread_pct', 'crp_pct', 'total_erp_pct', 'cost_equity_pct', 'cost_debt_after_tax_pct', 'tax_pct', 'wacc_nominal_usd_pct', 'lending_rate_local_pct', 'inflation_pct', 'year']];
for (const iso of ISO) {
  const dm = dmCtry[DMKEY[iso]];
  const rf = US10Y_2024;
  const erp = dm?.erp ?? null;
  const ke = rf != null && erp != null ? rf + erp * PARAMS.beta : null;
  const kdUsd = rf != null && dm ? rf + dm.spread : null;
  const tax = dm?.tax ?? null;
  const kdAfter = kdUsd != null && tax != null ? kdUsd * (1 - tax) : null;
  const wacc = ke != null && kdAfter != null ? PARAMS.wE * ke + PARAMS.wD * kdAfter : null;
  const kdLocal = wdi[iso]?.lending?.[YEAR] != null ? wdi[iso].lending[YEAR] / 100 : null;
  const infl = wdi[iso]?.inflation?.[YEAR] != null ? wdi[iso].inflation[YEAR] / 100 : null;
  waccRows.push([iso, NAME[iso], f2(rf != null ? rf * 100 : null), f2(dm?.spread != null ? dm.spread * 100 : null), f2(dm?.crp != null ? dm.crp * 100 : null), f2(erp != null ? erp * 100 : null), f2(ke != null ? ke * 100 : null), f2(kdAfter != null ? kdAfter * 100 : null), f2(tax != null ? tax * 100 : null), f2(wacc != null ? wacc * 100 : null), f2(kdLocal != null ? kdLocal * 100 : null), f2(infl != null ? infl * 100 : null), YEAR]);
  console.log(`   ${NAME[iso]}: Rf$ ${f2(rf != null ? rf * 100 : null)}% + спред ${f2(dm?.spread != null ? dm.spread * 100 : null)}% (=${f2(rf != null && dm ? (rf + dm.spread) * 100 : null)}%), ERP ${f2(erp != null ? erp * 100 : null)}% → Ke ${f2(ke != null ? ke * 100 : null)}%, WACC$ ${f2(wacc != null ? wacc * 100 : null)}% | ставка кредита локальная ${f2(kdLocal != null ? kdLocal * 100 : null)}%`);
}
writeFileSync(join(HERE, 'wacc-panel.csv'), csv(waccRows));

// ── 7b. Россия: рублёвая цена денег и её разложение (факты 2024 + остаток) ──
console.log('\n7b) Россия: разложение рублёвой цены денег (2024)…');
const rusLend = wdi.RUS?.lending?.[YEAR] ?? null;
const rusInfl = wdi.RUS?.inflation?.[YEAR] ?? null;
const rusDm = dmCtry.Russia ?? {};
const usdEq = US10Y_2024 != null && rusDm.spread != null ? US10Y_2024 + rusDm.spread : null;
const gap = RU_KEYRATE_2024 != null && usdEq != null ? RU_KEYRATE_2024 / 100 - usdEq : null;
const gapMinusInfl = gap != null && rusInfl != null ? gap - rusInfl / 100 : null;
const ruDecomp = [
  ['item', 'value_pct', 'note'],
  ['Ключевая ставка ЦБ, средняя за 2024', f2(RU_KEYRATE_2024), 'ЦБ РФ, дневной ряд'],
  ['10-летняя доходность США, средняя за 2024', f2(US10Y_2024 != null ? US10Y_2024 * 100 : null), 'FRED DGS10 (валютная безрисковая)'],
  ['Суверенный спред РФ (Дамодаран)', f2(rusDm.spread != null ? rusDm.spread * 100 : null), 'Moody’s NR, Adj. Default Spread'],
  ['Валютный эквивалент безрисковой для РФ', f2(usdEq != null ? usdEq * 100 : null), 'сумма двух строк выше'],
  ['Разрыв рублёвой и валютной безрисковой', f2(gap != null ? gap * 100 : null), 'ключевая − валютный эквивалент'],
  ['Инфляция РФ 2024 (WDI)', f2(rusInfl), 'FP.CPI.TOTL.ZG'],
  ['Разрыв минус инфляция (остаток)', f2(gapMinusInfl != null ? gapMinusInfl * 100 : null), 'инфляционные ожидания, премия за риск, жёсткость ДКП'],
  ['Ставка по кредитам нефинансовым организациям, 2024', f2(rusLend), 'WDI FR.INR.LEND'],
  ['Реальная ставка по кредитам, 2024', f2(wdi.RUS?.real_lending?.[YEAR]), 'WDI FR.INR.RINR'],
  ['Депозитная ставка, 2024', f2(wdi.RUS?.deposit?.[YEAR]), 'WDI FR.INR.DPST'],
  ['Модельная Ke (рубл.): ключевая + ERP', f2(RU_KEYRATE_2024 != null && rusDm.erp != null ? (RU_KEYRATE_2024 / 100 + rusDm.erp) * 100 : null), '[О]: локальная CAPM-рамка, β=1'],
  ['Модельный WACC (рубл.), 2024', f2(RU_KEYRATE_2024 != null && rusDm.erp != null && rusLend != null ? (0.6 * (RU_KEYRATE_2024 / 100 + rusDm.erp) + 0.4 * (rusLend / 100) * (1 - PARAMS.taxRU)) * 100 : null), '[О]: wE=0,6, wD=0,4, налог 20 %'],
];
console.log(`   ключевая ${f2(RU_KEYRATE_2024)}% ≈ валютная безрисковая ${f2(usdEq != null ? usdEq * 100 : null)}% + разрыв ${f2(gap != null ? gap * 100 : null)} (инфляция ${f2(rusInfl)}% + остаток ${f2(gapMinusInfl != null ? gapMinusInfl * 100 : null)})`);
writeFileSync(join(HERE, 'russia-ruble-decomposition.csv'), csv(ruDecomp));

// ── 8. Россия: ряд цены капитала 2010–2024 ──
const ruRows = [['year', 'keyrate_avg_pct', 'lending_rate_pct', 'deposit_rate_pct', 'real_lending_pct', 'inflation_pct']];
for (let y = 2010; y <= 2024; y++) {
  ruRows.push([y, f2(krYears[y] ? krYears[y].reduce((s, x) => s + x, 0) / krYears[y].length : null), f2(wdi.RUS?.lending?.[y]), f2(wdi.RUS?.deposit?.[y]), f2(wdi.RUS?.real_lending?.[y]), f2(wdi.RUS?.inflation?.[y])]);
}
writeFileSync(join(HERE, 'russia-cost-of-capital.csv'), csv(ruRows));
console.log('   ряд России 2010–2024 записан');

// ── 9. Максимальный срок окупаемости (NPV = 0) при ставке r и маржинальности m ──
// N = ln(1 − r/m) / ln(1 + r)⁻¹; при m ≤ r окупаемость не наступает.
function maxPayback(r, m) {
  if (m <= r) return Infinity;
  return -Math.log(1 - r / m) / Math.log(1 + r);
}
const margins = [0.15, 0.20, 0.30, 0.40, 0.50];
const pbRows = [['discount_rate_pct', ...margins.map((m) => `margin_${Math.round(m * 100)}pct_years`)]];
console.log('\n8) Максимальный срок окупаемости (лет, NPV = 0):');
for (const r of PARAMS.waccThresholds) {
  const cells = margins.map((m) => { const n = maxPayback(r, m); return n === Infinity ? 'не окупается' : n.toFixed(1); });
  pbRows.push([Math.round(r * 100), ...cells]);
  console.log(`   r=${Math.round(r * 100)}%: ` + margins.map((m, i) => `m=${Math.round(m * 100)}%→${cells[i]}`).join('  '));
}
writeFileSync(join(HERE, 'payback-cutoff.csv'), csv(pbRows));

// ── 10. IRR типовых профилей и фильтр 10/18/25 % ──
function npv(rate, cf) { return cf.reduce((s, c, i) => s + c / Math.pow(1 + rate, i + 1), -1); }
function irr(cf) {
  let lo = -0.89, hi = 5;
  if (npv(lo, cf) < 0) return NaN;
  if (npv(hi, cf) > 0) return NaN;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(mid, cf) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const pcRows = [['project_class', 'year_first_cf', 'steady_margin_pct', 'irr_pct', 'pass_10pct', 'pass_18pct', 'pass_25pct', 'npv_at_10pct_per_I', 'npv_at_25pct_per_I']];
console.log('\n9) Классы проектов (модельные профили [О]) и фильтр WACC:');
for (const pc of PROJECT_CLASSES) {
  const r = irr(pc.cf);
  const first = pc.cf.findIndex((c) => c > 0) + 1;
  const steady = pc.cf.at(-1);
  const pass = PARAMS.waccThresholds.map((t) => (r >= t ? 'да' : 'нет'));
  pcRows.push([pc.name, first, Math.round(steady * 100), f2(r * 100, 1), ...pass, f2(npv(0.10, pc.cf), 2), f2(npv(0.25, pc.cf), 2)]);
  console.log(`   ${pc.name}: IRR ${f2(r * 100, 1)}% | 10%: ${pass[0]}, 18%: ${pass[1]}, 25%: ${pass[2]}`);
}
writeFileSync(join(HERE, 'project-classes-cutoff.csv'), csv(pcRows));
console.log('\nГотово: keyrate-annual.csv, ofz-curve-latest.csv, wacc-panel.csv, russia-cost-of-capital.csv, payback-cutoff.csv, project-classes-cutoff.csv');
