const express = require('express');
const { publicStatus } = require('../services/llm');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicStatus());
});

module.exports = router;
