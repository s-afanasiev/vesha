// Форма магазина из кабинета (docs/backbone-architecture.md §10, шаг 6): магазин
// заводится без правки кода. Форма — слова человека («пн–сб», «9–19»), выход —
// описание, которое понимают WorkingHours и квитанции. Ошибка — отказ с именем
// поля до базы. Реквизиты оператора ПДн для политики витрины — privacy/Requisites.

const { operatorOf } = require('../privacy/Requisites');

const DAYS = { пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 7 };
const DAY_NAMES = Object.keys(DAYS);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// «пн–сб», «пн-пт, сб», «пн ср пт», «ежедневно» → [1..7]
function parseDays(raw) {
  const text = String(raw ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s*[–—-]\s*/g, '-').trim();
  if (!text) return [1, 2, 3, 4, 5, 6];
  if (/ежедневно|без выходных|каждый день/.test(text)) return [1, 2, 3, 4, 5, 6, 7];
  const days = new Set();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const range = part.match(/^([а-я]{2})[а-я]*-([а-я]{2})[а-я]*$/);
    if (range) {
      const [from, to] = [DAYS[range[1]], DAYS[range[2]]];
      if (!from || !to) throw bad(`Дни работы: не понял «${part}» — пишите «пн–сб» или «пн, ср, пт»`);
      for (let d = from; ; d = (d % 7) + 1) { days.add(d); if (d === to) break; }
      continue;
    }
    const one = DAYS[part.slice(0, 2)];
    if (!one) throw bad(`Дни работы: не понял «${part}» — пишите «пн–сб» или «пн, ср, пт»`);
    days.add(one);
  }
  return [...days].sort((a, b) => a - b);
}

// «09:00–19:00», «9-18», «9.00 - 18.30» → { from, to }
function parseTime(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { from: '09:00', to: '19:00' };
  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*[–—-]\s*(\d{1,2})(?:[:.](\d{2}))?$/);
  const hhmm = (h, mi) => `${String(h).padStart(2, '0')}:${mi || '00'}`;
  if (!m || Number(m[1]) > 23 || Number(m[3]) > 24 || Number(m[2] || 0) > 59 || Number(m[4] || 0) > 59) {
    throw bad(`Часы работы: не понял «${text}» — пишите «09:00–19:00»`);
  }
  const from = hhmm(m[1], m[2]);
  const to = m[3] === '24' ? '23:59' : hhmm(m[3], m[4]);
  if (to <= from) throw bad('Часы работы: конец раньше начала');
  return { from, to };
}

function hoursText(hours) {
  if (!hours) return 'пн–сб 09:00–19:00';
  const days = hours.days || [];
  const run = days.length > 1 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const span = run ? `${DAY_NAMES[days[0] - 1]}–${DAY_NAMES[days[days.length - 1] - 1]}` : days.map((d) => DAY_NAMES[d - 1]).join(', ');
  return `${days.length === 7 ? 'ежедневно' : span} ${hours.from}–${hours.to}`;
}

function replyToOf(raw) {
  const email = String(raw ?? '').trim();
  if (!email) return null;
  if (!EMAIL.test(email) || email.length > 200) throw bad(`Почта для квитанций: «${email}» не похоже на адрес`);
  return email;
}

function nameOf(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 120) throw bad('Название: от 2 до 120 знаков');
  return name;
}

class ShopForm {
  constructor({ niches }) {
    this.niches = niches; // ниши, для которых есть шаблон доски
  }

  // Новый магазин: { slug, name, niche, hours, replyTo, operator }; реквизиты оператора — по желанию
  // (без них политика неполная: кабинет предупреждает).
  create(fields = {}) {
    const slug = String(fields.slug ?? '').trim().toLowerCase();
    if (!SLUG.test(slug)) throw bad('Адрес (slug): латиница, цифры и дефис, от 3 до 40 знаков — например, krepezh-kursk');
    const niche = String(fields.niche ?? '').trim() || this.niches[0];
    if (!this.niches.includes(niche)) throw bad(`Ниша: одна из ${this.niches.join(', ')}`);
    return {
      slug, name: nameOf(fields.name), niche,
      hours: { days: parseDays(fields.days), ...parseTime(fields.time) },
      replyTo: replyToOf(fields.email),
      operator: operatorOf(fields),
    };
  }

  // Правка из кабинета: пустое поле — прежнее значение; «-» в почте и реквизитах — убрать.
  change(fields = {}, shop) {
    const blank = (v) => !String(v ?? '').trim();
    const hours = shop.hours || { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' };
    return {
      name: blank(fields.name) ? shop.name : nameOf(fields.name),
      hours: {
        days: blank(fields.days) ? hours.days : parseDays(fields.days),
        ...(blank(fields.time) ? { from: hours.from, to: hours.to } : parseTime(fields.time)),
      },
      replyTo: blank(fields.email) ? shop.reply_to : String(fields.email).trim() === '-' ? null : replyToOf(fields.email),
      operator: operatorOf(fields, shop.operator),
    };
  }

  // Почта сотрудника магазина — как её хранит регистрация: без пробелов, строчными.
  staffEmail(raw) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) throw bad(`Почта сотрудника: «${String(raw ?? '').trim()}» не похоже на адрес`);
    return email;
  }
}

module.exports = { ShopForm, parseDays, parseTime, hoursText };
