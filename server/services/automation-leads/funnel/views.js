// Проекции воронки лидов (П25, П40): карточка доски, подробности, журнал словами
// и путь одного лида по шагам (stages@1). Ничего не пишут: читают лид, колонки
// и журнал. Время человеку — по Москве, перевод только здесь, на границе (П41).

const MOSCOW = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
const TYPE_NAMES = { inbox: 'входящие', working: 'в работе', waiting_client: 'ждём клиента', done: 'готово', refused: 'отказ' };
const CAUSES = {
  scan: 'разбор', manual: 'вручную', board: 'доска', column_removed: 'колонку удалили',
  configure: 'конструктор', template: 'шаблон',
};

const iso = (v) => (v ? new Date(v).toISOString() : null);
const when = (v) => (v ? MOSCOW.format(new Date(v)) : '');
const day = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');

function offerTitle(lead) {
  const offer = (lead.evidence.offers || []).find((o) => o.id === lead.offer);
  return offer ? offer.title : lead.offer;
}

// Названия колонок по id: текущие, а удалённая — из события удаления.
function titlesOf(columns, boardEvents = []) {
  const titles = new Map();
  for (const e of boardEvents) {
    if (e.type === 'column_removed') titles.set(e.data.column, e.data.title);
  }
  for (const c of columns) titles.set(c.id, c.title);
  return titles;
}

// Карточка — снимок: бейджи — доменные факты, рендерер знает только вид.
function card(lead, path) {
  const e = lead.evidence;
  const badges = [];
  if (lead.do_not_contact) badges.push({ text: 'не беспокоить', kind: 'bad' });
  if (e.strength === 'strong') badges.push({ text: 'сбой в отзывах', kind: 'draft' });
  badges.push({ text: `балл ${e.score}` });
  if (lead.until) {
    badges.push(path.overdue(lead) ? { text: `срок вышел ${day(lead.until)}`, kind: 'waiting' } : { text: `ждём до ${day(lead.until)}` });
  }
  return {
    id: lead.id,
    column: lead.column_id,
    title: lead.company.name,
    snippet: `${offerTitle(lead)} — ${e.reason}`,
    created_at: iso(lead.created_at),
    badges,
  };
}

// Порядок в колонке: вышедший срок — первым (выход по сроку), потом сбой, потом балл.
function sortCards(leads, path) {
  const rank = (l) => [path.overdue(l) ? 0 : 1, l.evidence.strength === 'strong' ? 0 : 1, -(l.evidence.score || 0)];
  return [...leads].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || String(a.created_at).localeCompare(String(b.created_at));
  });
}

