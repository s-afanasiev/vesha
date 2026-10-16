// Фикстура каталога для костяка MVP (docs/backbone-architecture.md §10, шаг 1):
// 300 позиций крепежа и сантехники — заместитель живой выгрузки 1С до шага 6.
// Детерминированная: цены и остатки — из хеша артикула, повторный запуск даёт тот же файл.
// Запуск: node scripts/backbone-catalog-fixture.mjs

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv');
const TOTAL = 300;

const hash = (s) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const items = [];
function add(group, sku, name, { unit = 'шт', pack = 1, base }) {
  const h = hash(sku);
  const price = Math.max(0.5, Math.round(base * (0.9 + (h % 21) / 100) * 100) / 100);
  const stock = h % 19 === 0 ? 0 : (h % 40) * pack + pack;
  items.push({ sku, name, group, unit, pack, price, stock });
}
const mm = (d) => String(d).replace('.', ',');

// Болты DIN 933
for (const [d, lens] of [[6, [16, 20, 25, 30, 40, 50]], [8, [20, 25, 30, 40, 50, 60]], [10, [25, 30, 40, 50, 60, 80]], [12, [30, 40, 50, 60, 80, 100]]]) {
  for (const l of lens) add('Болты', `B933-${d}x${l}-ZN`, `Болт DIN 933 М${d}×${l} кл. 8.8 оцинк.`, { pack: d >= 10 ? 25 : 50, base: d * l * 0.012 });
}
for (const d of [6, 8, 10]) for (const l of [20, 30, 40, 50]) add('Болты', `B933-${d}x${l}-A2`, `Болт DIN 933 М${d}×${l} нерж. A2`, { pack: 25, base: d * l * 0.035 });
// Гайки и шайбы
for (const d of [4, 5, 6, 8, 10, 12, 14, 16, 20]) {
  add('Гайки', `N934-${d}-ZN`, `Гайка DIN 934 М${d} кл. 8 оцинк.`, { pack: 100, base: d * d * 0.012 });
  add('Гайки', `N934-${d}-A2`, `Гайка DIN 934 М${d} нерж. A2`, { pack: 100, base: d * d * 0.04 });
  add('Шайбы', `W125-${d}-ZN`, `Шайба DIN 125 М${d} оцинк.`, { pack: 200, base: d * d * 0.006 });
  add('Шайбы', `W127-${d}-ZN`, `Шайба гроверная DIN 127 М${d} оцинк.`, { pack: 200, base: d * d * 0.008 });
}
for (const d of [5, 6, 8, 10, 12, 14, 16, 20]) add('Гайки', `N985-${d}-ZN`, `Гайка самоконтрящаяся DIN 985 М${d} оцинк.`, { pack: 100, base: d * d * 0.02 });
// Винты DIN 912
for (const [d, lens] of [[4, [10, 16, 20, 25]], [5, [12, 16, 20, 30]], [6, [16, 20, 30, 40]], [8, [20, 30, 40, 50]]]) {
  for (const l of lens) add('Винты', `S912-${d}x${l}`, `Винт DIN 912 М${d}×${l} кл. 8.8 внутр. шестигранник`, { pack: 100, base: d * l * 0.02 });
}
// Саморезы
for (const [d, lens] of [[3.5, [16, 20, 25, 30, 35, 40, 45, 50]], [4, [30, 35, 40, 50, 60, 70]], [4.5, [40, 50, 60, 70, 80]], [5, [50, 60, 70, 80, 100]]]) {
  for (const l of lens) add('Саморезы', `SW-${d}x${l}-YZ`, `Саморез по дереву ${mm(d)}×${l} жёлтый цинк`, { pack: 200, base: d * l * 0.006 });
}
for (const [d, lens] of [[3.5, [19, 25, 32, 41, 51, 55]], [3.8, [45, 55, 64]], [4.2, [65, 75, 90]]]) {
  for (const l of lens) add('Саморезы', `SM-${d}x${l}-PH`, `Саморез гипсокартон-металл ${mm(d)}×${l} фосфат.`, { pack: 500, base: d * l * 0.004 });
}
for (const ral of ['RAL 3005', 'RAL 6005', 'RAL 8017', 'оцинк.']) {
  for (const l of [19, 29, 35, 51]) add('Саморезы', `SR-4.8x${l}-${ral.replace(/\W+/g, '')}`, `Саморез кровельный 4,8×${l} ${ral}`, { pack: 250, base: l * 0.09 });
}
for (const tip of ['острый', 'со сверлом']) {
  for (const l of [13, 16, 19, 25, 32, 41]) add('Саморезы', `SP-4.2x${l}-${tip === 'острый' ? 'S' : 'D'}`, `Саморез с прессшайбой 4,2×${l} ${tip}`, { pack: 500, base: l * 0.05 });
}
// Анкеры и дюбели
for (const [d, lens] of [[6, [40, 60]], [8, [50, 75, 90]], [10, [60, 80, 100]], [12, [80, 100, 120]]]) {
  for (const l of lens) add('Анкеры', `AK-${d}x${l}`, `Анкер клиновой ${d}×${l}`, { pack: 50, base: d * l * 0.02 });
}
for (const [d, lens] of [[8, [65, 85]], [10, [77, 97]], [12, [100, 129]]]) {
  for (const l of lens) add('Анкеры', `AB-${d}x${l}`, `Анкерный болт с гайкой ${d}×${l}`, { pack: 25, base: d * l * 0.03 });
}
for (const [d, l] of [[5, 25], [6, 30], [6, 40], [8, 40], [8, 50], [10, 50], [10, 60], [12, 60]]) add('Дюбели', `DP-${d}x${l}`, `Дюбель распорный ${d}×${l}`, { pack: 100, base: d * l * 0.004 });
for (const [d, l] of [[6, 40], [6, 60], [6, 80], [8, 60], [8, 80], [8, 100]]) add('Дюбели', `DG-${d}x${l}`, `Дюбель-гвоздь ${d}×${l} грибовидный`, { pack: 100, base: d * l * 0.006 });
// Шпильки и заклёпки
for (const d of [6, 8, 10, 12, 14, 16, 20]) add('Шпильки', `ST975-${d}-ZN`, `Шпилька резьбовая DIN 975 М${d}×1000 оцинк.`, { base: d * d * 0.9 });
for (const d of [8, 10, 12]) add('Шпильки', `ST975-${d}-A2`, `Шпилька резьбовая DIN 975 М${d}×1000 нерж. A2`, { base: d * d * 3 });
for (const [d, lens] of [[3.2, [6, 8, 10, 12]], [4, [8, 10, 12, 16]], [4.8, [10, 12, 16, 20]]]) {
  for (const l of lens) add('Заклёпки', `RV-${d}x${l}`, `Заклёпка вытяжная ${mm(d)}×${l} алюминий/сталь`, { pack: 500, base: d * l * 0.015 });
}
// Сантехника
for (const [a, b] of [[8, 12], [10, 16], [12, 20], [16, 25], [20, 32], [25, 40], [32, 50], [40, 60], [50, 70], [60, 80]]) {
  add('Хомуты', `HC-${a}-${b}`, `Хомут червячный ${a}–${b} мм нерж.`, { pack: 10, base: b * 0.6 });
}
for (const d of [20, 25, 32]) {
  add('Фитинги ПП', `PP-MF-${d}`, `Муфта ПП ${d} мм`, { pack: 10, base: d * 0.4 });
  add('Фитинги ПП', `PP-EL-${d}`, `Угол ПП 90° ${d} мм`, { pack: 10, base: d * 0.5 });
  add('Фитинги ПП', `PP-TE-${d}`, `Тройник ПП ${d} мм`, { pack: 10, base: d * 0.6 });
  add('Фитинги ПП', `PP-CL-${d}`, `Опора ПП ${d} мм`, { pack: 20, base: d * 0.2 });
  add('Трубы ПП', `PP-PIPE-${d}`, `Труба ПП PN20 ${d} мм`, { unit: 'м', pack: 4, base: d * 3 });
}
for (const size of ['1/2', '3/4', '1']) {
  for (const kind of ['ВР-ВР', 'ВР-НР', 'НР-НР']) {
    add('Краны', `BV-${size.replace('/', '-')}-${kind}`, `Кран шаровой ${size}″ ${kind} бабочка`, { base: (size === '1' ? 3 : size === '3/4' ? 2 : 1.4) * 280 });
  }
}
for (const len of [30, 40, 50, 60, 80, 100]) {
  add('Подводка', `FH-${len}-GG`, `Подводка гибкая для воды ½″ г-г ${len} см`, { base: 160 + len * 2 });
  add('Подводка', `FH-${len}-GS`, `Подводка гибкая для воды ½″ г-ш ${len} см`, { base: 160 + len * 2 });
}
for (const size of ['1/2', '3/4', '1']) {
  add('Сгоны и муфты', `SG-${size.replace('/', '-')}`, `Сгон стальной ${size}″`, { base: (size === '1' ? 3 : size === '3/4' ? 2 : 1.4) * 60 });
  add('Сгоны и муфты', `CM-${size.replace('/', '-')}`, `Муфта стальная ${size}″`, { base: (size === '1' ? 3 : size === '3/4' ? 2 : 1.4) * 30 });
}
for (const [w, l] of [[12, 10], [19, 15]]) add('Уплотнение', `FUM-${w}x${l}`, `Лента ФУМ ${w} мм × ${l} м`, { base: w * 4 });
add('Уплотнение', 'LEN-100', 'Лён сантехнический 100 г', { base: 120 });
add('Уплотнение', 'PASTE-70', 'Паста уплотнительная 70 г', { base: 180 });
// Гвозди, крюки, уголки (хвост: лишнее срезает TOTAL)
for (const [d, l] of [[2, 40], [2.5, 50], [3, 70], [3.5, 90], [4, 100], [4, 120], [5, 150]]) {
  add('Гвозди', `NL-${d}x${l}`, `Гвоздь строительный ${mm(d)}×${l}`, { unit: 'кг', base: 160 });
  add('Гвозди', `NL-${d}x${l}-ZN`, `Гвоздь строительный ${mm(d)}×${l} оцинк.`, { unit: 'кг', base: 260 });
}
for (const d of [5, 6, 8]) {
  for (const kind of ['кольцо', 'полукольцо', 'крюк']) add('Крюки', `HK-${d}-${kind}`, `Шуруп-${kind} ${d}×60 оцинк.`, { pack: 50, base: d * 2 });
}
for (const s of [40, 50, 60, 70, 90]) {
  add('Уголки', `UG-${s}`, `Уголок крепёжный ${s}×${s}×2 оцинк.`, { pack: 25, base: s * 0.4 });
  add('Уголки', `UG-${s}-R`, `Уголок крепёжный усиленный ${s}×${s}×2 оцинк.`, { pack: 25, base: s * 0.6 });
}

if (items.length < TOTAL) throw new Error(`Позиций ${items.length} — меньше ${TOTAL}: добавьте группу`);
const out = items.slice(0, TOTAL);
const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const lines = ['sku,name,group,unit,pack,price,stock', ...out.map((i) => [i.sku, i.name, i.group, i.unit, i.pack, i.price.toFixed(2), i.stock].map(q).join(','))];
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`Записано ${out.length} позиций (из ${items.length} сгенерированных) → ${OUT}`);
