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
const config = require('../config');
const { skipSummarizeStep, patchStep, markDone, geminiCommand, buildUrlSteps, buildFileSteps } = require('./jobSteps');
const { touchHistory } = require('./summarizeHistory');

const MAX_QUEUE = 30;

const waiting = [];
const live = new Map();
let runningId = null;
let pumping = false;

function runningLabel(job) {
  if (!job) return null;
  if (job.kind === 'summarize-only') return 'суммаризация готового аудио';
  if (job.audioOnly) return 'извлечение аудио';
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

const lastHistoryKey = new Map();

function persist(id, patch) {
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const prev = readMeta(id) || { id, createdAt: new Date().toISOString() };
  const next = { ...prev, ...patch, id };
  if (!next.userId) next.userId = prev.userId || null;
  if (!next.guestId) next.guestId = prev.guestId || null;
  writeMeta(id, next);
  const mem = live.get(id);
  if (mem) {
    if (patch.status) mem.status = patch.status;
    if (patch.phase) mem.phase = patch.phase;
    if (patch.title) mem.title = patch.title;
  }
  const histKey = [
    next.status,
    next.audioOnly ? 1 : 0,
    next.audioFile || '',
    next.bytes || 0,
    Math.round(next.duration || 0),
    next.error || '',
    next.summary ? 1 : 0,
  ].join('|');
  if (lastHistoryKey.get(id) !== histKey) {
    lastHistoryKey.set(id, histKey);
    touchHistory(id, { userId: next.userId, guestId: next.guestId });
  }
  return next;
}

async function runSummarizePhase(id) {
  const afterExtract = readMeta(id) || {};
  let steps = patchStep(afterExtract.steps || [], 'summarize', {
    status: 'active',
    progress: 0,
    indeterminate: true,
    command: geminiCommand(),
    detail: 'Отправляем audio.wav в Gemini…',
  });
  persist(id, {
    status: 'running',
    phase: 'summarizing',
    audioOnly: false,
    summary: null,
    provider: null,
    model: null,
    aiError: null,
    steps,
  });

  const audioPath = afterExtract.audioFile
    ? path.join(jobDir(id), afterExtract.audioFile)
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
    onProgress: (patch) => {
      steps = patchStep(steps, 'summarize', {
        status: 'active',
        indeterminate: true,
        ...patch,
      });
      persist(id, { steps, phase: 'summarizing' });
    },
  });

  if (ai.provider !== 'gemini' && !config.summarizeMock) {
    throw new Error(ai.error || 'Суммаризация не от Gemini — заглушка отключена');
  }

  steps = markDone(steps, 'summarize', ai.model ? `Готово (${ai.provider} / ${ai.model})` : 'Готово');
  persist(id, {
    status: 'ready',
    phase: 'done',
    audioOnly: false,
    steps,
    summary: ai.summary || null,
    provider: ai.provider || null,
    model: ai.model || null,
    aiError: ai.error || null,
    completedAt: new Date().toISOString(),
  });
}

