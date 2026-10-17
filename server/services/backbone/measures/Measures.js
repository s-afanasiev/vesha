// Замеры из журнала (docs/backbone-architecture.md §6.6, О19, О21): отдельных
// счётчиков нет — каждая метрика читается из событий магазина. Заявка — карточка
// из её событий: принята, первый ответ клиенту, черновик, правки, счёт, исход.
//
// Ответ клиенту — первый из: счёт отправлен (invoice_sent) или перенос в колонку
// типа «ждём клиента», «готово», «отказ»; квитанции шага 4 добавятся сюда же.
// Минуты менеджера — активное время над черновиком: правки, выгрузка, отправка
// счёта; паузы длиннее sessionGap не считаются (событие «открыл черновик» — с витриной).
// Режим заявки — тот, что был у магазина в момент приёма (тень — база «до»).
// Ассистент (шаг 5) — вопросы в чате: ответил сам или ждали менеджера (поток chat).

const { DAY_MS } = require('./WorkingHours');

const REPLY_TYPES = new Set(['waiting_client', 'done', 'refused']);
const WORK_TYPES = new Set(['reviewed', 'invoice_exported', 'invoice_sent']);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const share = (part, whole) => (whole ? part / whole : null);
const ms = (at) => new Date(at).getTime(); // pg отдаёт Date, двойник — строку ISO

class Measures {
  constructor(hours, { replyWithin = 60, silence = { inbox: 60, waitingClientDays: 2 }, sessionGap = 10, b2bLines = 5 } = {}) {
    this.hours = hours;
    this.replyWithin = replyWithin;       // минут рабочего времени — обещание клиенту
    this.silence = silence;               // входящие — минут рабочего времени; ждём клиента — дней
    this.sessionGap = sessionGap;         // минут: дольше — менеджер отвлёкся
    this.b2bLines = b2bLines;             // список от стольких строк — B2B-заявка
  }

  // Режим магазина в момент t — по событиям mode_changed; без смен — нынешний.
  static modeAt(changes, t, current) {
    let mode = changes.length ? changes[0].data.from : current;
    for (const c of changes) if (ms(c.at) <= t) mode = c.data.to;
    return mode;
  }

  // События магазина (по порядку) → карточки заявок.
  cards(events, { mode }) {
    const changes = events.filter((e) => e.type === 'mode_changed');
    const byOrder = new Map();
    for (const e of events) {
      if (e.stream !== 'order') continue;
      const t = ms(e.at);
      let card = byOrder.get(e.subject_id);
      if (e.type === 'received') {
        card = {
          id: e.subject_id, number: e.data.number, receivedAt: t, org: !!e.data.org,
          mode: Measures.modeAt(changes, t, mode), type: e.data.columnType || 'inbox', typeSince: t,
          firstReplyAt: null, invoiceAt: null, invoice: null, draft: null, edited: new Set(), work: [],
        };
        byOrder.set(e.subject_id, card);
        continue;
      }
      if (!card) continue;
      if (e.type === 'moved') {
        card.type = e.data.toType;
        card.typeSince = t;
        if (REPLY_TYPES.has(e.data.toType) && card.firstReplyAt == null) card.firstReplyAt = t;
      }
      if (e.type === 'draft_ready' && card.invoiceAt == null) {
        card.draft = e.data;
        card.edited = new Set();
        card.work = [];
      }
      if (e.type === 'reviewed' && (e.data.verdict === 'edited' || e.data.verdict === 'replaced')) card.edited.add(e.data.line);
      if (WORK_TYPES.has(e.type) && card.invoiceAt == null) card.work.push(t);
      if (e.type === 'invoice_sent' && card.invoiceAt == null) {
        card.invoiceAt = t;
        card.invoice = e.data;
        if (card.firstReplyAt == null) card.firstReplyAt = t;
      }
    }
    return [...byOrder.values()];
  }

  // Активные минуты менеджера: серии действий с паузами не длиннее sessionGap, минута на серию.
  activeMinutes(times) {
    if (!times.length) return null;
    const s = [...times].sort((a, b) => a - b);
    let total = 0;
    let start = s[0];
    for (let i = 1; i <= s.length; i++) {
      if (i === s.length || s[i] - s[i - 1] > this.sessionGap * 60000) {
        total += (s[i - 1] - start) / 60000 + 1;
        start = s[i];
      }
    }
    return total;
  }

