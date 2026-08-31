const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function resolveBin(name, envPath) {
  return firstExisting([
    envPath,
    path.join(config.mediaBinDir, exe(name)),
    path.join(ROOT, 'bin', exe(name)),
  ]);
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

function requireBins({ needYtdlp = true } = {}) {
  const paths = getPaths();
  if ((needYtdlp && !paths.ytdlp) || !paths.ffmpeg) {
    const err = new Error('Нет yt-dlp/ffmpeg. Запустите npm run media-bins');
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
