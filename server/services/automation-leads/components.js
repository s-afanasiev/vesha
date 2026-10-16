// Компонентные экземпляры «Кому автоматизировать» (docs/ui-components.md §1):
// UI эксперимента — проекции, а не вёрстка. Ниши — table@1: карта покрытия с
// действиями проверить источник, собрать, разобрать, остановить; прогон — tree@1
// над деревом процессов; лиды и продукты — table@1 над последним планом.
// Воронка — kanban@1 над лидами владельца в Postgres (дверь LeadFunnel): колонки
// с конструктором, подробности, действия и путь лида stages@1 над тем же журналом.
// Монтируется в server/routes/automationLeads.js под /api/automation-leads/c,
// целиком за requireAdmin; инициатор действия — в вехах прогона и в квоте LLM.

const { Components } = require('../../components');
const { Table } = require('../../components/table');
const { Tree } = require('../../components/tree');
const { Kanban } = require('../../components/kanban');
const { Stages } = require('../../components/stages');
const { desk, tree, funnel } = require('./index');
const { LeadFunnel } = require('./funnel/LeadFunnel');
const views = require('./funnel/views');

const BASE = '/api/automation-leads/c';
const owner = (user) => LeadFunnel.ownerOf(user);
const actor = (user) => LeadFunnel.actorOf(user);
const reasonField = [{ key: 'reason', label: 'Причина', required: true }];

