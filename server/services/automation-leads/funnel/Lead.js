// Лид — «я × компания × оффер» со своей судьбой (П38, docs/automation-leads-architecture.md,
// «Воронка лида»). Lead отвечает за форму лида из строки плана, LeadPath — за путь
// по колонкам в смысловых типах; хранит лид репозиторий, сценарии — LeadFunnel.
//
// Судьба — именованные выходы, а не тишина:
//   колонка типа refused   — только с причиной (отсеян, не вышло);
//   колонка waiting_client — со сроком «ждём до» или без; срок вышел — бейдж, лид всплывает;
//   «не беспокоить»        — из любой колонки, навсегда: переносы закрыты, назад — руками с причиной.
// Колонка — вид, событие — факт: переход пишется moved(from, to) вместе с типами (как у заявки костяка).

// Шаблон воронки — данные, не код: владелец дальше правит колонки конструктором.
// «Отложен» стоит после «Договорились»: он вне главного пути, окно статуса его не обещает.
const FUNNEL_TEMPLATE = [
  { id: 'found', title: 'Найден', type: 'inbox', color: '#f0a868' },
  { id: 'qualified', title: 'Отобран', type: 'working', color: '#e8c95c' },
  { id: 'pitched', title: 'Предложение отправлено', type: 'waiting_client', color: '#7fb3e0' },
  { id: 'replied', title: 'Ответил', type: 'working', color: '#b39ddb' },
  { id: 'meeting', title: 'Встреча', type: 'working', color: '#9fa8da' },
  { id: 'won', title: 'Договорились', type: 'done', color: '#86c28b' },
  { id: 'parked', title: 'Отложен', type: 'waiting_client', color: '#9fc4e8' },
  { id: 'lost', title: 'Не вышло', type: 'refused', color: '#e08a8a' },
  { id: 'rejected', title: 'Отсеян', type: 'refused', color: '#c9a0a0' },
];

const DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOSCOW_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function text(value, what, max, { required = false } = {}) {
  const out = String(value ?? '').trim();
  if (required && !out) throw bad(`${what}: пусто`);
  if (out.length > max) throw bad(`${what}: не длиннее ${max} символов`);
  return out;
}

class Lead {
  // Строка плана → черновик лида; отказ плана лидом не становится.
  // Оффер — главный продукт строки: сначала с доводом в отзывах; модуль ниши —
  // только если продуктов нет. Остальные продукты — в доводах («ещё предложить»).
  static fromPlan(row, niche) {
    if (!row || !row.strength) return null;
    const detail = row.product_detail || [];
    const ranked = [...detail.filter((p) => !p.hook).sort((a, b) => Number(b.strong) - Number(a.strong)), ...detail.filter((p) => p.hook)];
    const offer = ranked[0];
    if (!offer) return null;
    return {
      niche: niche.slug,
      companyKey: `2gis:${row.id}`,
      company: { name: row.name, address: row.address || '', phone: row.phone || '', site: row.site || '', branchId: String(row.id) },
      offer: offer.id,
      evidence: {
        strength: row.strength,
        verdict: row.verdict,
        reason: row.reason,
        score: row.score,
        pain: row.pain,
        gapScore: row.gap_score,
        reach: row.reach,
        failures: row.failures || '',
        quote: row.quote || '',
        gaps: row.gaps || '',
        offers: ranked.map((p) => ({ id: p.id, title: p.title, strong: !!p.strong, hook: !!p.hook, evidence: p.evidence || [] })),
        branches: row.branches,
        rating: row.rating ?? null,
        reviews: row.reviews_count ?? null,
        fresh: row.fresh ?? null,
        answered: row.answered ?? null,
      },
    };
  }

  // Черновики разбора против того, что уже в воронке (П15: решение отдельно от записи).
  // Компания в воронке — доводы обновляются у всех её лидов, нового не будет:
  // другой оффер той же компании заводит человек. «Не беспокоить» — мимо навсегда.
  static sortOut(drafts, existing) {
    const byCompany = new Map();
    for (const lead of existing) {
      if (!byCompany.has(lead.company_key)) byCompany.set(lead.company_key, []);
      byCompany.get(lead.company_key).push(lead);
    }
    const out = { create: [], refresh: [], blocked: [] };
    for (const draft of drafts) {
      const known = byCompany.get(draft.companyKey) || [];
      if (known.some((l) => l.do_not_contact)) out.blocked.push(draft);
      else if (known.length) for (const lead of known) out.refresh.push({ lead, draft });
      else out.create.push(draft);
    }
    return out;
  }
}

