// Точка сборки компонентных экземпляров костяка (docs/ui-components.md §1).
// Данные и правила — только через дверь BackboneDesk (П28): колонки доски — от
// источника при каждом запросе, перенос — desk.moveOrder, конструктор — desk.configure,
// новая заявка — desk.createOrder. Журнал и каталог — таблицы table@1.
// Монтируется в server/routes/backbone.js под /api/backbone/c (за requireAdmin).

const { Components } = require('../../components');
const { Kanban } = require('../../components/kanban');
const { Table } = require('../../components/table');
const { backboneDesk, board, catalog, DEMO_SHOP } = require('./index');
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
    default: return e.type;
  }
}

module.exports = Components({
  'board': Kanban({
    columns: () => backboneDesk.columns(DEMO_SHOP),
    columnKey: 'column',
    card: { title: 'title', snippet: 'snippet', time: 'created_at' },
    cards: async () => (await backboneDesk.orders(DEMO_SHOP)).map((o) => ({
      id: o.id,
      column: o.column_id,
      title: `№${o.number} · ${o.client}`,
      snippet: o.text || o.contact,
      created_at: o.created_at,
      badges: o.contact && o.text ? [{ text: o.contact }] : [],
    })),
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
