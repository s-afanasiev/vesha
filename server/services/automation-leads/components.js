// Компонентные экземпляры «Кому автоматизировать» (docs/ui-components.md §1):
// UI эксперимента — проекции, а не вёрстка. Ниши — table@1: карта покрытия с
// действиями проверить источник, собрать, разобрать, остановить; прогон — tree@1
// над деревом процессов; лиды и продукты — table@1 над последним планом.
// Монтируется в server/routes/automationLeads.js под /api/automation-leads/c,
// целиком за requireAdmin; инициатор действия — в вехах прогона и в квоте LLM.

const { Components } = require('../../components');
const { Table } = require('../../components/table');
const { Tree } = require('../../components/tree');
const { desk, tree } = require('./index');

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
});
