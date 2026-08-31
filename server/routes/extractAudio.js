const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const { getPaths } = require('../services/mediaBins');
const {
  probeFfmpeg,
  previewCommand,
  startExtractJob,
  readMeta,
  jobDir,
  publicJob,
  subscribe,
} = require('../services/extractLocalAudio');

const router = express.Router();

fs.mkdirSync(path.join(config.extractAudioDir, 'temp'), { recursive: true });

const upload = multer({
  dest: path.join(config.extractAudioDir, 'temp'),
  limits: { fileSize: config.extractAudioMaxFilesize },
});

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.get('/tools', async (_req, res, next) => {
  try {
    const bundled = getPaths().ffmpeg;
    let bundledProbe = null;
    if (bundled) {
      try {
        bundledProbe = await probeFfmpeg(path.dirname(bundled));
      } catch {
        bundledProbe = null;
      }
    }
    res.json({
      bundledDir: bundledProbe ? bundledProbe.ffmpegDir : bundled ? path.dirname(bundled) : null,
      bundledVersion: bundledProbe ? bundledProbe.version : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/preview', (req, res, next) => {
  try {
    const result = previewCommand(
      req.query.ffmpegDir,
      req.query.inputName,
      req.query.quality
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/probe', express.json(), async (req, res, next) => {
  try {
    const result = await probeFfmpeg(req.body && req.body.ffmpegDir);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', upload.single('file'), (req, res, next) => {
  req.setTimeout(config.extractAudioTimeoutMs + 60 * 1000);
  res.setTimeout(config.extractAudioTimeoutMs + 60 * 1000);

  if (!req.file) {
    return res.status(400).json({ error: 'Выберите видеофайл' });
  }

  try {
    const meta = startExtractJob({
      ffmpegDir: req.body && req.body.ffmpegDir,
      sourcePath: req.file.path,
      originalName: req.file.originalname || 'video',
      command: req.body && req.body.command,
      quality: req.body && req.body.quality,
    });
    res.status(202).json(publicJob(meta));
  } catch (err) {
    try {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (_) {
      /* ignore */
    }
    next(err);
  }
});

router.get('/jobs/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Задание не найдено' });
  res.json(publicJob(meta));
});

router.get('/jobs/:id/progress', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Задание не найдено' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  sendSse(res, publicJob(meta));
  if (meta.status === 'ready' || meta.status === 'failed') {
    res.end();
    return;
  }

  const unsubscribe = subscribe(req.params.id, (payload) => {
    sendSse(res, payload);
    if (payload.status === 'ready' || payload.status === 'failed') {
      res.end();
    }
  });

  const heartbeat = setInterval(() => {
    res.write(':\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
  });
});

router.get('/jobs/:id/download', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta || meta.status !== 'ready' || !meta.audioFile) {
    return res.status(404).json({ error: 'Аудио ещё нет' });
  }
  const file = path.join(jobDir(meta.id), meta.audioFile);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Файл аудио пропал' });
  }
  res.download(file, meta.downloadName || meta.audioFile);
});

router.use((err, _req, res, next) => {
  if (err && err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
    err.status = 413;
    err.message = 'Файл слишком большой (макс. 2 ГБ)';
  }
  next(err);
});

module.exports = router;
