const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const config = require('../config');

const jobs = new Map();

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function jobDir(id) {
  return path.join(config.extractAudioDir, id);
}

function metaPath(id) {
  return path.join(jobDir(id), 'meta.json');
}

function readMeta(id) {
  const file = metaPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeMeta(meta) {
  fs.mkdirSync(jobDir(meta.id), { recursive: true });
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

function normalizePathInput(raw) {
  let s = String(raw || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function isFfmpegName(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base === 'ffmpeg.exe' || base === 'ffmpeg';
}

function resolveFfmpeg(raw) {
  const input = normalizePathInput(raw);
  if (!input) throw bad('Укажите папку, в которой лежит ffmpeg.exe');

  const resolved = path.resolve(input);
  if (isFfmpegName(resolved)) {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    throw bad('Файл ffmpeg не найден по этому пути');
  }

  if (!fs.existsSync(resolved)) throw bad('Папка с ffmpeg не найдена');
  const st = fs.statSync(resolved);
  if (!st.isDirectory()) throw bad('Нужна папка с ffmpeg.exe, а не файл');

  const names =
    process.platform === 'win32'
      ? ['ffmpeg.exe']
      : ['ffmpeg', 'ffmpeg.exe'];
  for (const name of names) {
    const candidate = path.join(resolved, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw bad('В этой папке нет ffmpeg.exe');
}

function firstLine(text) {
  return (
    String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) || ''
  );
}

function run(cmd, args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(bad('Таймаут запуска ffmpeg', 504));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(bad('Не удалось запустить ffmpeg.exe — проверьте путь'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const line = firstLine(stderr || stdout) || `ffmpeg exited ${code}`;
      reject(bad(line, 502));
    });
  });
}

function parseDurationSec(text) {
  const m = String(text).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseClockSec(value) {
  const m = String(value)
    .trim()
    .match(/^(-)?(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]));
}

function consumeProgress(chunk, state) {
  state.buf += chunk;
  const lines = state.buf.split(/\r?\n/);
  state.buf = lines.pop() || '';
  let changed = false;

  for (const line of lines) {
    const duration = parseDurationSec(line);
    if (duration && duration > 0) {
      state.durationSec = duration;
      changed = true;
    }

    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (key === 'out_time') {
      const sec = parseClockSec(value);
      if (sec != null && sec >= 0 && state.durationSec) {
        state.percent = Math.max(
          0,
          Math.min(99, Math.round((sec / state.durationSec) * 100))
        );
        changed = true;
      }
    } else if (key === 'progress' && value === 'end') {
      state.percent = 100;
      changed = true;
    }
  }

  return changed;
}

const ALLOWED_OUTPUT_EXT = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'flac',
  'wma',
  'mp2',
  'ac3',
  'webm',
]);

function quoteArg(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[\s"']/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function formatCommand(argv) {
  return argv.map(quoteArg).join(' ');
}

function parseArgv(command) {
  const s = String(command || '').trim();
  if (!s) throw bad('Пустая команда ffmpeg');
  if (s.length > 8000) throw bad('Слишком длинная команда ffmpeg');

  const args = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote === '"') {
      if (ch === '\\' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        args.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (quote) throw bad('Незакрытая кавычка в команде ffmpeg');
  if (cur) args.push(cur);
  if (!args.length) throw bad('Пустая команда ffmpeg');
  if (args.length > 80) throw bad('Слишком много аргументов ffmpeg');
  return args;
}

function defaultOutputName(inputName) {
  const base = path
    .basename(inputName || 'audio', path.extname(inputName || ''))
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .slice(0, 80);
  return `${base || 'audio'}.mp3`;
}

function defaultArgv(ffmpegPath, inputPath, outputPath) {
  return [
    ffmpegPath,
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
}

function previewCommand(ffmpegDir, inputName) {
  const input = inputName || 'video.mp4';
  let ffmpegPath = 'ffmpeg.exe';
  try {
    ffmpegPath = resolveFfmpeg(ffmpegDir);
  } catch {
    const trimmed = normalizePathInput(ffmpegDir);
    if (trimmed) {
      ffmpegPath = isFfmpegName(trimmed)
        ? path.resolve(trimmed)
        : path.join(path.resolve(trimmed), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    }
  }
  const argv = defaultArgv(ffmpegPath, input, defaultOutputName(input));
  return { argv, commandLine: formatCommand(argv) };
}

function sanitizeOutputName(raw) {
  const base = path.basename(String(raw || 'audio.mp3').replace(/\\/g, '/'));
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw bad('Некорректное имя выходного файла');
  }
  const ext = path.extname(cleaned).slice(1).toLowerCase();
  if (!ALLOWED_OUTPUT_EXT.has(ext)) {
    throw bad(
      `Выходной файл должен быть аудио (mp3, wav, m4a, aac, ogg, opus, flac), сейчас: ${ext || 'без расширения'}`
    );
  }
  return cleaned.slice(0, 120);
}

function applyUserCommand(ffmpeg, sourcePath, jobDirectory, commandString, originalName) {
  const argv = parseArgv(commandString).map((arg) =>
    arg.replaceAll('{ffmpeg}', ffmpeg).replaceAll('{input}', sourcePath)
  );
  argv[0] = ffmpeg;

  const iIdx = argv.indexOf('-i');
  if (iIdx < 0 || iIdx >= argv.length - 1) {
    throw bad('В команде нет аргумента -i <входной файл>');
  }
  argv[iIdx + 1] = sourcePath;

  const last = argv[argv.length - 1];
  if (!last || last.startsWith('-') || last === sourcePath) {
    throw bad('Последний аргумент команды должен быть выходным файлом');
  }
  const outName = sanitizeOutputName(
    last.replaceAll('{output}', defaultOutputName(originalName))
  );
  const outputPath = path.join(jobDirectory, outName);
  argv[argv.length - 1] = outputPath;
  for (let i = 0; i < argv.length; i++) {
    argv[i] = argv[i].replaceAll('{output}', outputPath);
  }

  return {
    argv,
    commandLine: formatCommand(argv),
    audioFile: outName,
    audioExt: path.extname(outName).slice(1).toLowerCase(),
  };
}

function publicJob(meta) {
  if (!meta) return null;
  return {
    id: meta.id,
    status: meta.status,
    percent: meta.percent || 0,
    title: meta.title || null,
    bytes: meta.bytes || null,
    audioExt: meta.audioExt || null,
    commandLine: meta.commandLine || null,
    error: meta.error || null,
    createdAt: meta.createdAt,
    downloadUrl:
      meta.status === 'ready' ? `/api/extract-audio/jobs/${meta.id}/download` : null,
  };
}

function getOrCreateRuntime(id, meta) {
  let runtime = jobs.get(id);
  if (!runtime) {
    runtime = { meta: meta || readMeta(id), emitter: new EventEmitter() };
    runtime.emitter.setMaxListeners(50);
    jobs.set(id, runtime);
  }
  if (meta) runtime.meta = meta;
  return runtime;
}

function emitJob(meta) {
  writeMeta(meta);
  const runtime = getOrCreateRuntime(meta.id, meta);
  runtime.emitter.emit('update', publicJob(meta));
}

async function probeFfmpeg(rawDir) {
  const ffmpeg = resolveFfmpeg(rawDir);
  const { stdout, stderr } = await run(ffmpeg, ['-hide_banner', '-version']);
  const banner = stdout || stderr;
  const version = firstLine(banner) || 'ffmpeg';
  const hasMp3 = /enable-libmp3lame|libmp3lame/i.test(banner);
  return {
    ok: true,
    ffmpegPath: ffmpeg,
    ffmpegDir: path.dirname(ffmpeg),
    version,
    hasMp3,
  };
}

function extractOnce(argv, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpeg = argv[0];
    const args = argv.slice(1);
    const child = spawn(ffmpeg, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const state = { buf: '', durationSec: null, percent: 0 };
    let stderrTail = '';

    const onChunk = (buf) => {
      if (consumeProgress(String(buf), state) && onProgress) {
        onProgress(state.percent);
      }
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', (d) => {
      const text = String(d);
      stderrTail = (stderrTail + text).slice(-4000);
      onChunk(text);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(bad('Таймаут извлечения звука', 504));
    }, config.extractAudioTimeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(bad('Не удалось запустить ffmpeg.exe — проверьте путь'));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
        return;
      }
      const useful = stderrTail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-6)
        .join('\n');
      reject(bad(useful || `ffmpeg завершился с кодом ${code}`, 502));
    });
  });
}

