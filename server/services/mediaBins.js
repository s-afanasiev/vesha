const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');

function peekMagic(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n);
  } catch {
    return null;
  }
}

function isWindowsPe(file) {
  const buf = peekMagic(file);
  return Boolean(buf && buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a);
}

function isElf(file) {
  const buf = peekMagic(file);
  return Boolean(
    buf &&
      buf.length >= 4 &&
      buf[0] === 0x7f &&
      buf[1] === 0x45 &&
      buf[2] === 0x4c &&
      buf[3] === 0x46
  );
}

function isUsableOnThisOs(file) {
  if (process.platform === 'win32') return !isElf(file);
  if (isWindowsPe(file)) return false;
  if (path.extname(file).toLowerCase() === '.exe') return false;
  return true;
}

function fileNamesFor(name) {
  if (process.platform === 'win32') return [`${name}.exe`, name];
  const names = [name];
  if (name === 'yt-dlp') names.push('yt-dlp_linux');
  return names;
}

function firstExistingFile(candidates) {
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile() && isUsableOnThisOs(p)) return p;
    } catch (_) {
      // skip
    }
  }
  return null;
}

function ensureExecutable(file) {
  if (!file || process.platform === 'win32') return file;
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(file, 0o755);
    } catch (_) {
      // may be owned by another user; spawn will fail later
    }
  }
  return file;
}

function resolveBin(name, envPath) {
  const dirs = [...new Set([config.mediaBinDir, path.join(ROOT, 'bin')].filter(Boolean))];
  const candidates = [];
  if (envPath) candidates.push(envPath);
  for (const dir of dirs) {
    for (const fileName of fileNamesFor(name)) {
      candidates.push(path.join(dir, fileName));
    }
  }
  if (process.platform !== 'win32') {
    candidates.push(`/usr/local/bin/${name}`, `/usr/bin/${name}`);
  }
  return ensureExecutable(firstExistingFile(candidates));
}

function getPaths() {
  return {
    ytdlp: resolveBin('yt-dlp', config.ytdlpPath),
    ffmpeg: resolveBin('ffmpeg', config.ffmpegPath),
    ffprobe: resolveBin('ffprobe', config.ffprobePath),
  };
}

function run(cmd, args, { timeoutMs = 10 * 60 * 1000, cwd, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const handle = (chunk, stream) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      if (onOutput) {
        try {
          onOutput(text, stream);
        } catch (_) {
          // progress hooks must not kill the process
        }
      }
    };
    child.stdout.on('data', (d) => handle(d, 'stdout'));
    child.stderr.on('data', (d) => handle(d, 'stderr'));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error('Таймаут запуска ' + path.basename(cmd));
      err.status = 504;
      reject(err);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        const missing = new Error(`Не найден бинарь ${cmd}. Запустите npm run media-bins`);
        missing.status = 500;
        reject(missing);
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
      const err = new Error(lastUsefulLine(stderr || stdout) || `${path.basename(cmd)} exited ${code}`);
      err.status = 502;
      err.stderr = stderr;
      reject(err);
    });
  });
}

function lastUsefulLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n');
}

function versionLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || '';
}

async function toolVersion(bin, args) {
  if (!bin) return null;
  try {
    const { stdout, stderr } = await run(bin, args, { timeoutMs: 15000 });
    return versionLine(stdout || stderr);
  } catch {
    return null;
  }
}

async function getToolStatus() {
  const paths = getPaths();
  const [ytdlp, ffmpeg, ffprobe] = await Promise.all([
    toolVersion(paths.ytdlp, ['--version']),
    toolVersion(paths.ffmpeg, ['-version']),
    toolVersion(paths.ffprobe, ['-version']),
  ]);
  return {
    ready: Boolean(paths.ytdlp && paths.ffmpeg && paths.ffprobe),
    ytdlp: { path: paths.ytdlp, version: ytdlp },
    ffmpeg: { path: paths.ffmpeg, version: ffmpeg },
    ffprobe: { path: paths.ffprobe, version: ffprobe },
  };
}

function listBinDir() {
  const dir = path.join(ROOT, 'bin');
  try {
    return fs.readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        if (isWindowsPe(full)) return `${name} (Windows .exe, на Linux не запустится)`;
        return name;
      })
      .join(', ');
  } catch {
    return '(папка bin/ не читается)';
  }
}

function requireBins({ needYtdlp = true } = {}) {
  const paths = getPaths();
  const missing = [];
  if (needYtdlp && !paths.ytdlp) missing.push('yt-dlp');
  if (!paths.ffmpeg) missing.push('ffmpeg');
  if (missing.length) {
    const err = new Error(
      `Нет Linux-бинарей: ${missing.join(' и ')}. ` +
        `Файл yt-dlp.exe / ffmpeg.exe с Windows через WinSCP не подойдёт — это PE (заголовок MZ), Linux его не запускает. ` +
        `Нужны ELF: bin/yt-dlp, bin/ffmpeg, bin/ffprobe. Сейчас в bin/: ${listBinDir()}. ` +
        `На VDS выполните: npm run media-bins -- --force`
    );
    err.status = 500;
    throw err;
  }
  return paths;
}

module.exports = {
  getPaths,
  getToolStatus,
  requireBins,
  run,
};
