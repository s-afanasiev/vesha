const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const config = require('../config');
const { getToolStatus } = require('../services/mediaBins');
const { readMeta, jobDir, findSourceFile } = require('../services/extractAudio');
const {
  enqueueUrl,
  enqueueFile,
  enqueueTranscribe,
  enqueueSummarize,
  view,
  snapshot,
} = require('../services/summarizeQueue');
const { ownerFromReq, listForOwner } = require('../services/summarizeHistory');
const { listStoredMedia, jobDisplayTitle } = require('../services/summarizeFiles');

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

function downloadName(name, fallback) {
  const raw = String(name || fallback || 'file');
  const safe = raw.replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_').slice(0, 120);
  return safe || fallback || 'file';
}

function jobFileBase(meta, fallback) {
  return downloadName(jobDisplayTitle(meta) || fallback, fallback);
}

function sourceMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.avi') return 'video/x-msvideo';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

function summaryPlainText(summary, title) {
  const s = summary || {};
  let text = `СУММАРИЗАЦИЯ: ${s.title || title || ''}\n\n`;
  text += `КРАТКАЯ СУТЬ:\n${s.tldr || ''}\n\n`;
  if (Array.isArray(s.key_points) && s.key_points.length) {
    text += `ТЕЗИСЫ:\n${s.key_points.map((p) => `- ${p}`).join('\n')}\n\n`;
  }
  if (Array.isArray(s.timeline) && s.timeline.length) {
    text += `ТАЙМКОДЫ:\n${s.timeline.map((t) => `- ${t.time || ''} ${t.title || ''}: ${t.summary || ''}`).join('\n')}\n\n`;
  }
  if (Array.isArray(s.action_items) && s.action_items.length) {
    text += `ЗАДАЧИ:\n${s.action_items.map((a) => `- ${a}`).join('\n')}\n\n`;
  }
  if (s.transcript) text += `РАСШИФРОВКА:\n${s.transcript}\n`;
  return text;
}

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 'on';
}

function aiOptions(body) {
  const src = body || {};
  return {
    audioOnly: truthy(src.audioOnly),
    transcriptOnly: truthy(src.transcriptOnly),
    sttProvider: src.sttProvider,
    sttApiKey: src.sttApiKey,
    summarizeProvider: src.summarizeProvider,
    summarizeApiKey: src.summarizeApiKey,
  };
}

router.get('/files', (_req, res) => {
  res.json(listStoredMedia());
});

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
        ...aiOptions(req.body),
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
        ...aiOptions(req.body),
        userId: owner.userId,
        guestId: owner.guestId,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/transcribe', (req, res, next) => {
  try {
    res.json(enqueueTranscribe(req.params.id, aiOptions(req.body)));
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/summarize', (req, res, next) => {
  try {
    const body = req.body || {};
    res.json(
      enqueueSummarize(req.params.id, {
        ...aiOptions(body),
        transcript: typeof body.transcript === 'string' ? body.transcript : undefined,
      })
    );
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
  const mime = sourceMime(file);
  res.setHeader('Content-Type', mime);
  if (req.query.download) {
    const ext = path.extname(file) || '.wav';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${jobFileBase(meta, 'audio')}${ext === '.wav' ? '.wav' : ext}"`
    );
  }
  res.sendFile(file);
});

router.get('/jobs/:id/video', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Задание не найдено' });
  const file = findSourceFile(jobDir(meta.id));
  if (!file || !fs.existsSync(file)) {
    return res.status(404).json({ error: 'Видео ещё нет или уже удалено' });
  }
  res.setHeader('Content-Type', sourceMime(file));
  if (req.query.download !== '0') {
    const ext = path.extname(file) || '.mp4';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${jobFileBase(meta, 'video')}${ext}"`
    );
  }
  res.sendFile(file);
});

router.get('/jobs/:id/transcript.txt', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta || !meta.transcript) {
    return res.status(404).json({ error: 'Расшифровки ещё нет' });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${jobFileBase(meta, 'transcript')}.txt"`
  );
  res.send(meta.transcript);
});

router.get('/jobs/:id/summary.txt', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta || !meta.summary) {
    return res.status(404).json({ error: 'Суммаризации ещё нет' });
  }
  const body = summaryPlainText(meta.summary, meta.title);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadName((meta.summary.title || 'summary') + '.txt', 'summary.txt')}"`
  );
  res.send(body);
});

module.exports = router;