function safeDownloadName(originalName, ext) {
  const base = path
    .basename(originalName || 'audio', path.extname(originalName || ''))
    .replace(/[^\w.\- ()а-яА-ЯёЁ]+/g, '_')
    .slice(0, 80);
  return `${base || 'audio'}.${ext}`;
}

function startExtractJob({ ffmpegDir, sourcePath, originalName, command }) {
  const ffmpeg = resolveFfmpeg(ffmpegDir);
  const id = randomUUID();
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(originalName || '').toLowerCase() || '.dat';
  const storedSource = path.join(dir, `source${ext}`);
  fs.renameSync(sourcePath, storedSource);

  let planned;
  try {
    planned =
      command && String(command).trim()
        ? applyUserCommand(ffmpeg, storedSource, dir, command, originalName)
        : (() => {
            const outputPath = path.join(dir, defaultOutputName(originalName));
            const argv = defaultArgv(ffmpeg, storedSource, outputPath);
            return {
              argv,
              commandLine: formatCommand(argv),
              audioFile: path.basename(outputPath),
              audioExt: path.extname(outputPath).slice(1).toLowerCase(),
            };
          })();
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
    throw err;
  }

  const meta = {
    id,
    status: 'running',
    percent: 1,
    title: originalName || 'video',
    sourceFile: path.basename(storedSource),
    audioFile: planned.audioFile,
    audioExt: planned.audioExt,
    commandLine: planned.commandLine,
    downloadName: null,
    bytes: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  emitJob(meta);

  setImmediate(async () => {
    try {
      await extractOnce(planned.argv, (percent) => {
        if (meta.status !== 'running') return;
        if (percent === meta.percent) return;
        meta.percent = percent;
        emitJob(meta);
      });
      const audioPath = path.join(dir, planned.audioFile);
      const stat = fs.statSync(audioPath);
      meta.status = 'ready';
      meta.percent = 100;
      meta.audioFile = planned.audioFile;
      meta.audioExt = planned.audioExt;
      meta.downloadName = safeDownloadName(originalName, planned.audioExt);
      meta.bytes = stat.size;
      emitJob(meta);
      try {
        fs.unlinkSync(storedSource);
      } catch (_) {
        /* keep audio even if source cleanup fails */
      }
    } catch (err) {
      meta.status = 'failed';
      meta.error = err.message || 'Не удалось извлечь звук';
      emitJob(meta);
    }
  });

  return meta;
}

function subscribe(id, listener) {
  const meta = readMeta(id);
  if (!meta) return null;
  const runtime = getOrCreateRuntime(id, meta);
  runtime.emitter.on('update', listener);
  return () => runtime.emitter.off('update', listener);
}

module.exports = {
  probeFfmpeg,
  previewCommand,
  startExtractJob,
  readMeta,
  jobDir,
  publicJob,
  subscribe,
};
