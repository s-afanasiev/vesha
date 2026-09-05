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
const { transcribeAudio, summarizeText } = require('./aiSummarize');
const config = require('../config');
const {
  skipStep,
  applyStopMode,
  patchStep,
  markDone,
  sttCommand,
  summarizeCommand,
  buildUrlSteps,
  buildFileSteps,
} = require('./jobSteps');
const { touchHistory } = require('./summarizeHistory');

const MAX_QUEUE = 30;

const waiting = [];
const live = new Map();
let runningId = null;
let pumping = false;

function normalizeSttProvider(v) {
  return String(v || '').toLowerCase() === 'gemini' ? 'gemini' : 'whisper';
}

function normalizeSummarizeProvider(v) {
  return String(v || '').toLowerCase() === 'openai' ? 'openai' : 'gemini';
}

function secretCreds(input) {
  return {
    sttProvider: normalizeSttProvider(input && input.sttProvider),
    sttApiKey: String((input && input.sttApiKey) || '').trim(),
    summarizeProvider: normalizeSummarizeProvider(input && input.summarizeProvider),
    summarizeApiKey: String((input && input.summarizeApiKey) || '').trim(),
  };
}

function credsOf(id) {
  const job = live.get(id);
  return (job && job.creds) || secretCreds({});
}

function runningLabel(job) {
  if (!job) return null;
  if (job.kind === 'summarize-only') return 'суммаризация текста';
  if (job.kind === 'transcribe-only') return 'распознавание речи';
  if (job.audioOnly) return 'извлечение аудио';
  if (job.transcriptOnly) return 'расшифровка без суммаризации';
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
  delete next.sttApiKey;
  delete next.summarizeApiKey;
  delete next.creds;
  delete next.apiKey;
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
    next.transcriptOnly ? 1 : 0,
    next.audioFile || '',
    next.bytes || 0,
    Math.round(next.duration || 0),
    next.error || '',
    next.summary ? 1 : 0,
    next.transcript ? 1 : 0,
  ].join('|');
  if (lastHistoryKey.get(id) !== histKey) {
    lastHistoryKey.set(id, histKey);
    touchHistory(id, { userId: next.userId, guestId: next.guestId });
  }
  return next;
}

function writeTranscriptFile(id, transcript) {
  const file = path.join(jobDir(id), 'transcript.txt');
  fs.writeFileSync(file, String(transcript || ''), 'utf8');
  return 'transcript.txt';
}

async function runTranscribePhase(id) {
  const meta = readMeta(id) || {};
  const creds = credsOf(id);
  let steps = patchStep(meta.steps || [], 'stt', {
    status: 'active',
    progress: 0,
    indeterminate: true,
    command: sttCommand(creds.sttProvider),
    detail: 'Отправляем audio.wav на распознавание речи…',
  });
  persist(id, {
    status: 'running',
    phase: 'transcribing',
    aiError: null,
    steps,
  });

  const audioPath = meta.audioFile ? path.join(jobDir(id), meta.audioFile) : null;
  const ai = await transcribeAudio({
    audioPath,
    provider: creds.sttProvider,
    apiKey: creds.sttApiKey,
    onProgress: (patch) => {
      steps = patchStep(steps, 'stt', {
        status: 'active',
        indeterminate: true,
        ...patch,
      });
      persist(id, { steps, phase: 'transcribing' });
    },
  });

  const transcript = String(ai.transcript || '').trim();
  if (!transcript) throw new Error('Пустая расшифровка');
  const transcriptFile = writeTranscriptFile(id, transcript);
  steps = markDone(steps, 'stt', ai.model ? `Готово (${ai.provider} / ${ai.model})` : 'Готово');
  persist(id, {
    steps,
    transcript,
    transcriptFile,
    sttProvider: ai.provider || null,
    sttModel: ai.model || null,
    phase: 'transcribed',
  });
  return transcript;
}

