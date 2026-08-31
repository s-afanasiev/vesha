const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');
const { requireBins, run } = require('./mediaBins');
const { formatCommand, patchStep, markDone } = require('./jobSteps');

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
  const names = fs
    .readdirSync(dir)
    .filter(
      (n) =>
        n.startsWith('source.') &&
        !n.endsWith('.json') &&
        !/^source\.f\d+/i.test(n) &&
        n !== 'source.wav'
    );
  if (!names.length) {
    const fallback = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith('source.') && !n.endsWith('.json'));
    if (!fallback.length) return null;
    return path.join(dir, fallback[0]);
  }
  const prefer = ['source.mkv', 'source.mp4', 'source.webm', 'source.mov'];
  const hit = prefer.find((p) => names.includes(p));
  return path.join(dir, hit || names[0]);
}

function lastLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() || '';
}

function parseYtdlpPercent(text) {
  const matches = String(text).matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g);
  let last = null;
  for (const m of matches) last = Number(m[1]);
  return Number.isFinite(last) ? last : null;
}

function parseFfmpegOutTimeMs(text) {
  const matches = String(text).matchAll(/out_time_ms=(\d+)/g);
  let last = null;
  for (const m of matches) last = Number(m[1]);
  return Number.isFinite(last) ? last : null;
}

function createReporter(id, onProgress) {
  let lastWrite = 0;
  return (patch, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 400) return;
    lastWrite = now;
    const prev = readMeta(id) || { id };
    const next = { ...prev, ...patch, id };
    if (onProgress) onProgress(next);
    else writeMeta(id, next);
  };
}

async function probeDuration(file, bins) {
  if (!bins.ffprobe) return null;
  try {
    const { stdout } = await run(
      bins.ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeoutMs: 20000 }
    );
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function ytdlpDownloadArgs(url, bins, dir, { cookiesBrowser = 'firefox' } = {}) {
  const args = [
    '--js-runtimes',
    `node:${process.execPath}`,
    '--ffmpeg-location',
    bins.ffmpeg,
    '-f',
    'bestvideo+bestaudio/best',
    '--no-playlist',
    '--newline',
    '--no-mtime',
    '--socket-timeout',
    '30',
    '-P',
    dir,
    '-o',
    'source.%(ext)s',
    url,
  ];
  if (cookiesBrowser) {
    args.splice(2, 0, '--cookies-from-browser', cookiesBrowser);
  }
  return args;
}

async function runFfmpegExtract(bins, sourcePath, wavPath, dir, { durationSec, onTick }) {
  const args = [
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
    '-nostats',
    '-progress',
    'pipe:1',
    wavPath,
  ];
  await run(bins.ffmpeg, args, {
    timeoutMs: config.summarizeTimeoutMs,
    cwd: dir,
    onOutput: (text) => {
      const ms = parseFfmpegOutTimeMs(text);
      if (ms == null) return;
      let progress = null;
      if (durationSec) {
        progress = Math.max(1, Math.min(99, Math.round((ms / 1e6 / durationSec) * 100)));
      }
      if (onTick) onTick({ progress, detail: lastLine(text) });
    },
  });
}

async function extractAudioFromFile(id, opts = {}) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Задание не найдено');
  const dir = jobDir(id);
  const sourcePath = findSourceFile(dir);
  if (!sourcePath) throw new Error('Исходный файл не найден');

  const bins = requireBins({ needYtdlp: false });
  const wavPath = path.join(dir, 'audio.wav');
  const report = createReporter(id, opts.onProgress);
  let steps = meta.steps || [];
  const durationSec = await probeDuration(sourcePath, bins);

  steps = patchStep(steps, 'ffmpeg', {
    status: 'active',
    progress: 0,
    command: formatCommand('ffmpeg', [
      '-y',
      '-i',
      path.basename(sourcePath),
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      'audio.wav',
    ]),
    detail: 'Идёт извлечение звука…',
  });
  report({ phase: 'extracting', steps }, true);

  await runFfmpegExtract(bins, sourcePath, wavPath, dir, {
    durationSec,
    onTick: ({ progress, detail }) => {
      steps = patchStep(steps, 'ffmpeg', {
        status: 'active',
        progress,
        detail: detail || 'ffmpeg пишет WAV…',
      });
      report({ steps, phase: 'extracting' });
    },
  });

  if (sourcePath !== wavPath) {
    try {
      fs.unlinkSync(sourcePath);
    } catch (_) {
      // keep wav
    }
  }

  steps = markDone(steps, 'ffmpeg', 'Звук извлечён, WAV 16 kHz mono готов.');
  meta.audioFile = 'audio.wav';
  meta.bytes = fs.statSync(wavPath).size;
  meta.title = meta.title || meta.sourceTitle || path.basename(sourcePath);
  meta.duration = durationSec;
  meta.steps = steps;
  writeMeta(id, meta);
  if (opts.onProgress) opts.onProgress(meta);
  return meta;
}

