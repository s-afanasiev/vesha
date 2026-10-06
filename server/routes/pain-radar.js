// Пульт сбора сырых данных 2ГИС (pain-radar-scrape): тонкий транспорт над scrape-сервисом.
// Механика (очередь, троттлинг, счётчики, файлы) — server/services/pain-radar/scrape.js.

const express = require('express');
const scrape = require('../services/pain-radar/scrape');
const experiments = require('../services/experiments');

const router = express.Router();

// Пульт — служебная часть радара: данные и управление только для админа.
// Скрытие вкладки в UI — удобство; вот здесь настоящая граница.
router.use('/scrape', experiments.requireAdmin);

router.get('/scrape/state', (_req, res) => {
  res.json(scrape.publicState());
});

router.get('/scrape/jobs/:id', (req, res) => {
  const job = scrape.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'джоба не найдена' });
  res.json(job);
});

router.post('/scrape/config', (req, res) => {
  try {
    const dataDir = scrape.setDataDir(req.body.dataDir);
    res.json({ ok: true, dataDir });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/scrape/pause', (req, res) => {
  res.json({ ok: true, paused: scrape.setPaused(req.body.paused) });
});

router.post('/scrape/rubrics', (req, res) => {
  try {
    res.json({ ok: true, jobId: scrape.startJob('rubrics', { city: req.body.city, dataDir: req.body.dataDir, label: `рубрики ${req.body.city}` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.post('/scrape/subrubrics', (req, res) => {
  try {
    const { city, groupId, dataDir } = req.body;
    if (!groupId) return res.status(400).json({ error: 'нужен groupId' });
    res.json({ ok: true, jobId: scrape.startJob('subrubrics', { city, groupId, dataDir, label: `подрубрики ${groupId}` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.post('/scrape/listing', (req, res) => {
  try {
    const { city, slug, rubricId, maxPages, dataDir } = req.body;
    if (!slug && !rubricId) return res.status(400).json({ error: 'нужен slug или rubricId' });
    res.json({ ok: true, jobId: scrape.startJob('listing', { city, slug, rubricId, maxPages: Math.min(Number(maxPages) || 1, scrape.LIMITS.maxPages), dataDir, label: `организации: ${slug || rubricId}` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.post('/scrape/search', (req, res) => {
  try {
    const { city, query, maxPages, dataDir } = req.body;
    if (!query) return res.status(400).json({ error: 'нужен текст запроса' });
    res.json({ ok: true, jobId: scrape.startJob('search', { city, query, maxPages: Math.min(Number(maxPages) || 1, scrape.LIMITS.maxPages), dataDir, label: `поиск: ${query}` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.post('/scrape/firm', (req, res) => {
  try {
    const { city, branchIds, dataDir } = req.body;
    if (!Array.isArray(branchIds) || !branchIds.length) return res.status(400).json({ error: 'нужен список branchIds' });
    res.json({ ok: true, jobId: scrape.startJob('firmScan', { city, branchIds, dataDir, label: `контакты: ${branchIds.length} орг.` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.post('/scrape/reviews', (req, res) => {
  try {
    const { city, branchIds, maxPerOrg, dataDir } = req.body;
    if (!Array.isArray(branchIds) || !branchIds.length) return res.status(400).json({ error: 'нужен список branchIds' });
    res.json({ ok: true, jobId: scrape.startJob('reviews', { city, branchIds, maxPerOrg: Math.min(Number(maxPerOrg) || scrape.LIMITS.maxReviewsPerOrg, scrape.LIMITS.maxReviewsPerOrg), dataDir, label: `отзывы: ${branchIds.length} орг.` }) });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

router.get('/scrape/orgs', (req, res) => {
  try {
    const file = String(req.query.file || '');
    if (!/^orgs-[\w-]+\.json$/.test(file)) return res.status(400).json({ error: 'плохое имя файла' });
    res.json(scrape.readOrgs(req.query.dataDir, file) || { items: [] });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

module.exports = router;