function siteHref(site) {
  if (!site) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

function facts(lead, path) {
  const e = lead.evidence;
  const c = lead.company;
  const others = (e.offers || []).filter((o) => o.id !== lead.offer);
  return [
    { label: 'Предложить', value: offerTitle(lead) },
    { label: 'Почему', value: e.reason },
    e.failures && { label: 'Сбои из отзывов', value: e.failures },
    e.quote && { label: 'Цитата', value: e.quote },
    e.gaps && { label: 'Цифровые пробелы', value: e.gaps },
    others.length && { label: 'Ещё предложить', value: others.map((o) => `${o.title}${o.strong ? ' (довод в отзывах)' : ''}`).join(', ') },
    { label: 'Балл', value: `${e.score}: боль ${e.pain} · пробел ${e.gapScore} · досягаемость ${e.reach}` },
    c.phone && { label: 'Телефон', value: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, '')}` },
    c.site && { label: 'Сайт', value: c.site.replace(/^https?:\/\//i, '').replace(/\/$/, ''), href: siteHref(c.site) },
    c.address && { label: 'Адрес', value: c.address },
    lead.until && { label: 'Ждём до', value: `${day(lead.until)}${path.overdue(lead) ? ' — срок вышел' : ''}` },
    lead.reason && { label: 'Причина отказа', value: lead.reason },
    lead.do_not_contact && { label: 'Не беспокоить', value: lead.do_not_contact },
    { label: 'Найден', value: `${when(lead.created_at)} · ниша ${lead.niche}` },
    lead.seen_at && { label: 'Последний разбор', value: when(lead.seen_at) },
    { label: 'Окно статуса', value: 'открыть отдельно', href: `/experiments/automation-leads/?page=lead&lead=${lead.id}` },
  ].filter(Boolean);
}

// Событие журнала — строкой для человека.
function describe(e, titles) {
  const d = e.data || {};
  const col = (id) => (id ? `«${titles.get(id) || id}»` : '—');
  const who = d.company ? `${d.company}: ` : '';
  switch (e.type) {
    case 'board_created': return `воронка создана из шаблона: ${(d.columns || []).length} колонок`;
    case 'found': return `${who}найден разбором — предложить «${d.offerTitle || d.offer}», балл ${d.score}`;
    case 'moved': return `${who}${col(d.from)} → ${col(d.to)}${d.reason ? ` · причина: ${d.reason}` : ''}${d.until ? ` · ждём до ${day(d.until)}` : ''}`;
    case 'do_not_contact': return `${who}не беспокоить — ${d.reason}; ${col(d.from)} → ${col(d.to)}`;
    case 'contact_allowed': return `${who}запрет снят — ${d.reason}`;
    case 'noted': return `${who}заметка — ${d.text}`;
    case 'evidence_changed': return `${who}разбор обновил доводы, балл ${d.from} → ${d.to}`;
    case 'column_added': return `колонка ${col(d.column)} добавлена, тип «${TYPE_NAMES[d.columnType] || d.columnType}»`;
    case 'column_renamed': return `колонка «${d.from}» переименована в «${d.to}»`;
    case 'column_retyped': return `колонка ${col(d.column)}: тип «${TYPE_NAMES[d.from] || d.from}» → «${TYPE_NAMES[d.to] || d.to}»`;
    case 'column_moved': return `колонка ${col(d.column)} переставлена: ${d.from + 1} → ${d.to + 1}`;
    case 'column_recolored': return `колонка ${col(d.column)}: цвет ${d.to || 'по умолчанию'}`;
    case 'column_limited': return `колонка ${col(d.column)}: лимит ${d.to || 'снят'}`;
    case 'column_removed': return `колонка «${d.title}» удалена${d.cards ? `, ${d.cards} карт. → ${col(d.moveTo)}` : ''}`;
    default: return e.type;
  }
}

function journalRow(e, titles) {
  return { id: String(e.id), at: iso(e.at), what: describe(e, titles), actor: e.actor, why: CAUSES[e.cause] || e.cause };
}

// Путь одного лида по шагам — stages@1 над тем же журналом, что и доска.
// Пройдено — из журнала (found и переносы, по времени); сейчас — колонка лида
// (истина у лида); впереди — колонки главного пути после текущей до первой
// колонки «готово», без колонок отказа. Отказ и «не беспокоить» — выход с причиной.
function pathSteps({ lead, columns, events, titles, path, keep = 7 }) {
  const current = columns.find((c) => c.id === lead.column_id);
  const visits = [];
  for (const e of events) {
    if (e.type === 'found') visits.push({ column: e.data.column, at: iso(e.at) });
    if ((e.type === 'moved' || e.type === 'do_not_contact') && e.data.to) visits.push({ column: e.data.to, at: iso(e.at) });
  }
  const last = visits[visits.length - 1];
  if (!last || last.column !== lead.column_id) visits.push({ column: lead.column_id, at: iso(lead.updated_at) });
  const now = visits[visits.length - 1];

  let passed = visits.slice(0, -1).map((v) => ({ name: titles.get(v.column) || v.column, state: 'done', at: v.at }));
  if (passed.length > keep) {
    passed = [passed[0], { name: `… ещё ${passed.length - keep}`, state: 'done' }, ...passed.slice(-(keep - 1))];
  }
  const steps = [...passed];
  let exit = null;
  if (lead.do_not_contact) {
    exit = { name: 'Не беспокоить', tone: 'refused', reason: lead.do_not_contact, at: now.at };
  } else if (current && current.type === 'refused') {
    exit = { name: current.title, tone: 'refused', reason: lead.reason, at: now.at };
  } else {
    const wait = current && current.type === 'waiting_client' && lead.until
      ? (path.overdue(lead) ? `срок вышел ${day(lead.until)}` : `ждём до ${day(lead.until)}`)
      : null;
    steps.push({ name: titles.get(lead.column_id) || lead.column_id, state: 'current', at: now.at, ...(wait ? { note: wait } : {}) });
    if (current && current.type !== 'done') {
      for (const c of columns.slice(columns.indexOf(current) + 1)) {
        if (c.type === 'refused') continue;
        steps.push({ name: c.title, state: 'next' });
        if (c.type === 'done') break;
      }
    }
  }
  return {
    title: lead.company.name,
    subtitle: `${offerTitle(lead)} · ${lead.evidence.verdict || ''}`.replace(/ · $/, ''),
    steps,
    exit,
    updatedAt: iso(lead.updated_at),
  };
}

module.exports = { card, sortCards, facts, describe, journalRow, pathSteps, titlesOf, offerTitle, CAUSES };
