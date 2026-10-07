// Спеки страниц радара (docs/ui-components.md §5): служебный экран = запись
// здесь, не новый HTML/JS. Открывается /c/page.html?spec=/api/pain-radar/c/pages/<имя>.
// Доступ — вместе со всем /c: admin-only (см. роут).
const { Pages } = require('../../components/pages');

module.exports = Pages({
  'orgs-review': {
    title: 'Обзор организаций · 2ГИС',
    subtitle: 'кандидаты на предложение сайта: сортировка, поиск, пресет «только без сайта» — те же данные, что в пульте, отдельным экраном из спеки',
    blocks: [
      { kind: 'table@1', src: '/api/pain-radar/c/orgs' },
    ],
  },
});
