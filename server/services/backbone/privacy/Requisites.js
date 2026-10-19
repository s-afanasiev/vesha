// Реквизиты оператора персональных данных (152-ФЗ, docs/backbone-handover.md §7):
// юрлицо или ИП магазина — так его называет политика витрины. Заводит и правит их
// админ в кабинете («Настройки и доступ» → «Завести магазин» / «Изменить»); проверка —
// здесь, до базы: ИНН и ОГРН (ОГРНИП) по длине и контрольной цифре, пара «ИНН —
// ОГРН» одного рода (организация: 10 и 13 цифр, ИП: 12 и 15).
//
// Реквизиты: { name, inn, ogrn, address, email }; email — почта для обращений по ПДн,
// пусто — почта магазина. Пока не заполнены name, inn, ogrn и address (и нет ни одной
// почты) — политика неполная: кабинет предупреждает, витрина заявки принимает.

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const INN_10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

// Что обязано быть в политике — подписями для предупреждения кабинета.
const REQUIRED = { name: 'наименование', inn: 'ИНН', ogrn: 'ОГРН или ОГРНИП', address: 'адрес' };

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const digitsOf = (raw) => String(raw ?? '').replace(/[\s-]/g, '');
const weighted = (digits, weights) => (weights.reduce((s, w, i) => s + w * Number(digits[i]), 0) % 11) % 10;

// ИНН: 10 цифр — организация, 12 — ИП (физлицо); последняя цифра (у 12 — две) — контрольная.
function checkInn(raw) {
  const inn = digitsOf(raw);
  if (!/^\d{10}$|^\d{12}$/.test(inn)) throw bad(`ИНН: «${String(raw ?? '').trim()}» — нужно 10 цифр у организации или 12 у ИП`);
  const ok = inn.length === 10
    ? weighted(inn, INN_10) === Number(inn[9])
    : weighted(inn, INN_11) === Number(inn[10]) && weighted(inn, INN_12) === Number(inn[11]);
  if (!ok) throw bad(`ИНН ${inn}: не сходится контрольная цифра — сверьте с выпиской ЕГРЮЛ или ЕГРИП`);
  return inn;
}

// ОГРН — 13 цифр (организация), ОГРНИП — 15 (ИП): остаток от деления первых 12 (14)
// на 11 (13), его последняя цифра — контрольная.
function checkOgrn(raw) {
  const ogrn = digitsOf(raw);
  if (!/^\d{13}$|^\d{15}$/.test(ogrn)) throw bad(`ОГРН: «${String(raw ?? '').trim()}» — нужно 13 цифр (ОГРН) или 15 (ОГРНИП)`);
  const base = ogrn.length === 13 ? 11n : 13n;
  if (Number((BigInt(ogrn.slice(0, -1)) % base) % 10n) !== Number(ogrn.at(-1))) {
    throw bad(`${ogrnName(ogrn)} ${ogrn}: не сходится контрольная цифра — сверьте с выпиской ЕГРЮЛ или ЕГРИП`);
  }
  return ogrn;
}

const ogrnName = (ogrn) => (String(ogrn || '').length === 15 ? 'ОГРНИП' : 'ОГРН');

function text(raw, what, min, max) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length < min || value.length > max) throw bad(`${what}: от ${min} до ${max} знаков`);
  return value;
}

function emailOf(raw) {
  const email = String(raw ?? '').trim();
  if (!EMAIL.test(email) || email.length > 200) throw bad(`Почта для обращений по ПДн: «${email}» не похоже на адрес`);
  return email;
}

const READ = {
  name: (v) => text(v, 'Оператор ПДн (ООО «…» или ИП Фамилия Имя Отчество)', 3, 200),
  inn: checkInn,
  ogrn: checkOgrn,
  address: (v) => text(v, 'Адрес оператора', 10, 300),
  email: emailOf,
};
// поле формы магазина → поле реквизитов
const FORM_KEYS = { operator: 'name', inn: 'inn', ogrn: 'ogrn', address: 'address', pdEmail: 'email' };

// Поля формы → реквизиты. Пустое поле — прежнее значение (prev), «-» — убрать; ничего
// не задано — null. ИНН организации идёт с ОГРН, ИНН ИП — с ОГРНИП.
function operatorOf(fields = {}, prev = null) {
  const out = {};
  for (const [formKey, key] of Object.entries(FORM_KEYS)) {
    const raw = String(fields[formKey] ?? '').trim();
    out[key] = !raw ? (prev && prev[key]) || null : raw === '-' ? null : READ[key](raw);
  }
  if (out.inn && out.ogrn && (out.inn.length === 10) !== (out.ogrn.length === 13)) {
    throw bad('ИНН и ОГРН разного рода: у организации — ИНН из 10 цифр и ОГРН из 13, у ИП — ИНН из 12 и ОГРНИП из 15');
  }
  return Object.values(out).some(Boolean) ? out : null;
}

// Чего не хватает политике: подписи обязательных реквизитов; почта — своя или магазина.
function missingOf(operator, shopEmail = null) {
  const op = operator || {};
  const missing = Object.entries(REQUIRED).filter(([key]) => !op[key]).map(([, label]) => label);
  if (!op.email && !shopEmail) missing.push('почта для обращений');
  return missing;
}

module.exports = { checkInn, checkOgrn, ogrnName, operatorOf, missingOf, FORM_KEYS };
