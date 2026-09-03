const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');
const { requireBins, run } = require('./mediaBins');
const { formatCommand, patchStep, markDone, ytdlpShowArgs } = require('./jobSteps');
const { createYtdlpTracker } = require('./ytdlpProgress');

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
        !n.endsWith('.part') &&
        !n.endsWith('.ytdl') &&
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
    if (!force && now - lastWrite < 150) return;
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
    '--force-ipv4',
    '--ffmpeg-location',
    bins.ffmpeg,
    '-f',
    'bestvideo+bestaudio/best',
    '--no-playlist',
    '--newline',
    '--progress',
    '--progress-delta',
    '0.4',
    '--no-mtime',
    '--socket-timeout',
    '30',
    '--print',
    'before_dl:TITLE\t%(title)s',
    '--print',
    'before_dl:META\t%(duration)s\t%(resolution)s\t%(fps)s\t%(format_id)s',
    '--progress-template',
    'download:PROGRESS\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress.elapsed)s\t%(progress.fragment_index)s\t%(progress.fragment_count)s',
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
      const sec = ms / 1e6;
      const detail = durationSec
        ? `ffmpeg пишет WAV… ${Math.round(sec)} с из ${Math.round(durationSec)} с`
        : `ffmpeg пишет WAV… ${Math.round(sec)} с`;
      if (onTick) {
        onTick({
          progress,
          indeterminate: progress == null,
          detail,
        });
      }
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
    indeterminate: !durationSec,
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
      '-nostats',
      '-progress',
      'pipe:1',
      'audio.wav',
    ]),
    detail: durationSec
      ? `Идёт извлечение звука (~${Math.round(durationSec)} с)…`
      : 'Идёт извлечение звука…',
  });
  report({ phase: 'extracting', steps }, true);

  await runFfmpegExtract(bins, sourcePath, wavPath, dir, {
    durationSec,
    onTick: ({ progress, indeterminate, detail }) => {
      steps = patchStep(steps, 'ffmpeg', {
        status: 'active',
        progress,
        indeterminate: Boolean(indeterminate),
        detail: detail || 'ffmpeg пишет WAV…',
      });
      report({ steps, phase: 'extracting' });
    },
  });

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
    indeterminate: true,
    startedAt: new Date().toISOString(),
    detail:
      'Запускаем yt-dlp. Сейчас попытка соединиться с YouTube — файл ещё не качается, скорости нет.',
    stats: {
      phase: 'starting',
      phaseLabel:
        'yt-dlp запускается. Пытаемся прочитать cookies Firefox и открыть соединение с YouTube.',
      items: [
        { key: 'speed', label: 'Скорость', value: 'нет: файл ещё не качается' },
        { key: 'size', label: 'Скачано', value: '0 — до файла не дошли' },
        { key: 'eta', label: 'Осталось', value: 'появится, когда пойдут байты' },
        { key: 'elapsed', label: 'Прошло', value: '00:00' },
      ],
      log: ['Процесс yt-dlp запускается…'],
    },
  });
  meta.steps = steps;
  meta.phase = 'downloading';
  writeMeta(id, meta);
  if (opts.onProgress) opts.onProgress({ ...meta });

  const tryDownload = async (cookiesBrowser) => {
    const args = ytdlpDownloadArgs(url, bins, dir, { cookiesBrowser });
    const startedAt = Date.now();
    const tracker = createYtdlpTracker({ cookiesBrowser, startedAt });
    steps = patchStep(steps, 'download', {
      status: 'active',
      indeterminate: true,
      command: formatCommand('yt-dlp', ytdlpShowArgs(url, cookiesBrowser)),
      ...tracker.snapshot(),
    });
    report({ steps, phase: 'downloading' }, true);

    const flush = (force = false) => {
      steps = patchStep(steps, 'download', tracker.snapshot());
      report({ steps, phase: 'downloading' }, force);
    };
    const timer = setInterval(() => flush(true), 500);

    try {
      await run(bins.ytdlp, args, {
        timeoutMs: config.summarizeTimeoutMs,
        cwd: dir,
        onOutput: (text) => {
          tracker.ingest(text);
          flush(false);
        },
      });
    } finally {
      clearInterval(timer);
      flush(true);
    }
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

    steps = markDone(
      steps,
      'download',
      `Скачано: ${path.basename(sourcePath)}${durationSec ? ` · ${Math.round(durationSec)} с` : ''}`
    );
    steps = patchStep(steps, 'download', {
      stats: {
        phase: 'done',
        phaseLabel: `Готово: ${path.basename(sourcePath)} сохранён.`,
        items: [
          { key: 'file', label: 'Файл', value: path.basename(sourcePath) },
          {
            key: 'size',
            label: 'Длительность',
            value: durationSec ? `${Math.round(durationSec)} с` : 'неизвестна',
          },
        ],
        log: [],
      },
    });
    steps = patchStep(steps, 'ffmpeg', {
      status: 'active',
      progress: 0,
      indeterminate: !durationSec,
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
        '-nostats',
        '-progress',
        'pipe:1',
        'audio.wav',
      ]),
      detail: durationSec
        ? `Идёт извлечение звука (~${Math.round(durationSec)} с)…`
        : 'Идёт извлечение звука…',
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
      onTick: ({ progress, indeterminate, detail }) => {
        steps = patchStep(steps, 'ffmpeg', {
          status: 'active',
          progress,
          indeterminate: Boolean(indeterminate),
          detail: detail || 'ffmpeg пишет WAV…',
        });
        report({ steps, phase: 'extracting' });
      },
    });

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
  const dir = jobDir(meta.id);
  let sourcePath = null;
  try {
    if (fs.existsSync(dir)) sourcePath = findSourceFile(dir);
  } catch (_) {
    sourcePath = null;
  }
  const audioPath = meta.audioFile ? path.join(dir, meta.audioFile) : null;
  const audioExists = Boolean(audioPath && fs.existsSync(audioPath));
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
    aiError: meta.aiError || null,
    createdAt: meta.createdAt,
    videoUrl: sourcePath ? `/api/summarize/jobs/${meta.id}/video` : null,
    videoName: sourcePath ? path.basename(sourcePath) : null,
    audioUrl: audioExists ? `/api/summarize/jobs/${meta.id}/audio` : null,
    summary: meta.summary || null,
    provider: meta.provider || null,
    model: meta.model || null,
    steps: meta.steps || [],
    audioOnly: Boolean(meta.audioOnly),
    canSummarize: Boolean(
      audioExists &&
        !meta.summary &&
        (meta.status === 'audio_ready' ||
          meta.status === 'failed' ||
          (meta.steps || []).some((s) => s.id === 'summarize' && (s.status === 'skipped' || s.status === 'failed')))
    ),
  };
}

module.exports = {
  extractAudioFromUrl,
  extractAudioFromFile,
  readMeta,
  writeMeta,
  jobDir,
  findSourceFile,
  publicJob,
  assertHttpUrl,
};
