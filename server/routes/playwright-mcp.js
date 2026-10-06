// Песочница Playwright MCP: тонкий транспорт. Задача выполняется асинхронно,
// UI поллит /state?since=<последний seq> и дописывает новые записи лога.

const express = require('express');
const mcp = require('../services/playwright-mcp');

const router = express.Router();

router.get('/state', (req, res) => {
  res.json(mcp.publicState(req.query.since));
});

router.post('/run', (req, res) => {
  const task = String(req.body.task || '').trim();
  if (!task) return res.status(400).json({ error: 'пустой запрос' });
  mcp.run(task, !!req.body.headless).catch(() => {}); // ошибки уже в логе
  res.json({ ok: true });
});

router.post('/stop', async (req, res, next) => {
  try {
    await mcp.stop();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
