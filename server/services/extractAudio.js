const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');
const { requireBins, run } = require('./mediaBins');

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/i;

function assertHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    const err = new Error('Нужна ссылка http(s)');
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error('Только http/https ссылки');
    err.status = 400;
    throw err;
  }
  if (PRIVATE_HOST.test(parsed.hostname)) {
    const err = new Error('Локальные адреса нельзя');
    err.status = 400;
    throw err;
  }
  return parsed.href;
}

function jobDir(id) {
  return path.join(config.summarizeDir, id);
}

function readMeta(id) {
  const file = path.join(jobDir(id), 'meta.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeMeta(id, meta) {
  fs.writeFileSync(path.join(jobDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}

function findSourceFile(dir) {
  const names = fs.readdirSync(dir).filter((n) => n.startsWith('source.') && !n.endsWith('.json'));
  if (!names.length) return null;
  return path.join(dir, names[0]);
}

function parseJsonStdout(stdout) {
  const start = String(stdout).indexOf('{');
  const end = String(stdout).lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('yt-dlp не вернул JSON');
  return JSON.parse(String(stdout).slice(start, end + 1));
}

async function probeInfo(url, bins) {
  const args = [
    '--dump-single-json',
    '--no-download',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '30',
    url,
  ];
  if (bins.ffmpeg) args.unshift('--ffmpeg-location', bins.ffmpeg);
  const { stdout } = await run(bins.ytdlp, args, { timeoutMs: 60000 });
  const info = parseJsonStdout(stdout);
  return {
    title: info.title || info.fulltitle || null,
    duration: Number.isFinite(info.duration) ? info.duration : null,
    extractor: info.extractor || info.extractor_key || null,
    id: info.id || null,
  };
}

async function extractAudioFromUrl(rawUrl) {
  const url = assertHttpUrl(rawUrl);
  const bins = requireBins();
  const info = await probeInfo(url, bins);
  if (info.duration && info.duration > config.summarizeMaxDurationSec) {
    const err = new Error(`Слишком длинное видео (${Math.round(info.duration / 60)} мин)`);
    err.status = 400;
    throw err;
  }

  const id = randomUUID();
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    id,
    url,
    title: info.title,
    duration: info.duration,
    extractor: info.extractor,
    sourceId: info.id,
    status: 'extracting',
    createdAt: new Date().toISOString(),
  };
  writeMeta(id, meta);

  try {
    const ytdlpArgs = [
      '--ffmpeg-location',
      bins.ffmpeg,
      '-f',
      'ba/bestaudio/best',
      '--no-playlist',
      '--no-warnings',
      '--no-mtime',
      '--socket-timeout',
      '30',
      '--max-filesize',
      String(config.summarizeMaxFilesize),
      '-P',
      dir,
      '-o',
      'source.%(ext)s',
      url,
    ];
    await run(bins.ytdlp, ytdlpArgs, { timeoutMs: config.summarizeTimeoutMs, cwd: dir });

    const sourcePath = findSourceFile(dir);
    if (!sourcePath) throw new Error('yt-dlp не сохранил аудио');

    const wavPath = path.join(dir, 'audio.wav');
    await run(
      bins.ffmpeg,
      [
        '-y',
        '-i',
        sourcePath,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wavPath,
      ],
      { timeoutMs: config.summarizeTimeoutMs, cwd: dir }
    );

    try {
      fs.unlinkSync(sourcePath);
    } catch (_) {
      // keep wav even if source cleanup fails
    }

    const stat = fs.statSync(wavPath);
    meta.status = 'ready';
    meta.audioFile = 'audio.wav';
    meta.bytes = stat.size;
    writeMeta(id, meta);
    return meta;
  } catch (err) {
    meta.status = 'failed';
    meta.error = err.message;
    writeMeta(id, meta);
    throw err;
  }
}

function publicJob(meta) {
  if (!meta) return null;
  return {
    id: meta.id,
    url: meta.url,
    title: meta.title,
    duration: meta.duration,
    extractor: meta.extractor,
    status: meta.status,
    bytes: meta.bytes || null,
    error: meta.error || null,
    createdAt: meta.createdAt,
    audioUrl: meta.status === 'ready' ? `/api/summarize/jobs/${meta.id}/audio` : null,
  };
}

module.exports = {
  extractAudioFromUrl,
  readMeta,
  jobDir,
  publicJob,
  assertHttpUrl,
};
