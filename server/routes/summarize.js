const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const config = require('../config');
const { getToolStatus, requireBins, run } = require('../services/mediaBins');
const {
  extractAudioFromUrl,
  readMeta,
  jobDir,
  publicJob,
} = require('../services/extractAudio');
const { summarizeWithGemini } = require('../services/aiSummarize');

const router = express.Router();

const upload = multer({
  dest: path.join(config.summarizeDir, 'temp'),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB
});

router.get('/tools', async (_req, res, next) => {
  try {
    const tools = await getToolStatus();
    res.json({
      ...tools,
      geminiConfigured: Boolean(config.geminiApiKey),
    });
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

router.post('/upload', upload.single('file'), async (req, res, next) => {
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

    const isAudioOnly = ['.wav', '.mp3', '.m4a', '.ogg', '.aac', '.flac'].includes(ext);
    let audioFile = 'audio.wav';
    let duration = null;

    try {
      const bins = await requireBins({ needYtdlp: false });
      const targetWav = path.join(dir, 'audio.wav');
      // Convert to 16kHz mono WAV using ffmpeg if available
      await run(
        bins.ffmpeg,
        [
          '-y',
          '-i',
          sourceFile,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          targetWav,
        ],
        { timeoutMs: 120000 }
      );
      audioFile = 'audio.wav';
    } catch (ffmpegErr) {
      console.warn('Server FFmpeg conversion failed/unavailable, using source file:', ffmpegErr.message);
      if (isAudioOnly) {
        audioFile = `source${ext}`;
      } else {
        // Keep source as fallback
        audioFile = `source${ext}`;
      }
    }

    const stats = fs.statSync(path.join(dir, audioFile));
    const meta = {
      id,
      url: null,
      sourceTitle: originalName,
      status: 'ready',
      duration: duration || null,
      bytes: stats.size,
      audioFile,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    res.json(publicJob(meta));
  } catch (err) {
    next(err);
  }
});

router.post('/ai-summary', async (req, res, next) => {
  try {
    const { jobId, transcriptText, mode } = req.body || {};
    let audioPath = null;
    let audioMime = 'audio/wav';

    if (jobId) {
      const meta = readMeta(jobId);
      if (meta && meta.audioFile) {
        const file = path.join(jobDir(jobId), meta.audioFile);
        if (fs.existsSync(file)) {
          audioPath = file;
          audioMime = meta.audioFile.endsWith('.mp3')
            ? 'audio/mp3'
            : meta.audioFile.endsWith('.m4a')
              ? 'audio/m4a'
              : 'audio/wav';
        }
      }
    }

    const result = await summarizeWithGemini({
      audioPath,
      audioMime,
      transcriptText: transcriptText || '',
    });

    res.json(result);
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
  const mime = file.endsWith('.mp3') ? 'audio/mp3' : file.endsWith('.m4a') ? 'audio/mp4' : 'audio/wav';
  res.setHeader('Content-Type', mime);
  res.sendFile(file);
});

module.exports = router;
