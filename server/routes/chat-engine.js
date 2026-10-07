// Тонкий транспорт chat-engine (docs/oop-principles.md П9): ручка = делегирование,
// конверт ответа один на все ручки, SQL и LLM здесь не видны.
// LLM-вызов обёрнут в runGuarded (квоты/конкурентность общей платформы).

const express = require('express');
const { runGuarded } = require('../services/llmGuard');
const { chatDesk } = require('../services/chat-engine');

const router = express.Router();

function envelope(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req))
      .then((result) => res.json({ ok: true, result }))
      .catch(next);
  };
}

function actorOf(req) {
  return (req.user && (req.user.email || req.user.id)) || 'guest';
}

// Компонентные экземпляры (docs/ui-components.md): /c/leads — канбан воронки.
// Граница та же, что у соседних ручек демо: страница открытая.
router.use('/c', require('../services/chat-engine/components'));

function visitorKeyOf(req) {
  return req.guest ? String(req.guest.id) : `ip:${req.ip}`;
}

// --- дашборд менеджера ------------------------------------------------------

router.get('/state', envelope(async () => chatDesk.board()));

router.get('/dialogues/:id/messages', envelope(async (req) => chatDesk.history(req.params.id)));

router.post('/dialogues/:id/replies', envelope(async (req) =>
  chatDesk.managerSends(req.params.id, req.body.text, actorOf(req))
));

router.post('/dialogues/:id/draft', envelope(async (req) =>
  runGuarded(req, () => chatDesk.proposeReply(req.params.id, req.body.llm))
));

router.post('/dialogues/:id/stage', envelope(async (req) =>
  chatDesk.setStage(req.params.id, req.body.stage, { actor: actorOf(req) })
));

router.post('/dialogues/:id/card', envelope(async (req) =>
  chatDesk.updateCard(req.params.id, { notes: req.body.notes, visitorName: req.body.visitorName })
));

router.post('/drafts/:id/approve', envelope(async (req) =>
  chatDesk.approveDraft(req.params.id, { text: req.body.text, actor: actorOf(req) })
));

router.post('/drafts/:id/reject', envelope(async (req) =>
  chatDesk.rejectDraft(req.params.id, actorOf(req))
));

router.get('/persona', envelope(async () => ({ value: await chatDesk.persona() })));

router.put('/persona', envelope(async (req) => {
  await chatDesk.savePersona(req.body.value);
  return { value: await chatDesk.persona() };
}));

// --- виджет сайта заказчика (адаптер канала web) -----------------------------

router.post('/widget/messages', envelope(async (req) => {
  const { dialogue, message, duplicate } = await chatDesk.receiveVisitorMessage({
    channel: 'web',
    visitorKey: visitorKeyOf(req),
    visitorName: req.body.name,
    text: req.body.text,
    externalId: req.body.externalId,
  });
  return {
    duplicate: Boolean(duplicate),
    dialogueId: dialogue ? dialogue.id : (message && message.dialogue_id),
  };
}));

router.get('/widget/messages', envelope(async (req) =>
  chatDesk.visitorDialogue({ channel: 'web', visitorKey: visitorKeyOf(req) })
));

module.exports = router;