async function runSummarizePhase(id, transcriptOverride) {
  const meta = readMeta(id) || {};
  const creds = credsOf(id);
  const transcript = String(transcriptOverride || meta.transcript || '').trim();
  if (!transcript) throw new Error('Нет текста для суммаризации — сначала распознайте речь');

  let steps = patchStep(meta.steps || [], 'summarize', {
    status: 'active',
    progress: 0,
    indeterminate: true,
    command: summarizeCommand(creds.summarizeProvider),
    detail: 'Отправляем расшифровку в нейросеть…',
  });
  persist(id, {
    status: 'running',
    phase: 'summarizing',
    audioOnly: false,
    transcriptOnly: false,
    summary: null,
    provider: null,
    model: null,
    aiError: null,
    transcript,
    steps,
  });

  const ai = await summarizeText({
    transcript,
    provider: creds.summarizeProvider,
    apiKey: creds.summarizeApiKey,
    onProgress: (patch) => {
      steps = patchStep(steps, 'summarize', {
        status: 'active',
        indeterminate: true,
        ...patch,
      });
      persist(id, { steps, phase: 'summarizing' });
    },
  });

  if (!['gemini', 'openai', 'mock'].includes(ai.provider) && !config.summarizeMock) {
    throw new Error(ai.error || 'Суммаризация не удалась');
  }

  steps = markDone(steps, 'summarize', ai.model ? `Готово (${ai.provider} / ${ai.model})` : 'Готово');
  persist(id, {
    status: 'ready',
    phase: 'done',
    audioOnly: false,
    transcriptOnly: false,
    steps,
    summary: ai.summary || null,
    provider: ai.provider || null,
    model: ai.model || null,
    aiError: ai.error || null,
    completedAt: new Date().toISOString(),
  });
}

async function runJob(job) {
  if (job.kind !== 'summarize-only' && job.kind !== 'transcribe-only') {
    persist(job.id, {
      status: 'running',
      phase: job.kind === 'url' ? 'downloading' : 'extracting',
      error: null,
      summary: null,
      transcript: null,
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
      const steps = applyStopMode(afterExtract.steps || [], { audioOnly: true });
      persist(job.id, {
        status: 'audio_ready',
        phase: 'audio',
        audioOnly: true,
        transcriptOnly: false,
        steps,
        completedAt: new Date().toISOString(),
      });
      return;
    }
  }

  if (job.kind !== 'summarize-only') {
    await runTranscribePhase(job.id);
    if (job.transcriptOnly) {
      const afterStt = readMeta(job.id) || {};
      persist(job.id, {
        status: 'transcript_ready',
        phase: 'transcript',
        audioOnly: false,
        transcriptOnly: true,
        steps: skipStep(
          afterStt.steps || [],
          'summarize',
          'Расшифровка готова. Суммаризация не запускалась — можно запросить тезисы.'
        ),
        completedAt: new Date().toISOString(),
      });
      return;
    }
  }

  await runSummarizePhase(job.id, job.transcriptOverride);
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
        const active = ((meta && meta.steps) || []).find((s) => s.status === 'active');
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

function assertQueueSlot() {
  if (waiting.length + (runningId ? 1 : 0) >= MAX_QUEUE) {
    const err = new Error('Очередь переполнена, попробуйте позже');
    err.status = 429;
    throw err;
  }
}

function enqueue(input) {
  assertQueueSlot();

  const id = input.id || randomUUID();
  const historyKind = inferHistoryKind(input.kind, input.sourceTitle);
  const audioOnly = Boolean(input.audioOnly) && !input.transcriptOnly;
  const transcriptOnly = Boolean(input.transcriptOnly) && !audioOnly;
  const job = {
    id,
    kind: input.kind,
    url: input.url || null,
    title: input.title || null,
    audioOnly,
    transcriptOnly,
    status: 'queued',
    phase: 'queued',
    createdAt: new Date().toISOString(),
    creds: secretCreds(input),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    kind: job.kind,
    historyKind,
    url: job.url,
    title: job.title,
    audioOnly,
    transcriptOnly,
    sourceTitle: input.sourceTitle || job.title,
    sourceBytes: input.sourceBytes || null,
    userId: input.userId || null,
    guestId: input.guestId || null,
    createdAt: job.createdAt,
    summary: null,
    transcript: null,
    provider: null,
    model: null,
    aiError: null,
    error: null,
    steps:
      job.kind === 'url'
        ? buildUrlSteps(job.url, { audioOnly, transcriptOnly })
        : buildFileSteps(input.sourceTitle, { audioOnly, transcriptOnly }),
  });
  waiting.push(id);
  pump();
  return view(id);
}

function enqueueUrl(rawUrl, opts = {}) {
  const url = assertHttpUrl(rawUrl);
  let title = 'Ссылка';
  try {
    title = new URL(url).hostname;
  } catch (_) {
    // keep default
  }
  return enqueue({ kind: 'url', url, title, ...opts });
}

function enqueueFile(opts = {}) {
  return enqueue({
    ...opts,
    kind: /^mic_record/i.test(opts.sourceTitle || '') ? 'mic' : 'file',
    title: opts.sourceTitle || 'Файл',
  });
}

function ensureNotBusy(id) {
  if (runningId === id || waiting.includes(id) || live.has(id)) {
    return true;
  }
  return false;
}

function enqueueTranscribe(id, opts = {}) {
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
  if (meta.transcript && !opts.force) {
    if (opts.continueToSummary) {
      return enqueueSummarize(id, opts);
    }
    return view(id);
  }
  if (ensureNotBusy(id)) return view(id);
  assertQueueSlot();

  const job = {
    id,
    kind: 'transcribe-only',
    url: meta.url || null,
    title: meta.title || meta.sourceTitle || 'Распознавание',
    audioOnly: false,
    transcriptOnly: !opts.continueToSummary,
    status: 'queued',
    phase: 'queued',
    createdAt: meta.createdAt || new Date().toISOString(),
    creds: secretCreds(opts),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    audioOnly: false,
    transcriptOnly: job.transcriptOnly,
    error: null,
    aiError: null,
    steps: patchStep(meta.steps || [], 'stt', {
      status: 'pending',
      progress: 0,
      indeterminate: false,
      command: sttCommand(job.creds.sttProvider),
      waitHint: 'В очереди. Аудио уже готово, скачивать заново не будем.',
      detail: 'В очереди на распознавание речи.',
    }),
  });
  waiting.push(id);
  pump();
  return view(id);
}

