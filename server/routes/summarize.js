const express = require('express');
const path = require('path');
const fs = require('fs');
const { getToolStatus } = require('../services/mediaBins');
const {
  extractAudioFromUrl,
  readMeta,
  jobDir,
  publicJob,
} = require('../services/extractAudio');

const router = express.Router();

router.get('/tools', async (_req, res, next) => {
  try {
    res.json(await getToolStatus());
  } catch (err) {
    next(err);
  }
});

router.post('/from-url', async (req, res, next) => {
  req.setTimeout(12 * 60 * 1000);
  res.setTimeout(12 * 60 * 1000);
  try {
    const meta = await extractAudioFromUrl(req.body && req.body.url);
    res.json(publicJob(meta));
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(publicJob(meta));
});

router.get('/jobs/:id/audio', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta || meta.status !== 'ready') {
    return res.status(404).json({ error: 'Аудио ещё нет' });
  }
  const file = path.join(jobDir(meta.id), meta.audioFile || 'audio.wav');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Файл аудио пропал' });
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.sendFile(file);
});

module.exports = router;
