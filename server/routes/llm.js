const express = require('express');
const { publicStatus, checkBalance } = require('../services/llm');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicStatus());
});

// Баланс OpenAI-совместимого сервиса по ключу из llm-picker. Ключ живёт только в
// памяти страницы и приходит как override — на сервере не сохраняется.
router.post('/balance', async (req, res) => {
  res.json(await checkBalance(req.body && req.body.llm));
});

module.exports = router;
