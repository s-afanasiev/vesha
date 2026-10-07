// Точка сборки компонентных экземпляров радара (docs/ui-components.md §1).
// Контракты и движок — server/components (каркас), здесь только домен:
// какие данные, колонки, пресеты и действия у таблицы организаций.
// Монтируется в server/routes/pain-radar.js под /api/pain-radar/c, admin-only.

const { Components } = require('../../components');
const { Table } = require('../../components/table');
const scrape = require('./scrape');

function orgRows() {
  const orgs = scrape.latestOrgs();
  if (!orgs) return [];
  // site_note — подсветка «только телефон/соцсети» в колонке «Сайт» (render: link, note)
  return orgs.items.map((o) => ({
    ...o,
    site_note: o.site ? null : (o.site_scanned ? 'только телефон/соцсети' : '—'),
  }));
}

module.exports = Components({
  'orgs': Table({
    rows: orgRows,
    idKey: 'branch_id',
    columns: [
      { key: 'name', name: 'Название', sortable: true },
      { key: 'rating', name: 'Рейтинг', type: 'num', sortable: true },
      { key: 'reviews_count', name: 'Оценок', type: 'num', sortable: true },
      { key: 'site', name: 'Сайт', render: 'link', note: 'site_note' },
      { key: 'address', name: 'Адрес', sortable: true },
    ],
    search: ['name', 'address'],
    select: {
      presets: [
        { id: 'nosite', name: 'Только без сайта', where: (r) => r.site_scanned && !r.site },
      ],
    },
    actions: [
      {
        id: 'scan-sites',
        name: 'Скан контактов (сайт/телефон)',
        bulk: true,
        max: scrape.LIMITS.maxOrgsPerJob,
        run: async ({ ids }) => {
          const orgs = scrape.latestOrgs();
          const jobId = scrape.startJob('firmScan', {
            city: (orgs && orgs.city) || 'kursk',
            branchIds: ids,
            label: `контакты: ${ids.length} орг.`,
          });
          return { jobId };
        },
      },
    ],
  }),
});
