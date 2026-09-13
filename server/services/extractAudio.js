const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../config');
const { requireBins, run } = require('./mediaBins');
const { formatCommand, patchStep, markDone } = require('./jobSteps');
const { createYtdlpTracker, formatBytes } = require('./ytdlpProgress');
const {
  normalizeDownloadMode,
  normalizeVideoQuality,
  formatSelector,
  outputTemplate,
  qualityLabel,
  expectedStreamCount,
  genericFormat,
  downloadStrategyPlan,
} = require('./ytdlpOptions');
const { serverPath } = require('./storageInfo');

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
  const next = { ...(meta || {}), id };
  delete next.sttApiKey;
  delete next.summarizeApiKey;
  delete next.creds;
  delete next.apiKey;
  delete next.transcriptOverride;
  fs.writeFileSync(path.join(jobDir(id), 'meta.json'), JSON.stringify(next, null, 2));
}

const AUDIO_SOURCE_EXT = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.aac',
  '.flac',
  '.opus',
  '.wma',
]);

function isAudioSource(filePath) {
  return AUDIO_SOURCE_EXT.has(path.extname(filePath || '').toLowerCase());
}

function findSourceFile(dir) {
  let meta = null;
  try {
    meta = readMeta(path.basename(dir));
  } catch (_) {
    meta = null;
  }
  if (meta && meta.sourceFile) {
    const exact = path.join(dir, path.basename(meta.sourceFile));
    if (fs.existsSync(exact)) return exact;
  }

  const names = fs
    .readdirSync(dir)
    .filter(
      (n) =>
        (n.startsWith('source.') ||
          /^video-[a-z0-9]{6,8}\./i.test(n) ||
          /^audio-[a-z0-9]{6,8}\./i.test(n) ||
          /^upload-[a-z0-9]{6,8}\./i.test(n)) &&
        !n.endsWith('.json') &&
        !n.endsWith('.part') &&
        !n.endsWith('.ytdl') &&
        !/\.f\d+\./i.test(n) &&
        n !== 'source.wav'
    );
  if (!names.length) {
    const fallback = fs
      .readdirSync(dir)
      .filter(
        (n) =>
          n.startsWith('source.') &&
          !n.endsWith('.json') &&
          !n.endsWith('.part') &&
          !n.endsWith('.ytdl') &&
          !/\.f\d+\./i.test(n)
      );
    if (!fallback.length) return null;
    return path.join(dir, fallback[0]);
  }
  const prefer = names.filter((n) => /\.(mp4|mov|webm|mkv)$/i.test(n));
  const hit = prefer[0];
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

function ytdlpDownloadArgs(
  url,
  bins,
  dir,
  {
    cookiesBrowser = null,
    downloadMode = 'video',
    videoQuality = '720',
    fileToken,
  } = {}
) {
  const mode = normalizeDownloadMode(downloadMode);
  const quality = normalizeVideoQuality(videoQuality);
  const args = [
    '--js-runtimes',
    `node:${process.execPath}`,
    '--force-ipv4',
    '--ffmpeg-location',
    bins.ffmpeg,
    '-f',
    formatSelector(mode, quality),
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
    outputTemplate(mode, fileToken),
    url,
  ];
  if (mode === 'video') {
    args.splice(args.length - 1, 0, '--merge-output-format', 'mp4');
  }
  if (cookiesBrowser) {
    args.splice(2, 0, '--cookies-from-browser', cookiesBrowser);
  }
  return args;
}

const DOWNLOADED_MEDIA_EXT = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.wmv',
  '.asf',
  '.vob',
  '.m2ts',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.aac',
  '.flac',
  '.wav',
  '.wma',
  '.ts',
]);