async function runJob(job) {
  if (job.kind !== 'summarize-only') {
    persist(job.id, {
      status: 'running',
      phase: job.kind === 'url' ? 'downloading' : 'extracting',
      error: null,
      summary: null,
      provider: null,
      model: null,
      aiError: null,
      startedAt: new Date().toISOString(),
    });

    const onProgress = (meta) => persist(job.id, meta);

    if (job.kind === 'url') {
      await extractAudioFromUrl(job.url, { jobId: job.id, leaveStatus: true, onProgress });
    } else {
      await extractAudioFromFile(job.id, { onProgress });
    }

    const afterExtract = readMeta(job.id) || {};
    if (job.audioOnly) {
      const steps = skipSummarizeStep(
        afterExtract.steps || [],
        'Аудио готово. Распознавание не запускалось — можно запросить суммаризацию.'
      );
      persist(job.id, {
        status: 'audio_ready',
        phase: 'audio',
        audioOnly: true,
        steps,
        completedAt: new Date().toISOString(),
      });
      return;
    }
  }

  await runSummarizePhase(job.id);
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
          completedAt: new Date().toISOString(),
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

function inferHistoryKind(kind, sourceTitle) {
  if (kind === 'url') return 'url';
  if (kind === 'mic' || /^mic_record/i.test(sourceTitle || '')) return 'mic';
  return 'file';
}

function enqueue(input) {
  if (waiting.length + (runningId ? 1 : 0) >= MAX_QUEUE) {
    const err = new Error('Очередь переполнена, попробуйте позже');
    err.status = 429;
    throw err;
  }

  const id = input.id || randomUUID();
  const historyKind = inferHistoryKind(input.kind, input.sourceTitle);
  const job = {
    id,
    kind: input.kind,
    url: input.url || null,
    title: input.title || null,
    audioOnly: Boolean(input.audioOnly),
    status: 'queued',
    phase: 'queued',
    createdAt: new Date().toISOString(),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    kind: job.kind,
    historyKind,
    url: job.url,
    title: job.title,
    audioOnly: job.audioOnly,
    sourceTitle: input.sourceTitle || job.title,
    sourceBytes: input.sourceBytes || null,
    userId: input.userId || null,
    guestId: input.guestId || null,
    createdAt: job.createdAt,
    summary: null,
    provider: null,
    model: null,
    aiError: null,
    error: null,
    steps:
      job.kind === 'url'
        ? buildUrlSteps(job.url, { audioOnly: job.audioOnly })
        : buildFileSteps(input.sourceTitle, { audioOnly: job.audioOnly }),
  });
  waiting.push(id);
  pump();
  return view(id);
}

function enqueueUrl(rawUrl, { audioOnly = false, userId = null, guestId = null } = {}) {
  const url = assertHttpUrl(rawUrl);
  let title = 'Ссылка';
  try {
    title = new URL(url).hostname;
  } catch (_) {
    // keep default
  }
  return enqueue({ kind: 'url', url, title, audioOnly, userId, guestId });
}

function enqueueFile({ id, sourceTitle, audioOnly = false, sourceBytes, userId = null, guestId = null }) {
  return enqueue({
    id,
    kind: /^mic_record/i.test(sourceTitle || '') ? 'mic' : 'file',
    title: sourceTitle || 'Файл',
    sourceTitle,
    sourceBytes,
    audioOnly,
    userId,
    guestId,
  });
}

function enqueueSummarize(id) {
  const meta = readMeta(id);
  if (!meta) {
    const err = new Error('Задание не найдено');
    err.status = 404;
    throw err;
  }
  if (!meta.audioFile) {
    const err = new Error('Аудио ещё нет — сначала извлеките звук');
    err.status = 400;
    throw err;
  }
  if (meta.summary && meta.status === 'ready') {
    return view(id);
  }
  if (runningId === id || waiting.includes(id) || live.has(id)) {
    return view(id);
  }
  if (waiting.length + (runningId ? 1 : 0) >= MAX_QUEUE) {
    const err = new Error('Очередь переполнена, попробуйте позже');
    err.status = 429;
    throw err;
  }

  const job = {
    id,
    kind: 'summarize-only',
    url: meta.url || null,
    title: meta.title || meta.sourceTitle || 'Суммаризация',
    audioOnly: false,
    status: 'queued',
    phase: 'queued',
    createdAt: meta.createdAt || new Date().toISOString(),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    audioOnly: false,
    error: null,
    summary: null,
    provider: null,
    model: null,
    aiError: null,
    steps: patchStep(meta.steps || [], 'summarize', {
      status: 'pending',
      progress: 0,
      indeterminate: false,
      command: geminiCommand(),
      waitHint: 'В очереди. Аудио уже готово, скачивать заново не будем.',
      detail: 'В очереди на распознавание и суммаризацию.',
    }),
  });
  waiting.push(id);
  pump();
  return view(id);
}

module.exports = {
  enqueueUrl,
  enqueueFile,
  enqueueSummarize,
  view,
  snapshot,
  MAX_QUEUE,
};
