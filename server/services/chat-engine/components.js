// Точка сборки компонентных экземпляров chat-engine (docs/ui-components.md §1).
// Данные и правила — только через дверь территории ChatDesk (П28): карточки
// из chatDesk.board(), перенос этапа — chatDesk.setStage (воронка проверяет
// правило). Монтируется в server/routes/chat-engine.js под /api/chat-engine/c;
// граница та же, что у соседних ручек демо (без requireAdmin).

const { Components } = require('../../components');
const { Kanban } = require('../../components/kanban');
const { chatDesk, funnel } = require('./index');

module.exports = Components({
  'leads': Kanban({
    columns: funnel.snapshot(),
    columnKey: 'stage',
    card: { title: 'visitor_name', snippet: 'last_text', time: 'last_incoming_at' },
    cards: async () => {
      const { dialogues } = await chatDesk.board();
      return dialogues.map((d) => {
        const badges = [];
        if (Number(d.open_drafts) > 0) {
          badges.push({ text: `черновик готов ×${d.open_drafts}`, kind: 'draft' });
        }
        if (d.last_role === 'visitor') badges.push({ text: 'ждёт ответа', kind: 'waiting' });
        if (!badges.length) badges.push({ text: 'ответ отправлен' });
        return { ...d, badges };
      });
    },
    move: async ({ cardId, to, user }) => {
      await chatDesk.setStage(cardId, to, {
        actor: (user && (user.email || user.id)) || 'dashboard',
        cause: 'drag',
      });
      return { cardId, to };
    },
  }),
});
