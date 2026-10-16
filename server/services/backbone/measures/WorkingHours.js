// Рабочее время магазина (docs/backbone-architecture.md §6.6): «ответ в течение часа»
// считается в часах работы, а не по календарю — заявка в 22:00 ждёт до утра честно.
// Пояс магазина — через Intl: локальные часы открытия переводятся в моменты UTC.

const DAY_MS = 24 * 60 * 60 * 1000;

class WorkingHours {
  constructor({ tz = 'Europe/Moscow', days = [1, 2, 3, 4, 5, 6], from = '09:00', to = '19:00' } = {}) {
    this.tz = tz;
    this.days = new Set(days); // ISO: 1 — понедельник … 7 — воскресенье
    this.from = from;
    this.to = to;
    this.fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  }

  // Местная дата момента: { y, m, d }.
  localDate(ms) {
    const p = Object.fromEntries(this.fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
  }

  // Момент UTC для местных даты и времени «чч:мм».
  at({ y, m, d }, hhmm) {
    const [h, mi] = hhmm.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    const p = this.localDate(guess);
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess;
    return guess - offset;
  }

  static weekday({ y, m, d }) {
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  }

  static nextDay({ y, m, d }) {
    const n = new Date(Date.UTC(y, m - 1, d + 1));
    return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() };
  }

  // Минуты рабочего времени между двумя моментами.
  minutes(fromMs, toMs) {
    const a = Number(fromMs);
    const b = Number(toMs);
    if (!(b > a)) return 0;
    let total = 0;
    let day = this.localDate(a);
    for (let i = 0; i < 800; i++) {
      if (this.at(day, '00:00') > b) break;
      if (this.days.has(WorkingHours.weekday(day))) {
        total += Math.max(0, Math.min(b, this.at(day, this.to)) - Math.max(a, this.at(day, this.from)));
      }
      day = WorkingHours.nextDay(day);
    }
    return total / 60000;
  }

  // Понедельник недели момента — ключ недельной таблицы «гггг-мм-дд».
  weekOf(ms) {
    let day = this.localDate(ms);
    for (let back = WorkingHours.weekday(day) - 1; back > 0; back--) {
      const p = new Date(Date.UTC(day.y, day.m - 1, day.d - 1));
      day = { y: p.getUTCFullYear(), m: p.getUTCMonth() + 1, d: p.getUTCDate() };
    }
    return `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
  }
}

module.exports = { WorkingHours, DAY_MS };