  // Метрики группы заявок (§6.6).
  metrics(cards, now) {
    const replied = cards.filter((c) => c.firstReplyAt != null);
    const due = cards.filter((c) => c.firstReplyAt != null || this.hours.minutes(c.receivedAt, now) > this.replyWithin);
    const inTime = due.filter((c) => c.firstReplyAt != null && this.hours.minutes(c.receivedAt, c.firstReplyAt) <= this.replyWithin);
    const invoiced = cards.filter((c) => c.invoiceAt != null);
    const accuracy = (mode) => {
      const list = invoiced.filter((c) => c.invoice.mode === mode && c.invoice.base > 0);
      const right = list.reduce((s, c) => s + c.invoice.right, 0);
      const base = list.reduce((s, c) => s + c.invoice.base, 0);
      return { value: share(right, base), right, base, orders: list.length };
    };
    const drafted = cards.filter((c) => c.draft);
    const lines = drafted.reduce((s, c) => s + c.draft.lines, 0);
    const won = cards.filter((c) => c.type === 'done').length;
    const lost = cards.filter((c) => c.type === 'refused').length;
    return {
      orders: cards.length,
      replyWithinHour: share(inTime.length, due.length),
      replyMinutes: median(replied.map((c) => this.hours.minutes(c.receivedAt, c.firstReplyAt))),
      invoiceMinutes: median(invoiced.map((c) => this.hours.minutes(c.receivedAt, c.invoiceAt))),
      managerMinutes: median(invoiced.filter((c) => c.invoice.mode === 'help').map((c) => this.activeMinutes(c.work)).filter((x) => x != null)),
      shadowAccuracy: accuracy('shadow'),
      untouched: accuracy('help'),
      missingShare: share(drafted.reduce((s, c) => s + c.draft.missing, 0), lines),
      questionShare: share(drafted.reduce((s, c) => s + c.draft.questions, 0), lines),
      conversion: { value: share(won, won + lost), won, lost },
      b2b: share(cards.filter((c) => c.org || (c.draft && c.draft.lines >= this.b2bLines)).length, cards.length),
    };
  }

  // Ассистент без менеджера (шаг 5): вопросы в чате, на которые ассистент ответил сам,
  // против ждавших менеджера; режим — тот, что был у магазина в момент вопроса.
  assistant(events, { mode }) {
    const changes = events.filter((e) => e.type === 'mode_changed');
    const out = { shadow: { auto: 0, manager: 0 }, help: { auto: 0, manager: 0 } };
    for (const e of events) {
      if (e.stream !== 'chat') continue;
      const kind = { assistant_answered: 'auto', assistant_deferred: 'manager' }[e.type];
      if (!kind) continue;
      (out[Measures.modeAt(changes, ms(e.at), mode)] || out.help)[kind] += 1;
    }
    for (const v of Object.values(out)) v.share = share(v.auto, v.auto + v.manager);
    return out;
  }

  // Тишина сейчас: заявки дольше срока в своём типе колонки.
  silent(cards, now) {
    const inbox = cards.filter((c) => c.type === 'inbox' && this.hours.minutes(c.typeSince, now) > this.silence.inbox);
    const waiting = cards.filter((c) => c.type === 'waiting_client' && now - c.typeSince > this.silence.waitingClientDays * DAY_MS);
    return { inbox: inbox.map((c) => c.number), waitingClient: waiting.map((c) => c.number) };
  }

  // Отчёт магазина: «до» (тень) и «после» (помощь), недели, тишина.
  report(events, { now, mode }) {
    const cards = this.cards(events, { mode });
    const weeks = new Map();
    for (const c of cards) {
      const key = this.hours.weekOf(c.receivedAt);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(c);
    }
    return {
      cards,
      before: this.metrics(cards.filter((c) => c.mode === 'shadow'), now),
      after: this.metrics(cards.filter((c) => c.mode === 'help'), now),
      weeks: [...weeks.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([week, list]) => ({
        week,
        modes: [...new Set(list.map((c) => c.mode))],
        ...this.metrics(list, now),
      })),
      silence: this.silent(cards, now),
      assistant: this.assistant(events, { mode }),
    };
  }
}

module.exports = { Measures };
