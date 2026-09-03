const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const config = require('../config');
const { getToolStatus } = require('../services/mediaBins');
const { readMeta, jobDir } = require('../services/extractAudio');
const {
  enqueueUrl,
  enqueueFile,
  enqueueSummarize,
  view,
  snapshot,
} = require('../services/summarizeQueue');
const { ownerFromReq, listForOwner } = require('../services/summarizeHistory');

const router = express.Router();

const upload = multer({
  dest: path.join(config.summarizeDir, 'temp'),
  limits: { fileSize: 150 * 1024 * 1024 },
});

router.get('/tools', async (_req, res, next) => {
  try {
    const tools = await getToolStatus();
    res.json({
      ...tools,
      geminiConfigured: Boolean(config.geminiApiKey),
      queue: snapshot(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/queue', (_req, res) => {
  res.json(snapshot());
});

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 'on';
}

router.get('/history', async (req, res, next) => {
  try {
    const owner = ownerFromReq(req);
    const { items, warning } = await listForOwner(owner);
    res.json({
      items,
      warning,
      guestId: owner.guestId,
      userId: owner.userId,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/from-url', (req, res, next) => {
  try {
    const owner = ownerFromReq(req);
    res.json(
      enqueueUrl(req.body && req.body.url, {
        audioOnly: truthy(req.body && req.body.audioOnly),
        userId: owner.userId,
        guestId: owner.guestId,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/upload', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const id = randomUUID();
    const dir = jobDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const originalName = req.file.originalname || 'upload';
    const ext = path.extname(originalName).toLowerCase() || '.dat';
    const sourceFile = path.join(dir, `source${ext}`);
    fs.renameSync(req.file.path, sourceFile);

    const owner = ownerFromReq(req);
    res.json(
      enqueueFile({
        id,
        sourceTitle: originalName,
        sourceBytes: req.file.size,
        audioOnly: truthy(req.body && req.body.audioOnly),
        userId: owner.userId,
        guestId: owner.guestId,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/summarize', (req, res, next) => {
  try {
    res.json(enqueueSummarize(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:id', (req, res) => {
  const data = view(req.params.id);
  if (!data) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(data);
});

router.get('/jobs/:id/audio', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta || !meta.audioFile) {
    return res.status(404).json({ error: 'Аудио ещё нет' });
  }
  const file = path.join(jobDir(meta.id), meta.audioFile);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Файл аудио пропал' });
  }
  const mime = file.endsWith('.mp3')
    ? 'audio/mp3'
    : file.endsWith('.m4a')
      ? 'audio/mp4'
      : 'audio/wav';
  res.setHeader('Content-Type', mime);
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${meta.audioFile || 'audio.wav'}"`);
  }
  res.sendFile(file);
});

module.exports = router;
