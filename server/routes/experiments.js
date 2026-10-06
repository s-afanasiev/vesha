// Каталог плиток-экспериментов: серверная фильтрация по личности (гость/админ)
// + админское управление видимостью. Истина состава — registry.json, доступа — БД.

const express = require('express');
const experiments = require('../services/experiments');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await experiments.listVisible(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/visibility', experiments.requireAdmin, async (req, res, next) => {
  try {
    const { category, name, visibility } = req.body;
    if (!category || !name) return res.status(400).json({ error: 'нужны category и name' });
    res.json(await experiments.setVisibility(category, name, visibility));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

module.exports = router;