module.exports = Components({
  'niches': Table({
    rows: () => desk.nicheRows(),
    idKey: 'slug',
    columns: [
      { key: 'title', name: 'Ниша' },
      { key: 'city', name: 'Город' },
      { key: 'corpus', name: 'Корпус' },
      { key: 'state', name: 'Состояние' },
      { key: 'leads', name: 'Лидов', type: 'num' },
      { key: 'strong', name: 'Со сбоем', type: 'num' },
      { key: 'at', name: 'Разобрана' },
    ],
    actions: [
      { id: 'probe', name: 'Проверить 2ГИС', bulk: true, max: 1, run: ({ ids, user }) => desk.probe(ids[0], { actor: user }) },
      { id: 'collect', name: 'Собрать', bulk: true, max: 1, run: ({ ids, user }) => desk.collect(ids[0], { actor: user }) },
      { id: 'scan', name: 'Разобрать', bulk: true, max: 1, run: ({ ids, user }) => desk.scan(ids[0], { actor: user }) },
      { id: 'stop', name: 'Остановить', bulk: true, max: 1, run: ({ ids }) => desk.stop(ids[0]) },
    ],
  }),

  'scans': Tree({
    store: tree,
    title: 'Прогоны',
    labels: {
      NicheCollect: 'сбор ниши',
      Listing: 'листинг',
      ListingQuery: 'запрос',
      PlaceCorpus: 'место',
      CardPage: 'карточка',
      SitePage: 'сайт',
      FreshReviews: 'отзывы',
      Marking: 'разметка',
      MarkBatch: 'батч',
      CorpusCommit: 'запись',
      SourceProbe: 'проверка источника',
      ProbeListing: 'листинг',
      ProbeFirm: 'карточка',
      ProbeReviews: 'отзывы',
      NicheScan: 'разбор ниши',
      Places: 'листинг',
      EachPlace: 'аудит',
      PlaceAudit: 'место',
      CardFacts: 'карточка',
      SiteFacts: 'сайт',
      ReviewFailures: 'отзывы',
      LeadPlan: 'решение',
      LeadIntake: 'в воронку',
    },
  }),

  'leads': Table({
    rows: () => desk.leadRows(),
    idKey: 'id',
    columns: [
      { key: 'name', name: 'Место', sortable: true },
      { key: 'verdict', name: 'Вердикт', sortable: true },
      { key: 'score', name: 'Балл', type: 'num', sortable: true },
      { key: 'products', name: 'Что предложить' },
      { key: 'hooks', name: 'Модуль ниши' },
      { key: 'failures', name: 'Сбои из отзывов' },
      { key: 'quote', name: 'Цитата' },
      { key: 'gaps', name: 'Цифровые пробелы' },
      { key: 'reason', name: 'Почему' },
      { key: 'phone', name: 'Телефон' },
      { key: 'site', name: 'Сайт', render: 'link', note: 'site_note' },
      { key: 'branches', name: 'Точек', type: 'num', sortable: true },
      { key: 'answered', name: 'Ответов владельца', type: 'num', sortable: true },
      { key: 'address', name: 'Адрес' },
    ],
    search: ['name', 'address', 'products', 'failures', 'gaps', 'verdict'],
    select: {
      presets: [
        { id: 'strong', name: 'Лиды со сбоем', where: (r) => r.strength === 'strong' },
        { id: 'leads', name: 'Все лиды', where: (r) => !!r.strength },
      ],
    },
  }),

  'products': Table({
    rows: () => desk.productRows(),
    idKey: 'key',
    columns: [
      { key: 'title', name: 'Продукт' },
      { key: 'kind', name: 'Вид' },
      { key: 'places', name: 'Мест', type: 'num', sortable: true },
      { key: 'strong', name: 'Довод в отзывах', type: 'num', sortable: true },
      { key: 'weak', name: 'Без довода в отзывах', type: 'num', sortable: true },
      { key: 'evidence', name: 'Доводы' },
      { key: 'example', name: 'Пример' },
      { key: 'pitch', name: 'Что это' },
      { key: 'niche', name: 'Ниша' },
    ],
  }),

  // Воронка лидов — kanban@1 с колонками владельца, подробностями, действиями и
  // окном статуса (stages@1) над тем же журналом.
  'funnel': Kanban({
    columns: ({ user }) => funnel.columns(owner(user)),
    columnKey: 'column',
    card: { title: 'title', snippet: 'snippet', time: 'created_at' },
    cards: async ({ user }) => views.sortCards(await funnel.leads(owner(user)), funnel.path).map((l) => views.card(l, funnel.path)),
    move: ({ cardId, to, fields, user }) => funnel.move(owner(user), cardId, to, fields, { actor: actor(user), cause: 'board' }),
    configure: {
      types: funnel.boardRule.typeNames(),
      run: ({ op, user }) => funnel.configure(owner(user), op, actor(user)),
    },
    details: {
      stages: `${BASE}/lead-path`,
      read: async ({ cardId, user }) => {
        const h = await funnel.history(owner(user), cardId);
        const titles = views.titlesOf(h.columns, h.boardEvents);
        return {
          card: { title: h.lead.company.name, subtitle: views.offerTitle(h.lead) },
          facts: views.facts(h.lead, funnel.path),
          journal: [...h.events].reverse().map((e) => views.journalRow(e, titles)),
          actions: funnel.actionsFor(h.lead),
        };
      },
    },
    actions: [
      { id: 'note', name: 'Заметка', fields: [{ key: 'text', label: 'Что произошло', required: true, multiline: true }],
        run: ({ cardId, fields, user }) => funnel.act(owner(user), cardId, 'note', fields, actor(user)) },
      { id: 'block', name: 'Не беспокоить', fields: reasonField,
        run: ({ cardId, fields, user }) => funnel.act(owner(user), cardId, 'block', fields, actor(user)) },
      { id: 'unblock', name: 'Снять «не беспокоить»', fields: reasonField,
        run: ({ cardId, fields, user }) => funnel.act(owner(user), cardId, 'unblock', fields, actor(user)) },
    ],
  }),

  'lead-path': Stages({
    title: 'Путь лида',
    path: async ({ key, user }) => {
      const h = await funnel.history(owner(user), key);
      return views.pathSteps({ lead: h.lead, columns: h.columns, events: h.events, titles: views.titlesOf(h.columns, h.boardEvents), path: funnel.path });
    },
  }),

  'funnel-journal': Table({
    rows: async ({ user } = {}) => {
      const j = await funnel.journalOf(owner(user), { limit: 300 });
      const titles = views.titlesOf(j.columns, j.boardEvents);
      return j.events.map((e) => {
        const row = views.journalRow(e, titles);
        return { ...row, at: new Date(row.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) };
      });
    },
    idKey: 'id',
    columns: [
      { key: 'id', name: '№', type: 'num', sortable: true },
      { key: 'at', name: 'Когда' },
      { key: 'what', name: 'Событие' },
      { key: 'actor', name: 'Кто' },
      { key: 'why', name: 'Почему' },
    ],
    search: ['what', 'actor'],
  }),
});
