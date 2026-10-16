// Спеки страниц костяка (docs/ui-components.md §5): служебный экран = запись здесь.
// Открывается /experiments/backbone/ (boot@1) или /c/page.html?spec=/api/backbone/c/pages/<имя>.
const { Pages } = require('../../components/pages');

module.exports = Pages({
  'main': {
    title: 'Костяк · доска заявок',
    subtitle: 'Шаг 1 MVP: заявка вручную, перенос по колонкам, конструктор колонок со смысловыми типами — и каждое действие в журнале',
    blocks: [
      { kind: 'kanban@1', src: '/api/backbone/c/board', poll: 4000, title: 'Доска демо-магазина' },
      { kind: 'table@1', src: '/api/backbone/c/journal', poll: 4000, title: 'Журнал событий' },
      { kind: 'table@1', src: '/api/backbone/c/catalog', title: 'Каталог — фикстура на 300 позиций' },
    ],
  },
});