async function extractAudioFromUrl(rawUrl, opts = {}) {
  const url = assertHttpUrl(rawUrl);
  const bins = requireBins();
  const id = opts.jobId || randomUUID();
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const prev = readMeta(id) || {};
  const report = createReporter(id, opts.onProgress);
  let steps = prev.steps || [];
  const meta = {
    ...prev,
    id,
    url,
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  if (!opts.leaveStatus) meta.status = 'extracting';

  steps = patchStep(steps, 'download', {
    status: 'active',
    progress: 0,
    detail: 'Запускаем yt-dlp (Node + cookies Firefox)…',
  });
  meta.steps = steps;
  meta.phase = 'downloading';
  writeMeta(id, meta);
  if (opts.onProgress) opts.onProgress({ ...meta });

  const tryDownload = async (cookiesBrowser) => {
    const args = ytdlpDownloadArgs(url, bins, dir, { cookiesBrowser });
    steps = patchStep(steps, 'download', {
      status: 'active',
      command: formatCommand('yt-dlp', [
        '--js-runtimes',
        'node',
        ...(cookiesBrowser ? ['--cookies-from-browser', cookiesBrowser] : []),
        '-f',
        'bestvideo+bestaudio/best',
        '--no-playlist',
        '--newline',
        url,
      ]),
      detail: cookiesBrowser
        ? `Скачивание с cookies ${cookiesBrowser}…`
        : 'Повтор без cookies браузера…',
    });
    report({ steps, phase: 'downloading' }, true);

    await run(bins.ytdlp, args, {
      timeoutMs: config.summarizeTimeoutMs,
      cwd: dir,
      onOutput: (text) => {
        const percent = parseYtdlpPercent(text);
        const line = lastLine(text);
        const patch = { status: 'active' };
        if (percent != null) patch.progress = Math.max(0, Math.min(99, Math.round(percent)));
        if (line) patch.detail = line;
        if (/\[Merger\]/i.test(text)) {
          patch.detail = 'Склеиваем video+audio (ffmpeg merge)…';
        }
        steps = patchStep(steps, 'download', patch);
        report({ steps, phase: 'downloading' });
      },
    });
  };

  try {
    try {
      await tryDownload('firefox');
    } catch (err) {
      const msg = String(err.message || '');
      const cookieFail = /cookie|firefox|Could not copy|profile/i.test(msg);
      if (!cookieFail && !/403|forbidden/i.test(msg)) throw err;
      steps = patchStep(steps, 'download', {
        detail: `Firefox cookies не сработали (${msg.slice(0, 180)}). Повторяем без cookies…`,
      });
      report({ steps, phase: 'downloading' }, true);
      await tryDownload(null);
    }

    const sourcePath = findSourceFile(dir);
    if (!sourcePath) throw new Error('yt-dlp не сохранил видео');

    const durationSec = await probeDuration(sourcePath, bins);
    if (durationSec && durationSec > config.summarizeMaxDurationSec) {
      const err = new Error(`Слишком длинное видео (${Math.round(durationSec / 60)} мин)`);
      err.status = 400;
      throw err;
    }

    steps = markDone(steps, 'download', `Скачано: ${path.basename(sourcePath)}`);
    steps = patchStep(steps, 'ffmpeg', {
      status: 'active',
      progress: 0,
      command: formatCommand('ffmpeg', [
        '-y',
        '-i',
        path.basename(sourcePath),
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        'audio.wav',
      ]),
      detail: 'Идёт извлечение звука…',
    });
    report(
      {
        steps,
        phase: 'extracting',
        title: meta.title,
        duration: durationSec,
      },
      true
    );

    const wavPath = path.join(dir, 'audio.wav');
    await runFfmpegExtract(bins, sourcePath, wavPath, dir, {
      durationSec,
      onTick: ({ progress, detail }) => {
        steps = patchStep(steps, 'ffmpeg', {
          status: 'active',
          progress,
          detail: detail || 'ffmpeg пишет WAV…',
        });
        report({ steps, phase: 'extracting' });
      },
    });

    try {
      fs.unlinkSync(sourcePath);
    } catch (_) {
      // keep wav
    }

    steps = markDone(steps, 'ffmpeg', 'Звук извлечён, WAV 16 kHz mono готов.');
    const stat = fs.statSync(wavPath);
    if (!opts.leaveStatus) meta.status = 'ready';
    meta.audioFile = 'audio.wav';
    meta.bytes = stat.size;
    meta.duration = durationSec;
    meta.steps = steps;
    meta.phase = 'extracting';
    writeMeta(id, meta);
    if (opts.onProgress) opts.onProgress(meta);
    return meta;
  } catch (err) {
    meta.status = 'failed';
    meta.error = err.message;
    meta.steps = patchStep(steps, steps.find((s) => s.status === 'active')?.id || 'download', {
      status: 'failed',
      detail: err.message,
    });
    writeMeta(id, meta);
    throw err;
  }
}

function publicJob(meta) {
  if (!meta) return null;
  return {
    id: meta.id,
    url: meta.url,
    title: meta.title || meta.sourceTitle || null,
    duration: meta.duration,
    extractor: meta.extractor,
    status: meta.status,
    phase: meta.phase || null,
    bytes: meta.bytes || null,
    error: meta.error || null,
    createdAt: meta.createdAt,
    audioUrl: meta.audioFile ? `/api/summarize/jobs/${meta.id}/audio` : null,
    summary: meta.summary || null,
    provider: meta.provider || null,
    model: meta.model || null,
    steps: meta.steps || [],
  };
}

module.exports = {
  extractAudioFromUrl,
  extractAudioFromFile,
  readMeta,
  writeMeta,
  jobDir,
  publicJob,
  assertHttpUrl,
};
