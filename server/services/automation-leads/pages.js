// Спека главной страницы эксперимента (docs/ui-components.md §5): страница —
// данные, а не HTML. public/experiments/automation-leads/ только монтирует её
// через boot@1; новый экран — запись здесь.

const { Pages } = require('../../components/pages');

const BASE = '/api/automation-leads/c';

module.exports = Pages({
  'main': {
    title: 'Кому автоматизировать',
    subtitle: 'места ниши → карточка, сайт и свежие отзывы → кому предложить сайт с каталогом, умного ассистента или канбан-воронку и почему',
    blocks: [
      { kind: 'table@1', src: `${BASE}/niches`, poll: 2000, title: 'Ниши — выберите строку и нажмите «Разобрать»' },
      { kind: 'table@1', src: `${BASE}/leads`, poll: 3000, title: 'Лиды' },
      { kind: 'table@1', src: `${BASE}/products`, poll: 3000, title: 'Продукты: скольким местам и с какими доводами' },
      { kind: 'tree@1', src: `${BASE}/scans`, poll: 1000, title: 'Прогон: что реально произошло' },
    ],
  },
});
