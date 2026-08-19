const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const TMP = path.join(os.tmpdir(), 'vesha-media-bins');

const YTDLP_URL = {
  win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
};

const FFMPEG_URL = {
  win32:
    'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  linux:
    'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
  darwin:
    'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip',
};

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function download(url, dest) {
  console.log('Downloading', url);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'vesha-media-bins' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let lastPct = -1;
  const file = fs.createWriteStream(dest);
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    if (!total) return;
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      process.stdout.write(`  ${pct}%\n`);
    }
  });
  await pipeline(body, file);
  console.log('Saved', dest);
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function extractArchive(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = spawnSync('tar', ['-xf', archive, '-C', dest], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (tar.status === 0) return;
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${archive}" -DestinationPath "${dest}"`],
      { encoding: 'utf8', windowsHide: true }
    );
    if (ps.status === 0) return;
    throw new Error(ps.stderr || tar.stderr || `не удалось распаковать ${archive}`);
  }
  throw new Error(tar.stderr || tar.stdout || `tar failed on ${archive}`);
}

function copyTool(extractedDir, toolName) {
  const want = exe(toolName).toLowerCase();
  const found = walkFiles(extractedDir).find(
    (p) => path.basename(p).toLowerCase() === want
  );
  if (!found) throw new Error(`Не найден ${want} в архиве ffmpeg`);
  const dest = path.join(BIN, exe(toolName));
  fs.copyFileSync(found, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  console.log('Installed', dest);
}

async function main() {
  const force = process.argv.includes('--force');
  const platform = process.platform;
  if (!YTDLP_URL[platform] || !FFMPEG_URL[platform]) {
    fail(`Нет готовых бинарей для ${platform}`);
  }

  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const ytdlpDest = path.join(BIN, exe('yt-dlp'));
  const ffmpegDest = path.join(BIN, exe('ffmpeg'));
  const ffprobeDest = path.join(BIN, exe('ffprobe'));

  if (!force && fs.existsSync(ytdlpDest) && fs.existsSync(ffmpegDest) && fs.existsSync(ffprobeDest)) {
    console.log('Бинарники уже лежат в bin/. Переустановка: npm run media-bins -- --force');
    return;
  }

  if (force || !fs.existsSync(ytdlpDest)) {
    await download(YTDLP_URL[platform], ytdlpDest);
    if (platform !== 'win32') fs.chmodSync(ytdlpDest, 0o755);
  }

  if (force || !fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
    const archiveName = path.basename(new URL(FFMPEG_URL[platform]).pathname);
    const archivePath = path.join(TMP, archiveName);
    await download(FFMPEG_URL[platform], archivePath);
    const extracted = path.join(TMP, 'ffmpeg-extract');
    fs.rmSync(extracted, { recursive: true, force: true });
    extractArchive(archivePath, extracted);
    copyTool(extracted, 'ffmpeg');
    copyTool(extracted, 'ffprobe');
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(extracted, { recursive: true, force: true });
  }

  console.log('Готово. bin/:');
  for (const name of fs.readdirSync(BIN)) {
    const p = path.join(BIN, name);
    const mb = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
    console.log(`  ${name}  ${mb} MB`);
  }
}

main().catch((err) => fail(err.stack || err.message));
