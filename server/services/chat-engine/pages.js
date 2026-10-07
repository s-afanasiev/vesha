// Спеки страниц chat-engine (docs/ui-components.md §5): служебный экран =
// запись здесь. Открывается /c/page.html?spec=/api/chat-engine/c/pages/<имя>.
// Граница — как у соседних ручек демо: без requireAdmin.
const { Pages } = require('../../components/pages');

module.exports = Pages({
  'leads-board': {
    title: 'Воронка лидов · chat-engine',
    subtitle: 'канбан kanban@1: перетаскивание или кнопки ←/→ на карточке — оба пути через POST /move, правило колонки проверяет воронка',
    blocks: [
      { kind: 'kanban@1', src: '/api/chat-engine/c/leads', poll: 3000 },
    ],
  },
});