function findAttemptMedia(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => {
      const name = path.basename(file);
      if (/(\.part|\.ytdl|\.temp)$/i.test(name) || /\.f\d+\./i.test(name)) return false;
      try {
        return fs.statSync(file).isFile() && DOWNLOADED_MEDIA_EXT.has(path.extname(name).toLowerCase());
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return files[0] || null;
}

function finalizeAttemptMedia(attemptDir, dir, downloadMode, fileToken) {
  const source = findAttemptMedia(attemptDir);
  if (!source) throw new Error('yt-dlp завершился, но итоговый медиафайл не найден');
  const ext = path.extname(source).toLowerCase();
  const finalName = outputTemplate(downloadMode, fileToken).replace('%(ext)s', ext.slice(1));
  const finalPath = path.join(dir, finalName);
  if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  fs.renameSync(source, finalPath);
  try {
    fs.rmSync(attemptDir, { recursive: true, force: true });
  } catch (_) {
    // The final file is already safe in the job directory; stale temp cleanup is non-fatal.
  }
  return finalPath;
}

function fallbackArgs(strategyId, url, downloadMode) {
  const format = genericFormat(downloadMode);
  if (strategyId === 'youtube-cookies') {
    return [
      '--js-runtimes',
      `node:${process.execPath}`,
      '--cookies-from-browser',
      'firefox',
      '-f',
      format,
      url,
    ];
  }
  return [url, '-f', format];
}

function mediaPathEnv(bins) {
  const currentPath = process.env.PATH || process.env.Path || '';
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env.PATH = [path.dirname(bins.ffmpeg), currentPath].filter(Boolean).join(path.delimiter);
  return env;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    command: formatCommand(bins.ffmpeg, [
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
  meta.sourceFile = path.basename(sourcePath);
  meta.sourceKind = isAudioSource(sourcePath) ? 'audio' : 'video';
  meta.sourceBytes = fs.statSync(sourcePath).size;
  meta.sourceServerPath = serverPath(sourcePath);
  meta.steps = steps;
  writeMeta(id, meta);
  if (opts.onProgress) opts.onProgress(meta);
  return meta;
}

async function extractAudioFromUrl(rawUrl, opts = {}) {
  const url = assertHttpUrl(rawUrl);
  const bins = requireBins();
  const id = opts.jobId || randomUUID();
  const fileToken = String(opts.fileToken || id).replace(/-/g, '').slice(0, 8);
  const downloadMode = normalizeDownloadMode(opts.downloadMode);
  const videoQuality = normalizeVideoQuality(opts.videoQuality);
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const prev = readMeta(id) || {};
  const report = createReporter(id, opts.onProgress);
  let steps = prev.steps || [];
  let ytdlpTitle = null;
  let attempts = downloadStrategyPlan({ url, downloadMode, videoQuality }).map((attempt) => ({
    ...attempt,
    status: 'pending',
    error: null,
  }));
  const sourceHost = new URL(url).hostname;
  const meta = {
    ...prev,
    id,
    url,
    downloadMode,
    videoQuality,
    fileToken,
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  if (!opts.leaveStatus) meta.status = 'extracting';

  steps = patchStep(steps, 'download', {
    status: 'active',
    progress: 0,
    indeterminate: true,
    startedAt: new Date().toISOString(),
    detail:
      `Запускаем yt-dlp: ${
        downloadMode === 'audio'
          ? 'скачиваем только аудиодорожку, без видеопотока'
          : `скачиваем MP4, качество ${qualityLabel(videoQuality)}`
      }. Для ${sourceHost} запланировано ${attempts.length} способа скачивания.`,
    attempts,
    stats: {
      phase: 'starting',
      phaseLabel:
        `yt-dlp запускается. Попытка 1 из ${attempts.length}: ${attempts[0].title}.`,
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

  const tryDownload = async (strategy, attemptDir, attemptNumber) => {
    const args =
      strategy.id === 'configured'
        ? ytdlpDownloadArgs(url, bins, attemptDir, {
            cookiesBrowser: null,
            downloadMode,
            videoQuality,
            fileToken,
          })
        : fallbackArgs(strategy.id, url, downloadMode);
    const startedAt = Date.now();
    const tracker = createYtdlpTracker({
      cookiesBrowser: strategy.id === 'youtube-cookies' ? 'firefox' : null,
      startedAt,
      expectedStreams: expectedStreamCount(downloadMode),
      sourceHost,
    });
    attempts = attempts.map((attempt, index) => ({
      ...attempt,
      status: index === attemptNumber ? 'active' : attempt.status,
      error: index === attemptNumber ? null : attempt.error,
    }));
    steps = patchStep(steps, 'download', {
      status: 'active',
      indeterminate: true,
      command: formatCommand(
        bins.ytdlp,
        args.map((arg) => (arg === url ? 'URL_страницы_с_видео' : arg))
      ),
      attempts,
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
        cwd: attemptDir,
        env: mediaPathEnv(bins),
        onOutput: (text) => {
          tracker.ingest(text);
          ytdlpTitle = tracker.title() || ytdlpTitle;
          flush(false);
        },
      });
    } finally {
      clearInterval(timer);
      flush(true);
    }
    return finalizeAttemptMedia(attemptDir, dir, downloadMode, fileToken);
  };

  try {
    let sourcePath = null;
    let lastDownloadError = null;
    let lastDownloadMessage = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const strategy = attempts[index];
      const attemptDir = path.join(dir, `.download-attempt-${index + 1}`);
      fs.rmSync(attemptDir, { recursive: true, force: true });
      fs.mkdirSync(attemptDir, { recursive: true });
      try {
        sourcePath = await tryDownload(strategy, attemptDir, index);
        attempts = attempts.map((attempt, attemptIndex) => ({
          ...attempt,
          status:
            attemptIndex === index
              ? 'done'
              : attemptIndex > index
                ? 'skipped'
                : attempt.status,
        }));
        steps = patchStep(steps, 'download', { attempts });
        report({ steps, phase: 'downloading' }, true);
        break;
      } catch (err) {
        lastDownloadError = err;
        const message = String(err.message || 'Неизвестная ошибка')
          .split(url)
          .join('URL_страницы_с_видео')
          .slice(0, 600);
        lastDownloadMessage = message;
        attempts = attempts.map((attempt, attemptIndex) =>
          attemptIndex === index
            ? { ...attempt, status: 'failed', error: message }
            : attempt
        );
        fs.rmSync(attemptDir, { recursive: true, force: true });

        const nextAttempt = attempts[index + 1];
        if (!nextAttempt) break;
        for (let seconds = 5; seconds >= 1; seconds -= 1) {
          const phaseLabel =
            `Попытка ${index + 1} не сработала. Через ${seconds} сек. запустим ` +
            `попытку ${index + 2}: ${nextAttempt.title}.`;
          steps = patchStep(steps, 'download', {
            status: 'active',
            progress: 0,
            indeterminate: true,
            attempts,
            detail: phaseLabel,
            stats: {
              phase: 'retry_wait',
              phaseLabel,
              items: [
                {
                  key: 'failed',
                  label: 'Не сработало',
                  value: attempts[index].title,
                },
                {
                  key: 'next',
                  label: 'Следующий способ',
                  value: nextAttempt.title,
                },
                {
                  key: 'retry',
                  label: 'Повтор через',
                  value: `${seconds} сек.`,
                },
              ],
              log: [`Ошибка: ${message}`],
            },
          });
          report({ steps, phase: 'retry_wait' }, true);
          await sleep(1000);
        }
      }
    }

    if (!sourcePath) {
      const methods = attempts.map((attempt) => attempt.title).join(', ');
      throw new Error(
        `Не удалось скачать после ${attempts.length} попыток (${methods}). ` +
          `${lastDownloadMessage || lastDownloadError?.name || 'Все способы завершились ошибкой'}`
      );
    }
    if (ytdlpTitle) meta.title = ytdlpTitle;
    meta.sourceFile = path.basename(sourcePath);
    meta.sourceKind = downloadMode;
    meta.sourceBytes = fs.statSync(sourcePath).size;
    meta.sourceServerPath = serverPath(sourcePath);

    const durationSec = await probeDuration(sourcePath, bins);
    if (durationSec && durationSec > config.summarizeMaxDurationSec) {
      const err = new Error(`Слишком длинное видео (${Math.round(durationSec / 60)} мин)`);
      err.status = 400;
      throw err;
    }

    steps = markDone(
      steps,
      'download',
      `Скачано: ${path.basename(sourcePath)} · ${serverPath(sourcePath)}${
        durationSec ? ` · ${Math.round(durationSec)} с` : ''
      }`
    );
    steps = patchStep(steps, 'download', {
      stats: {
        phase: 'done',
        phaseLabel: `Готово: ${path.basename(sourcePath)} сохранён на сервере: ${serverPath(sourcePath)}.`,
        items: [
          { key: 'file', label: 'Файл', value: path.basename(sourcePath) },
          { key: 'path', label: 'Путь на сервере', value: serverPath(sourcePath) },
          {
            key: 'bytes',
            label: 'Размер',
            value: formatBytes(fs.statSync(sourcePath).size) || `${fs.statSync(sourcePath).size} Б`,
          },
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
      command: formatCommand(bins.ffmpeg, [
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
        path.join(dir, 'audio.wav'),
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
    meta.sourceFile = path.basename(sourcePath);
    meta.sourceKind = downloadMode;
    meta.sourceBytes = fs.statSync(sourcePath).size;
    meta.sourceServerPath = serverPath(sourcePath);
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
  const sourceKind = sourcePath
    ? meta.sourceKind || (isAudioSource(sourcePath) ? 'audio' : 'video')
    : meta.sourceKind || null;
  const sourceUrl = sourcePath ? `/api/summarize/jobs/${meta.id}/source` : null;
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
    downloadMode: meta.downloadMode || null,
    videoQuality: meta.videoQuality || null,
    sourceUrl,
    sourceKind,
    sourceName: sourcePath ? path.basename(sourcePath) : meta.sourceFile || null,
    sourceBytes: sourcePath ? fs.statSync(sourcePath).size : meta.sourceBytes || null,
    sourceServerPath: sourcePath ? serverPath(sourcePath) : meta.sourceServerPath || null,
    videoUrl: sourcePath && sourceKind === 'video' ? sourceUrl : null,
    videoName: sourcePath && sourceKind === 'video' ? path.basename(sourcePath) : null,
    sourceAudioUrl: sourcePath && sourceKind === 'audio' ? sourceUrl : null,
    posterUrl: sourcePath && sourceKind === 'video'
      ? `/api/summarize/jobs/${meta.id}/poster.jpg`
      : null,
    audioUrl: audioExists ? `/api/summarize/jobs/${meta.id}/audio` : null,
    audioMp3Url: audioExists ? `/api/summarize/jobs/${meta.id}/audio.mp3` : null,
    transcript: meta.transcript || null,
    transcriptUrl: meta.transcript
      ? `/api/summarize/jobs/${meta.id}/transcript.txt`
      : null,
    summary: meta.summary || null,
    provider: meta.provider || null,
    model: meta.model || null,
    sttProvider: meta.sttProvider || null,
    sttModel: meta.sttModel || null,
    steps: meta.steps || [],
    audioOnly: Boolean(meta.audioOnly),
    transcriptOnly: Boolean(meta.transcriptOnly),
    canTranscribe: Boolean(
      audioExists &&
        !meta.transcript &&
        (meta.status === 'audio_ready' ||
          meta.status === 'failed' ||
          (meta.steps || []).some((s) => s.id === 'stt' && (s.status === 'skipped' || s.status === 'failed')))
    ),
    canSummarize: Boolean(
      meta.transcript &&
        !meta.summary &&
        (meta.status === 'transcript_ready' ||
          meta.status === 'failed' ||
          (meta.steps || []).some((s) => s.id === 'summarize' && (s.status === 'skipped' || s.status === 'failed')))
    ),
  };
}

const mp3Locks = new Map();

async function ensureDownloadMp3(id) {
  const meta = readMeta(id);
  if (!meta || !meta.audioFile) {
    const err = new Error('Аудио ещё нет');
    err.status = 404;
    throw err;
  }
  const dir = jobDir(id);
  const wavPath = path.join(dir, meta.audioFile);
  if (!fs.existsSync(wavPath)) {
    const err = new Error('Файл аудио пропал');
    err.status = 404;
    throw err;
  }

  const dest = path.join(dir, 'audio.mp3');
  try {
    if (
      fs.existsSync(dest) &&
      fs.statSync(dest).mtimeMs >= fs.statSync(wavPath).mtimeMs &&
      fs.statSync(dest).size > 256
    ) {
      return dest;
    }
  } catch (_) {
    // recode
  }

  const pending = mp3Locks.get(id);
  if (pending) return pending;

  const work = (async () => {
    const { ffmpeg } = requireBins({ needYtdlp: false });
    const tmp = path.join(dir, 'audio.download.tmp.mp3');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    const base = ['-y', '-i', wavPath, '-vn', '-ac', '1', '-ar', '16000'];
    try {
      await run(ffmpeg, [...base, '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', tmp], {
        timeoutMs: Math.min(config.summarizeTimeoutMs || 180000, 180000),
      });
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) {}
      await run(ffmpeg, [...base, '-b:a', '96k', '-f', 'mp3', tmp], {
        timeoutMs: Math.min(config.summarizeTimeoutMs || 180000, 180000),
      });
    }
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 256) {
      throw new Error('Не удалось закодировать MP3');
    }
    fs.renameSync(tmp, dest);
    return dest;
  })().finally(() => {
    mp3Locks.delete(id);
  });

  mp3Locks.set(id, work);
  return work;
}

const posterLocks = new Map();

async function ensureFirstFrameJpg(id) {
  const meta = readMeta(id);
  if (!meta) {
    const err = new Error('Задание не найдено');
    err.status = 404;
    throw err;
  }
  const dir = jobDir(id);
  const sourcePath = findSourceFile(dir);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const err = new Error('Видео ещё нет или уже удалено');
    err.status = 404;
    throw err;
  }
  if (isAudioSource(sourcePath)) {
    const err = new Error('В исходнике нет видеоряда — кадр снять нельзя');
    err.status = 400;
    throw err;
  }

  const dest = path.join(dir, 'poster.jpg');
  try {
    if (
      fs.existsSync(dest) &&
      fs.statSync(dest).mtimeMs >= fs.statSync(sourcePath).mtimeMs &&
      fs.statSync(dest).size > 256
    ) {
      return dest;
    }
  } catch (_) {
    // recode
  }

  const pending = posterLocks.get(id);
  if (pending) return pending;

  const work = (async () => {
    const { ffmpeg } = requireBins({ needYtdlp: false });
    const tmp = path.join(dir, 'poster.tmp.jpg');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
    await run(
      ffmpeg,
      ['-y', '-i', sourcePath, '-an', '-sn', '-frames:v', '1', '-q:v', '2', tmp],
      { timeoutMs: 60000 }
    );
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 256) {
      throw new Error('Не удалось снять первый кадр');
    }
    fs.renameSync(tmp, dest);
    return dest;
  })().finally(() => {
    posterLocks.delete(id);
  });

  posterLocks.set(id, work);
  return work;
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
  ensureDownloadMp3,
  ensureFirstFrameJpg,
};