function enqueueSummarize(id, opts = {}) {
  const meta = readMeta(id);
  if (!meta) {
    const err = new Error('Задание не найдено');
    err.status = 404;
    throw err;
  }
  const transcript = String(opts.transcript || meta.transcript || '').trim();
  if (!transcript) {
    if (meta.audioFile) {
      return enqueueTranscribe(id, { ...opts, continueToSummary: true });
    }
    const err = new Error('Нет расшифровки — сначала распознайте речь');
    err.status = 400;
    throw err;
  }
  if (opts.transcript) {
    writeTranscriptFile(id, transcript);
  }
  if (meta.summary && meta.status === 'ready' && !opts.transcript) {
    return view(id);
  }
  if (ensureNotBusy(id)) return view(id);
  assertQueueSlot();

  const job = {
    id,
    kind: 'summarize-only',
    url: meta.url || null,
    title: meta.title || meta.sourceTitle || 'Суммаризация',
    audioOnly: false,
    transcriptOnly: false,
    transcriptOverride: transcript,
    status: 'queued',
    phase: 'queued',
    createdAt: meta.createdAt || new Date().toISOString(),
    creds: secretCreds(opts),
  };
  live.set(id, job);
  persist(id, {
    status: 'queued',
    phase: 'queued',
    audioOnly: false,
    transcriptOnly: false,
    transcript,
    transcriptFile: meta.transcriptFile || 'transcript.txt',
    error: null,
    summary: null,
    provider: null,
    model: null,
    aiError: null,
    steps: patchStep(meta.steps || [], 'summarize', {
      status: 'pending',
      progress: 0,
      indeterminate: false,
      command: summarizeCommand(job.creds.summarizeProvider),
      waitHint: 'В очереди. Текст уже есть, аудио заново не отправляем.',
      detail: 'В очереди на суммаризацию текста.',
    }),
  });
  waiting.push(id);
  pump();
  return view(id);
}

module.exports = {
  enqueueUrl,
  enqueueFile,
  enqueueTranscribe,
  enqueueSummarize,
  view,
  snapshot,
  MAX_QUEUE,
};
