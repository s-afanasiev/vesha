const fs = require('fs');
const path = require('path');
const config = require('../config');
const { jobDir, readMeta, findSourceFile } = require('./extractAudio');

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.opus']);

function jobDisplayTitle(meta) {
  if (!meta) return null;
  return (
    (meta.summary && meta.summary.title) ||
    meta.title ||
    meta.sourceTitle ||
    null
  );
}

function sourceKind(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return AUDIO_EXT.has(ext) ? 'audio' : 'video';
}

function fileInfo(filePath, extra) {
  const st = fs.statSync(filePath);
  return {
    diskName: path.basename(filePath),
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    ...extra,
  };
}

function listStoredMedia() {
  const root = config.summarizeDir;
  const jobs = [];
  if (!root || !fs.existsSync(root)) {
    return { jobs, totalBytes: 0, videoCount: 0, audioCount: 0 };
  }

  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return { jobs, totalBytes: 0, videoCount: 0, audioCount: 0 };
  }

  for (const name of names) {
    if (name === 'temp' || name.startsWith('.')) continue;
    const dir = jobDir(name);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const meta = readMeta(name);
    const id = (meta && meta.id) || name;
    const files = [];

    let sourcePath = null;
    try {
      sourcePath = findSourceFile(dir);
    } catch {
      sourcePath = null;
    }
    if (sourcePath && fs.existsSync(sourcePath)) {
      const kind = sourceKind(sourcePath);
      files.push(
        fileInfo(sourcePath, {
          kind,
          role: 'source',
          url: `/api/summarize/jobs/${id}/video`,
          downloadUrl: `/api/summarize/jobs/${id}/video?download=1`,
        })
      );
    }

    const audioName = (meta && meta.audioFile) || 'audio.wav';
    const audioPath = path.join(dir, audioName);
    if (fs.existsSync(audioPath) && audioPath !== sourcePath) {
      files.push(
        fileInfo(audioPath, {
          kind: 'audio',
          role: 'extracted',
          url: `/api/summarize/jobs/${id}/audio`,
          downloadUrl: `/api/summarize/jobs/${id}/audio?download=1`,
        })
      );
    }

    if (!files.length) continue;

    jobs.push({
      id,
      title: jobDisplayTitle(meta) || files[0].diskName,
      sourceUrl: (meta && meta.url) || null,
      createdAt: (meta && meta.createdAt) || files[0].mtime,
      duration: meta && Number.isFinite(meta.duration) ? meta.duration : null,
      status: (meta && meta.status) || null,
      files,
    });
  }

  jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let totalBytes = 0;
  let videoCount = 0;
  let audioCount = 0;
  for (const job of jobs) {
    for (const file of job.files) {
      totalBytes += file.bytes || 0;
      if (file.kind === 'video') videoCount += 1;
      else audioCount += 1;
    }
  }

  return { jobs, totalBytes, videoCount, audioCount };
}

module.exports = {
  listStoredMedia,
  jobDisplayTitle,
};
