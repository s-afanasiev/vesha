// Точка сборки компонентных экземпляров костяка (docs/ui-components.md §1).
// Данные и правила — только через дверь BackboneDesk (П28): колонки доски — от
// источника при каждом запросе, перенос — desk.moveOrder, конструктор — desk.configure,
// новая заявка — desk.createOrder. Журнал и каталог — таблицы table@1.
// Шаг 2 — экран черновика: заявки с кнопкой «Разобрать» (desk.parseOrder), строки
// черновиков с правкой менеджера (desk.review) и синонимы магазина.
// Монтируется в server/routes/backbone.js под /api/backbone/c (за requireAdmin).

const { Components } = require('../../components');
const { Kanban } = require('../../components/kanban');
const { Table } = require('../../components/table');
const { backboneDesk, board, catalog, demoRequest, DEMO_SHOP } = require('./index');
const { TYPE_NAMES } = require('./board/Board');

const actorOf = (user) => (user && (user.email || user.id)) || 'admin';

// Событие журнала — строкой для человека; колонки — по текущим названиям,
// удалённая колонка остаётся своим id.
function describe(e, titles) {
  const d = e.data || {};
  const col = (id) => (id ? `«${titles.get(id) || id}»` : '—');
  switch (e.type) {
    case 'board_created': return `доска создана из шаблона «${d.niche}»: ${(d.columns || []).length} колонок`;
    case 'received': return `заявка №${d.number} принята в ${col(d.column)}`;
    case 'moved': return `заявка №${d.number}: ${col(d.from)} → ${col(d.to)}${e.cause === 'column_removed' ? ' (колонку удалили)' : ''}`;
    case 'column_added': return `колонка ${col(d.column)} добавлена, тип «${TYPE_NAMES[d.columnType] || d.columnType}»`;
    case 'column_renamed': return `колонка «${d.from}» переименована в «${d.to}»`;
    case 'column_retyped': return `колонка ${col(d.column)}: тип «${TYPE_NAMES[d.from] || d.from}» → «${TYPE_NAMES[d.to] || d.to}»`;
    case 'column_moved': return `колонка ${col(d.column)} переставлена: ${d.from + 1} → ${d.to + 1}`;
    case 'column_recolored': return `колонка ${col(d.column)}: цвет ${d.to || 'по умолчанию'}`;
    case 'column_limited': return `колонка ${col(d.column)}: лимит ${d.to || 'снят'}`;
    case 'column_removed': return `колонка «${d.title}» удалена${d.cards ? `, ${d.cards} карт. → ${col(d.moveTo)}` : ''}`;
    case 'parsed': return `заявка №${d.number} разобрана: ${d.lines} строк (правила ${d.rule}, модель ${d.model}${d.raw ? `, не разобрано ${d.raw}` : ''}${d.verify ? `, проверить ${d.verify}` : ''})${(d.failures || []).length ? ` · ${d.failures.join(', ')}` : ''}`;
    case 'draft_ready': return `черновик №${d.number}: ${d.accepted} принято, ${d.ask} выбрать, ${d.missing} нет в каталоге, ${d.questions} вопросов · ${money(d.sum)} ₽`;
    case 'parse_failed': return `заявка №${d.number} не разобрана: ${d.reason}`;
    case 'reviewed': return `черновик №${d.number}, строка ${d.line}: ${VERDICTS[d.verdict] || d.verdict}${d.verdict === 'replaced' ? ` ${d.from || '—'} → ${d.to}` : ''}${d.verdict === 'edited' ? ` ${d.from ?? '—'} → ${d.to}` : ''}${d.synonym ? ` · синоним «${d.synonym}»` : ''}`;
    default: return e.type;
  }
}

const VERDICTS = { accepted: 'принята', replaced: 'позиция заменена', edited: 'количество' };
const STATES = { accepted: '✓ принято', ask: '? выбрать', missing: '✗ нет в каталоге' };
const ORIGINS = { rule: 'правило', model: 'модель', raw: 'не разобрано' };
const money = (n) => (n == null ? '' : Number(n).toFixed(2));
const amount = (n, unit) => (n == null ? null : `${String(n).replace('.', ',')} ${unit || ''}`.trim());
const itemName = (sku) => {
  const item = sku && catalog.bySku(sku);
  return item ? `${sku} · ${item.name}` : sku || null;
};

// Последний исход разбора заявки — словами.
function statusOf(d) {
  const e = d.outcome;
  if (e && e.type === 'parse_failed') return `отказ: ${e.data.reason}${d.lines ? ' (черновик прежний)' : ''}`;
  if (d.lines) return d.reviewed ? `черновик, правок ${d.reviewed}` : 'черновик';
  return 'не разобрана';
}