class LeadPath {
  constructor({ maxReason = 200, maxNote = 1000, maxWaitDays = 365, clock = () => new Date() } = {}) {
    this.maxReason = maxReason;
    this.maxNote = maxNote;
    this.maxWaitDays = maxWaitDays;
    this.clock = clock;
  }

  // Что спросить у человека при входе в колонку: правило пути говорит это само,
  // рендерер только показывает поля (колонка из /meta приходит с ask).
  asks(column) {
    if (column.type === 'refused') return [{ key: 'reason', label: 'Причина', required: true }];
    if (column.type === 'waiting_client') return [{ key: 'until', label: 'Ждём до', type: 'date' }];
    return [];
  }

  // → { event, patch } или ошибка с причиной
  transition(lead, fromCol, toCol, fields = {}) {
    if (lead.do_not_contact) throw bad(`Не беспокоить: ${lead.do_not_contact} — сначала снимите запрет с причиной`);
    if (!toCol) throw bad('Нет такой колонки в воронке');
    if (fromCol && fromCol.id === toCol.id) throw bad('Лид уже в этой колонке');
    const patch = { column_id: toCol.id, until: null, reason: null };
    const data = { from: fromCol ? fromCol.id : null, to: toCol.id, fromType: fromCol ? fromCol.type : null, toType: toCol.type };
    if (toCol.type === 'refused') {
      patch.reason = text(fields.reason, 'Причина', this.maxReason, { required: true });
      data.reason = patch.reason;
    }
    if (toCol.type === 'waiting_client' && fields.until) {
      patch.until = this.until(fields.until);
      data.until = patch.until;
    }
    return { event: { type: 'moved', data }, patch };
  }

  // «Не беспокоить»: из любой колонки в первую колонку отказа, навсегда.
  block(lead, fromCol, refusedCol, fields = {}) {
    if (lead.do_not_contact) throw bad('Уже «не беспокоить»');
    if (!refusedCol) throw bad('В воронке нет колонки отказа');
    const reason = text(fields.reason, 'Причина', this.maxReason, { required: true });
    const patch = { column_id: refusedCol.id, until: null, reason, do_not_contact: reason };
    return {
      event: { type: 'do_not_contact', data: { from: fromCol ? fromCol.id : null, to: refusedCol.id, fromType: fromCol ? fromCol.type : null, toType: refusedCol.type, reason } },
      patch,
    };
  }

  // Назад — только руками и с причиной; лид остаётся в своей колонке.
  unblock(lead, fields = {}) {
    if (!lead.do_not_contact) throw bad('Запрета нет');
    const reason = text(fields.reason, 'Причина', this.maxReason, { required: true });
    return { event: { type: 'contact_allowed', data: { reason, was: lead.do_not_contact } }, patch: { do_not_contact: null } };
  }

  note(fields = {}) {
    return { type: 'noted', data: { text: text(fields.text, 'Заметка', this.maxNote, { required: true }) } };
  }

  // Срок ожидания — день по Москве: не раньше сегодня и не дальше maxWaitDays.
  until(value) {
    const day = String(value).trim();
    if (!ISO_DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw bad('Срок — дата в виде ГГГГ-ММ-ДД');
    const today = this.today();
    if (day < today) throw bad('Срок уже прошёл');
    const last = MOSCOW_DAY.format(new Date(this.clock().getTime() + this.maxWaitDays * DAY));
    if (day > last) throw bad(`Срок — не дальше ${this.maxWaitDays} дней`);
    return day;
  }

  today() {
    return MOSCOW_DAY.format(this.clock());
  }

  overdue(lead) {
    return !!lead.until && lead.until < this.today();
  }
}

module.exports = { Lead, LeadPath, FUNNEL_TEMPLATE };
