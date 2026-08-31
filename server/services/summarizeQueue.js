const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  extractAudioFromUrl,
  extractAudioFromFile,
  readMeta,
  writeMeta,
  jobDir,
  publicJob,
  assertHttpUrl,
} = require('./extractAudio');
const { summarizeWithGemini } = require('./aiSummarize');
const { buildUrlSteps, buildFileSteps, patchStep, markDone } = require('./jobSteps');

const MAX_QUEUE = 30;

const waiting = [];
const live = new Map();
let runningId = null;
let pumping = false;

function runningLabel(job) {
  if (!job) return null;
  if (job.kind === 'url') return 'суммаризация по ссылке';
  if (job.kind === 'file') return 'суммаризация файла';
  return 'суммаризация';
}

function snapshot() {
  const running = runningId ? live.get(runningId) || null : null;
  return {
    running: running
      ? { id: running.id, kind: running.kind, label: runningLabel(running) }
      : null,
    waiting: waiting.length,
    total: waiting.length + (runningId ? 1 : 0),
  };
}

function queueFor(id) {
  const snap = snapshot();
  if (id === runningId) {
    return {
      ...snap,
      you: 'running',
      ahead: 0,
      position: 1,
    };
  }
  const idx = waiting.indexOf(id);
  if (idx < 0) {
    return {
      ...snap,
      you: 'none',
      ahead: 0,
      position: null,
    };
  }
  const ahead = idx + (runningId ? 1 : 0);
  return {
    ...snap,
    you: 'queued',
    ahead,
    position: ahead + 1,
  };
}

function view(id) {
  const meta = readMeta(id);
  if (!meta && !live.has(id)) return null;
  const job = live.get(id);
  const base = publicJob(
    meta || {
      id,
      status: job?.status || 'queued',
      phase: job?.phase || 'queued',
      title: job?.title || null,
      createdAt: job?.createdAt,
    }
  );
  return {
    ...base,
    kind: (meta && meta.kind) || (job && job.kind) || null,
    queue: queueFor(id),
  };
}

function persist(id, patch) {
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const prev = readMeta(id) || { id, createdAt: new Date().toISOString() };
  const next = { ...prev, ...patch, id };
  writeMeta(id, next);
  const mem = live.get(id);
  if (mem) {
    if (patch.status) mem.status = patch.status;
    if (patch.phase) mem.phase = patch.phase;
    if (patch.title) mem.title = patch.title;
  }
  return next;
}

async function runJob(job) {
  persist(job.id, { status: 'running', phase: job.kind === 'url' ? 'downloading' : 'extracting', error: null });

  const onProgress = (meta) => persist(job.id, meta);

  if (job.kind === 'url') {
    await extractAudioFromUrl(job.url, { jobId: job.id, leaveStatus: true, onProgress });
  } else {
    await extractAudioFromFile(job.id, { onProgress });
  }

  const afterExtract = readMeta(job.id) || {};
  let steps = patchStep(afterExtract.steps || [], 'summarize', {
    status: 'active',
    progress: null,
    detail: 'Отправляем audio.wav в Gemini…',
  });
  persist(job.id, { status: 'running', phase: 'summarizing', steps });

  const audioPath = afterExtract.audioFile
    ? path.join(jobDir(job.id), afterExtract.audioFile)
    : null;
  const audioMime = audioPath && audioPath.endsWith('.mp3')
    ? 'audio/mp3'
    : audioPath && audioPath.endsWith('.m4a')
      ? 'audio/m4a'
      : 'audio/wav';

  const ai = await summarizeWithGemini({
    audioPath,
    audioMime,
    transcriptText: '',
  });

  steps = markDone(steps, 'summarize', ai.model ? `Готово (${ai.provider} / ${ai.model})` : 'Готово');
  persist(job.id, {
    status: 'ready',
    phase: 'done',
    steps,
    summary: ai.summary || null,
    provider: ai.provider || null,
    model: ai.model || null,
    aiError: ai.error || null,
    completedAt: new Date().toISOString(),
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (waiting.length) {
      const id = waiting.shift();
      const job = live.get(id);
      if (!job) continue;
      runningId = id;
      job.status = 'running';
      job.phase = 'extracting';
      try {
        await runJob(job);
      } catch (err) {
        const meta = readMeta(id);
        const active = (meta && meta.steps || []).find((s) => s.status === 'active');
        persist(id, {
          status: 'failed',
          phase: 'failed',
          error: err.message || 'Ошибка обработки',
          steps: active
            ? patchStep(meta.steps, active.id, { status: 'failed', detail: err.message })
            : meta && meta.steps,
        });
      } finally {
        runningId = null;
        live.delete(id);
      }
    }
  } finally {
    pumping = false;
    if (waiting.length && !runningId) pump();
  }
}

function enqueue(input) {
  if (waiting.length + (runningId ? 1 : 0) >= MAX_QUEUE) {
    const err = new Error('Очередь переполнена, попробуйте позже');
    err.status = 429;
    throw err;
  }

  const id = input.id || randomUUID();
  const job = {
    id,
    kind: input.kind,
    url: input.url || null,
    title: input.title || null,
    status: 'queued',
    phase: 'queued',
    createdAt: new Date().toISOString(),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    kind: job.kind,
    url: job.url,
    title: job.title,
    sourceTitle: input.sourceTitle || job.title,
    createdAt: job.createdAt,
    steps:
      job.kind === 'url'
        ? buildUrlSteps(job.url)
        : buildFileSteps(input.sourceTitle),
  });
  waiting.push(id);
  pump();
  return view(id);
}

function enqueueUrl(rawUrl) {
  const url = assertHttpUrl(rawUrl);
  let title = 'Ссылка';
  try {
    title = new URL(url).hostname;
  } catch (_) {
    // keep default
  }
  return enqueue({ kind: 'url', url, title });
}

function enqueueFile({ id, sourceTitle }) {
  return enqueue({
    id,
    kind: 'file',
    title: sourceTitle || 'Файл',
    sourceTitle,
  });
}

module.exports = {
  enqueueUrl,
  enqueueFile,
  view,
  snapshot,
  MAX_QUEUE,
};