module.exports = Components({
  'board': Kanban({
    columns: () => backboneDesk.columns(DEMO_SHOP),
    columnKey: 'column',
    card: { title: 'title', snippet: 'snippet', time: 'created_at' },
    cards: async () => {
      const drafts = new Map((await backboneDesk.drafts(DEMO_SHOP)).map((d) => [d.order.id, d]));
      return (await backboneDesk.orders(DEMO_SHOP)).map((o) => {
        const d = drafts.get(o.id);
        const badges = o.contact && o.text ? [{ text: o.contact }] : [];
        if (d && d.lines) badges.push({ text: `черновик ${d.accepted}/${d.lines}`, kind: 'draft' });
        if (d && d.questions) badges.push({ text: `вопросов ${d.questions}`, kind: 'waiting' });
        return { id: o.id, column: o.column_id, title: `№${o.number} · ${o.client}`, snippet: o.text || o.contact, created_at: o.created_at, badges };
      });
    },
    move: ({ cardId, to, user }) => backboneDesk.moveOrder(DEMO_SHOP, cardId, to, { actor: actorOf(user), cause: 'drag' }),
    create: {
      label: 'Новая заявка',
      fields: [
        { key: 'client', label: 'Клиент', required: true },
        { key: 'contact', label: 'Контакт' },
        { key: 'text', label: 'Что нужно', multiline: true },
      ],
      run: ({ fields, user }) => backboneDesk.createOrder(DEMO_SHOP, fields, actorOf(user)),
    },
    configure: {
      types: board.typeNames(),
      run: ({ op, user }) => backboneDesk.configure(DEMO_SHOP, op, actorOf(user)),
    },
  }),

  'journal': Table({
    rows: async () => {
      const [events, columns] = await Promise.all([backboneDesk.journalOf(DEMO_SHOP, { limit: 300 }), backboneDesk.columns(DEMO_SHOP)]);
      const titles = new Map(columns.map((c) => [c.id, c.title]));
      // удалённая колонка — по названию из события удаления
      for (const e of events) {
        if (e.type === 'column_removed' && !titles.has(e.data.column)) titles.set(e.data.column, e.data.title);
      }
      return events.map((e) => ({
        id: String(e.id),
        at: new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        stream: e.stream === 'order' ? 'заявка' : 'доска',
        what: describe(e, titles),
        actor: e.actor,
        cause: e.cause,
      }));
    },
    idKey: 'id',
    columns: [
      { key: 'id', name: '№', type: 'num', sortable: true },
      { key: 'at', name: 'Когда' },
      { key: 'stream', name: 'Поток', sortable: true },
      { key: 'what', name: 'Событие' },
      { key: 'actor', name: 'Кто' },
      { key: 'cause', name: 'Почему' },
    ],
    search: ['what', 'actor', 'stream'],
  }),

  // ---------- шаг 2: экран черновика ----------

  'drafts': Table({
    rows: async () => (await backboneDesk.drafts(DEMO_SHOP)).map((d) => {
      const has = d.lines > 0;
      return {
        id: d.order.id,
        number: d.order.number,
        client: d.order.client,
        status: statusOf(d),
        lines: has ? d.lines : null,
        accepted: has ? d.accepted : null,
        ask: has ? d.ask : null,
        missing: has ? d.missing : null,
        questions: has ? d.questions : null,
        reviewed: has ? d.reviewed : null,
        sum: has ? d.sum : null,
      };
    }),
    idKey: 'id',
    columns: [
      { key: 'number', name: '№', type: 'num', sortable: true },
      { key: 'client', name: 'Клиент', sortable: true },
      { key: 'status', name: 'Разбор' },
      { key: 'lines', name: 'Строк', type: 'num', sortable: true },
      { key: 'accepted', name: 'Принято', type: 'num' },
      { key: 'ask', name: 'Выбрать', type: 'num' },
      { key: 'missing', name: 'Нет в каталоге', type: 'num' },
      { key: 'questions', name: 'Вопросов', type: 'num' },
      { key: 'reviewed', name: 'Правок', type: 'num' },
      { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
    ],
    search: ['client', 'status'],
    actions: [
      {
        id: 'parse', name: 'Разобрать', bulk: true, max: 5,
        run: async ({ ids, user }) => {
          const done = [];
          for (const id of ids) {
            try {
              const r = await backboneDesk.parseOrder(DEMO_SHOP, id, { actor: actorOf(user), user });
              const notes = (r.failures || []).map((f) => f.detail).join('; ');
              done.push(r.ok ? `№${r.number}: ${r.summary}${notes ? ` (${notes})` : ''}` : `№${r.number}: ${r.message}`);
            } catch (err) {
              done.push(String(err.message || err));
            }
          }
          return { message: done.join(' · ') };
        },
      },
      {
        id: 'demo', name: 'Демо-заявка на 20 строк',
        run: async ({ user }) => {
          const order = await backboneDesk.createOrder(DEMO_SHOP, {
            client: 'ООО «СтройМонтаж» (демо)', contact: 'snab@example.ru', text: demoRequest(),
          }, actorOf(user));
          return { message: `Заявка №${order.number} создана — отметьте её и нажмите «Разобрать»` };
        },
      },
    ],
  }),

  'lines': Table({
    rows: async () => (await backboneDesk.draftLines(DEMO_SHOP)).map((l) => {
      const item = l.sku ? catalog.bySku(l.sku) : null;
      return {
        id: l.id,
        order: l.number,
        orderTag: `№${l.number}`,
        pos: l.position,
        source: l.source,
        item: itemName(l.sku),
        confidence: l.confidence,
        stateId: l.state,
        state: `${STATES[l.state]}${l.review ? ' · менеджер' : ''}`,
        candidates: l.state === 'accepted' ? null
          : l.candidates.map((c, i) => `${i + 1}) ${c.sku} ${String(c.score).replace('.', ',')}`).join(' · ') || null,
        want: amount(l.qty, l.unit),
        invoice: amount(l.invoice_qty, item && item.unit),
        price: l.price,
        sum: l.invoice_qty != null && l.price != null ? Math.round(l.invoice_qty * l.price * 100) / 100 : null,
        question: l.question,
        origin: `${ORIGINS[l.origin]}${l.verify ? ` · ${l.verify}` : ''}`,
      };
    }),
    idKey: 'id',
    columns: [
      { key: 'order', name: 'Заявка', type: 'num', sortable: true },
      { key: 'pos', name: 'Стр.', type: 'num', sortable: true },
      { key: 'source', name: 'Как написал клиент' },
      { key: 'item', name: 'Позиция' },
      { key: 'confidence', name: 'Уверенность', type: 'num', sortable: true },
      { key: 'state', name: 'Состояние', sortable: true },
      { key: 'candidates', name: 'Кандидаты' },
      { key: 'want', name: 'Просит' },
      { key: 'invoice', name: 'В счёт' },
      { key: 'price', name: 'Цена, ₽', type: 'num' },
      { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
      { key: 'question', name: 'Вопрос клиенту' },
      { key: 'origin', name: 'Кто разобрал' },
    ],
    search: ['orderTag', 'source', 'item', 'state', 'question'],
    select: {
      presets: [
        { id: 'ask', name: 'Все «выбрать»', where: (r) => r.stateId === 'ask' },
        { id: 'missing', name: 'Все «нет в каталоге»', where: (r) => r.stateId === 'missing' },
        { id: 'questions', name: 'С вопросом', where: (r) => !!r.question },
      ],
    },
    actions: [
      {
        id: 'accept', name: 'Принять', bulk: true, max: 200,
        run: async ({ ids, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'accepted' }, actorOf(user));
          return { ...r, message: `Принято строк: ${r.lines}${r.synonyms ? `, новых синонимов: ${r.synonyms}` : ''}` };
        },
      },
      {
        id: 'replace', name: 'Заменить позицию', bulk: true, max: 1,
        fields: [{ key: 'sku', label: 'Артикул или № кандидата', required: true, placeholder: 'SW-3.5x35-YZ или 2' }],
        run: async ({ ids, body, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'replaced', sku: body.sku }, actorOf(user));
          return { ...r, message: 'Позиция заменена — синоним записан: в следующей заявке эта фраза найдётся сама' };
        },
      },
      {
        id: 'qty', name: 'Количество', bulk: true, max: 1,
        fields: [{ key: 'qty', label: 'Сколько в счёт (в единице позиции)', required: true, placeholder: '50' }],
        run: async ({ ids, body, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'edited', qty: body.qty }, actorOf(user));
          return { ...r, message: 'Количество исправлено, упаковка и остаток пересчитаны' };
        },
      },
    ],
  }),

  'synonyms': Table({
    rows: async () => (await backboneDesk.synonymsOf(DEMO_SHOP)).map((s) => ({
      phrase: s.phrase,
      item: itemName(s.sku),
      example: s.example,
      hits: s.hits,
      by: s.created_by,
      at: new Date(s.updated_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
    })),
    idKey: 'phrase',
    columns: [
      { key: 'phrase', name: 'Фраза клиента', sortable: true },
      { key: 'item', name: 'Позиция', sortable: true },
      { key: 'example', name: 'Впервые в строке' },
      { key: 'hits', name: 'Подтверждений', type: 'num', sortable: true },
      { key: 'by', name: 'Кто' },
      { key: 'at', name: 'Когда' },
    ],
    search: ['phrase', 'item', 'example'],
  }),

  'catalog': Table({
    rows: () => catalog.items(),
    idKey: 'sku',
    columns: [
      { key: 'sku', name: 'Артикул', sortable: true },
      { key: 'name', name: 'Наименование', sortable: true },
      { key: 'group', name: 'Группа', sortable: true },
      { key: 'unit', name: 'Ед.' },
      { key: 'pack', name: 'Упак.', type: 'num', sortable: true },
      { key: 'price', name: 'Цена, ₽', type: 'num', sortable: true },
      { key: 'stock', name: 'Остаток', type: 'num', sortable: true },
    ],
    search: ['sku', 'name', 'group'],
  }),
});
