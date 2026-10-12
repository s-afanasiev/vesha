// Компонентные экземпляры «Кому автоматизировать» (docs/ui-components.md §1):
// UI эксперимента — проекции, а не вёрстка. Ниши — table@1 с действиями
// запуска и остановки, прогон — tree@1 над деревом процессов, лиды и продукты —
// table@1 над последним планом. Монтируется в server/routes/automationLeads.js
// под /api/automation-leads/c, целиком за requireAdmin.

const { Components } = require('../../components');
const { Table } = require('../../components/table');
const { Tree } = require('../../components/tree');
const { scans, tree } = require('./index');

module.exports = Components({
  'niches': Table({
    rows: () => scans.nicheRows(),
    idKey: 'slug',
    columns: [
      { key: 'title', name: 'Ниша' },
      { key: 'city', name: 'Город' },
      { key: 'state', name: 'Состояние' },
      { key: 'places', name: 'Мест', type: 'num' },
      { key: 'leads', name: 'Лидов', type: 'num' },
      { key: 'strong', name: 'Со сбоем', type: 'num' },
      { key: 'at', name: 'Разобрана' },
    ],
    actions: [
      { id: 'scan', name: 'Разобрать', bulk: true, max: 1, run: ({ ids }) => scans.start(ids[0]) },
      { id: 'stop', name: 'Остановить', bulk: true, max: 1, run: ({ ids }) => scans.stop(ids[0]) },
    ],
  }),

  'scans': Tree({
    store: tree,
    title: 'Прогоны',
    labels: {
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
    rows: () => scans.leadRows(),
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
    rows: () => scans.productRows(),
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
