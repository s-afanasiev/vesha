(function () {
  // Elements
  const toolsStatusEl = document.getElementById('tools-status');
  const tabs = document.querySelectorAll('.summarize-tab');
  const panels = document.querySelectorAll('.summarize-panel');
  const fileDropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-input');
  const fileChosen = document.getElementById('file-chosen');
  const fileNameEl = document.getElementById('file-name');
  const fileSizeEl = document.getElementById('file-size');
  const fileClearBtn = document.getElementById('file-clear');
  const urlInput = document.getElementById('url-input');
  const micToggleBtn = document.getElementById('mic-toggle-btn');
  const micStatusText = document.getElementById('mic-status-text');
  const micTimer = document.getElementById('mic-timer');
  const processBtn = document.getElementById('process-btn');
  const processBtnLabel = document.getElementById('process-btn-label');
  const audioOnlyEl = document.getElementById('audio-only');
  const transcriptOnlyEl = document.getElementById('transcript-only');
  const sttApiKeyEl = document.getElementById('stt-api-key');
  const summarizeApiKeyEl = document.getElementById('summarize-api-key');
  const audioReadyBar = document.getElementById('audio-ready-bar');
  const audioReadyLead = document.getElementById('audio-ready-lead');
  const continueTranscribeBtn = document.getElementById('continue-transcribe-btn');
  const continueSummarizeBtn = document.getElementById('continue-summarize-btn');
  const downloadWavLink = document.getElementById('download-wav-link');
  const downloadMp3Link = document.getElementById('download-mp3-link');
  const downloadTranscriptLink = document.getElementById('download-transcript-link');

  const runLog = document.getElementById('run-log');
  const runLogTitle = document.getElementById('run-log-title');
  const runLogLead = document.getElementById('run-log-lead');
  const runSteps = document.getElementById('run-steps');
  const queueCard = document.getElementById('queue-card');
  const queueTitle = document.getElementById('queue-title');
  const queueLead = document.getElementById('queue-lead');
  const queueRunning = document.getElementById('queue-running');
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');

  const resultSection = document.getElementById('result');
  const resultTitle = document.getElementById('result-title');
  const resultMetaTags = document.getElementById('result-meta-tags');
  const player = document.getElementById('player');
  const outputTabs = document.querySelectorAll('.output-tab');
  const outputPanels = document.querySelectorAll('.output-panel');

  const outputTldr = document.getElementById('output-tldr');
  const outputKeypoints = document.getElementById('output-keypoints');
  const outputTimeline = document.getElementById('output-timeline');
  const outputActions = document.getElementById('output-actions');
  const outputTranscript = document.getElementById('output-transcript');
  const transcriptSearch = document.getElementById('transcript-search');

  const copyMdBtn = document.getElementById('copy-md-btn');
  const downloadTxtBtn = document.getElementById('download-txt-btn');
  const copyTranscriptBtn = document.getElementById('copy-transcript-btn');
  const historyBtn = document.getElementById('history-btn');
  const historyClose = document.getElementById('history-close');
  const historyPanel = document.getElementById('history-panel');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const historyError = document.getElementById('history-error');
  const filesBtn = document.getElementById('files-btn');
  const filesModal = document.getElementById('files-modal');
  const filesModalHint = document.getElementById('files-modal-hint');
  const filesModalList = document.getElementById('files-modal-list');
  const filesModalEmpty = document.getElementById('files-modal-empty');
  const filesModalError = document.getElementById('files-modal-error');

  // State
  let currentFile = null;
  let currentAudioBlob = null;
  let currentJobData = null;
  let currentSummaryData = null;
  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordTimerInterval = null;
  let recordSeconds = 0;
  let pollTimer = null;
  let elapsedTimer = null;
  let latestSteps = [];
  let latestJobStatus = '';
  let latestJob = null;

  // Format helpers
  function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return '00:00';
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function formatClock(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '—';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function formatElapsedMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec} с`;
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    if (m < 60) return r ? `${m} мин ${r} с` : `${m} мин`;
    const h = Math.floor(m / 60);
    return `${h} ч ${m % 60} мин`;
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function showStatus(text) {
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
  }

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  function htmlToError(status, text) {
    const plain = String(text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (status === 504 || /504|Gateway Time/i.test(text)) {
      return {
        message:
          'Прокси оборвал ожидание (504). В nginx поставьте proxy_read_timeout 600s; задача на сервере могла продолжиться — откройте историю через минуту.',
        retryable: true,
      };
    }
    if (status === 502 || status === 503 || /Bad Gateway/i.test(text)) {
      return {
        message: 'Сервер временно не ответил (502/503). Если суммаризация ещё идёт, продолжаем ждать…',
        retryable: true,
      };
    }
    return {
      message: `Сервер вернул HTML вместо JSON (HTTP ${status || '?'}). ${plain}`,
      retryable: false,
    };
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const raw = await res.text();
    const trimmed = String(raw || '').trim();
    if (trimmed.startsWith('<') || /^<!doctype html/i.test(trimmed)) {
      const info = htmlToError(res.status, trimmed);
      const err = new Error(info.message);
      err.retryable = info.retryable;
      err.status = res.status;
      throw err;
    }
    let data = {};
    if (trimmed) {
      try {
        data = JSON.parse(trimmed);
      } catch (err) {
        const wrapped = new Error('Ответ сервера не JSON: ' + err.message);
        wrapped.retryable = res.status >= 502;
        throw wrapped;
      }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Ошибка запроса');
      err.status = res.status;
      err.retryable = res.status === 502 || res.status === 503 || res.status === 504;
      throw err;
    }
    return data;
  }

  function mediaSrc(url, job) {
    if (!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}v=${encodeURIComponent((job && job.id) || '')}-${(job && job.bytes) || 0}`;
  }

  function resetResultView() {
    currentSummaryData = null;
    currentJobData = null;
    resultSection.hidden = true;
    resultTitle.textContent = 'Результат суммаризации';
    resultMetaTags.innerHTML = '';
    outputTldr.textContent = '';
    outputKeypoints.innerHTML = '';
    outputTimeline.innerHTML = '';
    outputActions.innerHTML = '';
    outputTranscript.textContent = '';
    try {
      player.removeAttribute('src');
      player.load();
    } catch (_) {}
  }

  const KEYS_STORAGE = 'vesha-summarize-ai-keys';

  function radioValue(name, fallback) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return (el && el.value) || fallback;
  }

  function setRadioValue(name, value) {
    const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function loadSavedKeys() {
    try {
      const raw = localStorage.getItem(KEYS_STORAGE);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.sttProvider) setRadioValue('stt-provider', data.sttProvider);
      if (data.summarizeProvider) setRadioValue('summarize-provider', data.summarizeProvider);
      if (sttApiKeyEl && data.sttApiKey) sttApiKeyEl.value = data.sttApiKey;
      if (summarizeApiKeyEl && data.summarizeApiKey) summarizeApiKeyEl.value = data.summarizeApiKey;
    } catch (_) {}
  }

  function saveKeys() {
    try {
      localStorage.setItem(
        KEYS_STORAGE,
        JSON.stringify({
          sttProvider: radioValue('stt-provider', 'whisper'),
          summarizeProvider: radioValue('summarize-provider', 'gemini'),
          sttApiKey: sttApiKeyEl ? sttApiKeyEl.value : '',
          summarizeApiKey: summarizeApiKeyEl ? summarizeApiKeyEl.value : '',
        })
      );
    } catch (_) {}
  }

  function collectAiOptions() {
    saveKeys();
    return {
      sttProvider: radioValue('stt-provider', 'whisper'),
      sttApiKey: sttApiKeyEl ? sttApiKeyEl.value.trim() : '',
      summarizeProvider: radioValue('summarize-provider', 'gemini'),
      summarizeApiKey: summarizeApiKeyEl ? summarizeApiKeyEl.value.trim() : '',
    };
  }

  function isAudioOnly() {
    return Boolean(audioOnlyEl && audioOnlyEl.checked);
  }

  function isTranscriptOnly() {
    return Boolean(transcriptOnlyEl && transcriptOnlyEl.checked);
  }

  function stopMode() {
    if (isAudioOnly()) return 'audio';
    if (isTranscriptOnly()) return 'transcript';
    return 'full';
  }

  function syncStopChecks(changed) {
    if (changed === 'audio' && isAudioOnly() && transcriptOnlyEl) transcriptOnlyEl.checked = false;
    if (changed === 'transcript' && isTranscriptOnly() && audioOnlyEl) audioOnlyEl.checked = false;
    syncProcessLabel();
  }

  function syncProcessLabel() {
    if (!processBtnLabel) return;
    const mode = stopMode();
    processBtnLabel.textContent =
      mode === 'audio' ? 'Получить аудио' : mode === 'transcript' ? 'Распознать текст' : 'Запустить суммаризацию';
  }

  function audioMp3Href(job) {
    if (!job) return '';
    if (job.audioMp3Url) return job.audioMp3Url;
    if (job.id) return '/api/summarize/jobs/' + encodeURIComponent(job.id) + '/audio.mp3';
    return '';
  }

  function setContinueDownloadLinks(job, { transcript = false } = {}) {
    if (downloadWavLink) {
      if (job && job.audioUrl) {
        downloadWavLink.href = job.audioUrl + (job.audioUrl.includes('?') ? '&' : '?') + 'download=1';
        downloadWavLink.hidden = false;
      } else {
        downloadWavLink.hidden = true;
      }
    }
    if (downloadMp3Link) {
      const mp3 = audioMp3Href(job);
      if (mp3) {
        downloadMp3Link.href = mp3;
        downloadMp3Link.hidden = false;
      } else {
        downloadMp3Link.hidden = true;
      }
    }
    if (downloadTranscriptLink) {
      if (transcript && job && job.transcriptUrl) {
        downloadTranscriptLink.href = job.transcriptUrl;
        downloadTranscriptLink.hidden = false;
      } else {
        downloadTranscriptLink.hidden = true;
      }
    }
  }

  function hideAudioReadyBar() {
    if (audioReadyBar) audioReadyBar.hidden = true;
    if (continueSummarizeBtn) continueSummarizeBtn.disabled = false;
    if (continueTranscribeBtn) continueTranscribeBtn.disabled = false;
    setContinueDownloadLinks(null);
  }

  function showAudioReadyBar(job) {
    if (!audioReadyBar) return;
    audioReadyBar.hidden = false;
    if (audioReadyLead) audioReadyLead.textContent = 'Аудио готово. Распознавание речи не запускалось.';
    if (continueTranscribeBtn) {
      continueTranscribeBtn.hidden = false;
      continueTranscribeBtn.disabled = false;
    }
    if (continueSummarizeBtn) continueSummarizeBtn.hidden = true;
    setContinueDownloadLinks(job);
  }

  function showTranscriptReadyBar(job) {
    if (!audioReadyBar) return;
    audioReadyBar.hidden = false;
    if (audioReadyLead) audioReadyLead.textContent = 'Расшифровка готова. Суммаризация не запускалась.';
    if (continueTranscribeBtn) continueTranscribeBtn.hidden = true;
    if (continueSummarizeBtn) {
      continueSummarizeBtn.hidden = false;
      continueSummarizeBtn.disabled = false;
    }
    setContinueDownloadLinks(job, { transcript: true });
  }

  function stepBadge(status) {
    if (status === 'active') return 'выполняется сейчас';
    if (status === 'done') return 'готово';
    if (status === 'failed') return 'ошибка';
    if (status === 'skipped') return 'пропущен';
    return 'ещё не начался';
  }

  function cmdLabel(status) {
    if (status === 'active') return 'Команда, которая выполняется сейчас';
    if (status === 'done') return 'Команда, которой это было сделано';
    if (status === 'failed') return 'Команда, на которой остановились';
    if (status === 'skipped') return 'Команда, которой это можно сделать позже';
    return 'Команда, которой это будет сделано';
  }

  function geminiPreviewCommand() {
    if (radioValue('summarize-provider', 'gemini') === 'openai') {
      return [
        'POST https://api.openai.com/v1/chat/completions',
        '  model: gpt-4o-mini',
        '  messages: prompt + transcript',
      ].join('\n');
    }
    return [
      'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      '  Content-Type: application/json',
      '  parts: prompt (тезисы на русском) + transcript',
    ].join('\n');
  }

  function sttPreviewCommand() {
    if (radioValue('stt-provider', 'whisper') === 'gemini') {
      return [
        'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        '  Content-Type: application/json',
        '  parts: prompt (только расшифровка) + audio.wav',
      ].join('\n');
    }
    return [
      'POST https://api.openai.com/v1/audio/transcriptions',
      '  model: whisper-1',
      '  file: audio.wav',
    ].join('\n');
  }

  function applyStopModeToSteps(steps, mode) {
    return steps.map((s) => {
      if (mode === 'audio' && (s.id === 'stt' || s.id === 'summarize')) {
        return {
          ...s,
          status: 'skipped',
          waitHint: 'Пропущен: выбрано «только аудио». Можно запустить позже.',
          detail: 'Автоматически не стартует.',
        };
      }
      if (mode === 'transcript' && s.id === 'summarize') {
        return {
          ...s,
          status: 'skipped',
          waitHint: 'Пропущен: выбрано «распознать текст, но не суммаризировать».',
          detail: 'Автоматически не стартует.',
        };
      }
      return s;
    });
  }

  function previewUrlSteps(url, mode) {
    return applyStopModeToSteps(
      [
        {
          n: 1,
          id: 'download',
          title: 'Скачивание видео',
          tool: 'yt-dlp',
          why: 'Шаг качает ролик через yt-dlp (видео+аудио). Ниже — живой этап: соединение это или уже байты файла, плюс скорость.',
          command: `yt-dlp --js-runtimes node --cookies-from-browser firefox --force-ipv4 --ffmpeg-location ffmpeg -f bestvideo+bestaudio/best --no-playlist --newline --progress --no-mtime -o source.%(ext)s ${url}`,
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Запустится первым, как только дойдёт очередь.',
          detail: 'Ставим задачу и сразу показываем весь план шагов.',
          stats: {
            phase: 'pending',
            phaseLabel: 'Ещё не начался. После запуска здесь появятся этап, скорость и размер.',
            items: [
              { key: 'speed', label: 'Скорость', value: '—' },
              { key: 'size', label: 'Скачано', value: '—' },
              { key: 'eta', label: 'Осталось', value: '—' },
              { key: 'elapsed', label: 'Прошло', value: '—' },
            ],
            log: [],
          },
        },
        {
          n: 2,
          id: 'ffmpeg',
          title: 'Извлечение звука',
          tool: 'ffmpeg',
          why: 'После скачивания вырежем аудиодорожку и приведём к WAV 16 kHz mono — так удобнее модели.',
          command: 'ffmpeg -y -i source.* -vn -ar 16000 -ac 1 -c:a pcm_s16le -nostats -progress pipe:1 audio.wav',
          status: 'pending',
          progress: 0,
          waitHint:
            mode === 'audio'
              ? 'После этого шага остановимся: распознавание не запустится само.'
              : 'Ещё не начался. Стартует сразу после скачивания.',
          detail: 'Ждёт файл source.* от yt-dlp.',
        },
        {
          n: 3,
          id: 'stt',
          title: 'Распознавание речи',
          tool: 'Whisper / Gemini',
          why: 'Из WAV получим текст. Результат появится в этом блоке — его можно поправить перед суммаризацией.',
          command: sttPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов audio.wav.',
          detail: 'Ждёт audio.wav после ffmpeg.',
        },
        {
          n: 4,
          id: 'summarize',
          title: 'Суммаризация текста',
          tool: 'Gemini / OpenAI',
          why: 'В нейросеть уйдёт только расшифровка. На выходе — заголовок, тезисы, таймкоды и задачи.',
          command: geminiPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов текст расшифровки.',
          detail: 'Ждёт текст из блока распознавания речи.',
        },
      ],
      mode
    );
  }

  function previewFileSteps(filename, mode) {
    const src = filename || 'source.*';
    return applyStopModeToSteps(
      [
        {
          n: 1,
          id: 'ffmpeg',
          title: 'Извлечение звука',
          tool: 'ffmpeg',
          why: 'Из загруженного файла вырежем дорожку и сделаем WAV 16 kHz mono.',
          command: `ffmpeg -y -i ${src} -vn -ar 16000 -ac 1 -c:a pcm_s16le -nostats -progress pipe:1 audio.wav`,
          status: 'pending',
          progress: 0,
          waitHint:
            mode === 'audio'
              ? 'После этого шага остановимся: распознавание не запустится само.'
              : 'Ещё не начался. Запустится первым, как только дойдёт очередь.',
          detail: 'Ставим задачу и сразу показываем весь план шагов.',
        },
        {
          n: 2,
          id: 'stt',
          title: 'Распознавание речи',
          tool: 'Whisper / Gemini',
          why: 'Из WAV получим текст. Результат появится в этом блоке — его можно поправить перед суммаризацией.',
          command: sttPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов audio.wav.',
          detail: 'Ждёт audio.wav после ffmpeg.',
        },
        {
          n: 3,
          id: 'summarize',
          title: 'Суммаризация текста',
          tool: 'Gemini / OpenAI',
          why: 'В нейросеть уйдёт только расшифровка. На выходе — заголовок, тезисы, таймкоды и задачи.',
          command: geminiPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов текст расшифровки.',
          detail: 'Ждёт текст из блока распознавания речи.',
        },
      ],
      mode
    );
  }

  function updateRunLogHead(steps, jobStatus) {
    if (!runLogTitle || !runLogLead) return;
    const total = (steps || []).length;
    const active = (steps || []).find((s) => s.status === 'active');
    const failed = (steps || []).some((s) => s.status === 'failed');
    const doneCount = (steps || []).filter((s) => s.status === 'done').length;

    if (failed) {
      runLogTitle.textContent = 'План выполнения — остановка';
      runLogLead.textContent =
        'Один из шагов завершился с ошибкой. Готовые файлы из предыдущих блоков можно скачать прямо в карточке шага.';
      return;
    }
    if (jobStatus === 'audio_ready') {
      runLogTitle.textContent = 'Аудио готово · распознавание на паузе';
      runLogLead.textContent =
        'Скачивание и извлечение звука закончены. Распознавание не запускалось — его можно включить в третьем блоке.';
      return;
    }
    if (jobStatus === 'transcript_ready') {
      runLogTitle.textContent = 'Расшифровка готова · суммаризация на паузе';
      runLogLead.textContent = 'Текст уже есть в третьем блоке. Тезисы можно запросить отдельно.';
      return;
    }
    if (jobStatus === 'ready' || (total && doneCount === total)) {
      runLogTitle.textContent = `Все шаги выполнены · ${total} из ${total}`;
      runLogLead.textContent = 'Все запланированные шаги завершены. Результат суммаризации ниже.';
      return;
    }
    if (active) {
      const n = active.n || (steps.findIndex((s) => s.id === active.id) + 1);
      runLogTitle.textContent = `Ход задачи · шаг ${n} из ${total}`;
      runLogLead.textContent = `Сейчас выполняется «${active.title}». Следующие блоки уже видны и ждут своей очереди.`;
      return;
    }
    if (jobStatus === 'queued') {
      runLogTitle.textContent = `План выполнения · ${total} шага`;
      runLogLead.textContent = 'Задача в очереди. Все шаги уже расписаны: как только сервер освободится, первый блок станет активным.';
      return;
    }
    runLogTitle.textContent = `План выполнения · ${total} шага`;
    runLogLead.textContent = 'Все шаги видны сразу: текущий выполняется, следующие ждут своей очереди.';
  }

  function stepView(step, idx) {
    const status = step.status || 'pending';
    const n = step.n || idx + 1;
    const pct = Number.isFinite(step.progress) ? Math.max(0, Math.min(100, step.progress)) : null;
    const indeterminate = status === 'active' && (step.indeterminate || pct == null);
    let barWidth = 0;
    if (status === 'done') barWidth = 100;
    else if (indeterminate) barWidth = 38;
    else if (pct != null) barWidth = pct;
    else if (status === 'active') barWidth = 8;

    let pctLabel = 'ожидает';
    if (status === 'done') pctLabel = '100%';
    else if (status === 'failed') pctLabel = pct != null ? pct + '%' : 'ошибка';
    else if (status === 'skipped') pctLabel = 'стоп';
    else if (indeterminate) pctLabel = 'идёт…';
    else if (status === 'active' && pct != null) pctLabel = pct + '%';

    return {
      status,
      n,
      pct,
      indeterminate,
      barWidth,
      pctLabel,
      liveDetail:
        step.stats && step.stats.phaseLabel
          ? ''
          : status === 'pending' || status === 'skipped'
            ? step.waitHint || step.detail || ''
            : step.detail || '',
      title: step.title || '',
      tool: step.tool || '',
      why: step.why || '',
      command: step.command || '',
      stats: step.stats || null,
      startedAt: step.startedAt || null,
    };
  }

  function setText(el, text) {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
  }

  function statsItemsHtml(items) {
    if (!items || !items.length) return '';
    return items
      .map(
        (it) =>
          `<div class="run-step__stat"><span>${escapeHtml(it.label || '')}</span><strong>${escapeHtml(it.value || '—')}</strong></div>`
      )
      .join('');
  }

  function statsLogHtml(lines) {
    if (!lines || !lines.length) return '';
    return `<ol class="run-step__log">${lines
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join('')}</ol>`;
  }

  function withQuery(url, extra) {
    if (!url) return '';
    return url + (url.includes('?') ? '&' : '?') + extra;
  }

  function stepActionsInner(step, job) {
    if (!job || !step) return '';
    const status = step.status || 'pending';
    if (status !== 'done' && status !== 'failed' && status !== 'skipped') return '';
    const bits = [];
    const hasDownloadStep = (job.steps || []).some((s) => s.id === 'download');

    if (step.id === 'download' && status === 'done' && job.videoUrl) {
      bits.push(
        `<a class="vesha-btn vesha-btn--sm vesha-btn--primary" href="${escapeHtml(withQuery(job.videoUrl, 'download=1'))}">Скачать видео</a>`
      );
    }

    if (step.id === 'ffmpeg' && (status === 'done' || job.audioUrl)) {
      if (job.audioUrl && status === 'done') {
        bits.push(
          `<audio class="run-step__player" controls preload="metadata" src="${escapeHtml(mediaSrc(job.audioUrl, job))}"></audio>`
        );
        bits.push(
          `<a class="vesha-btn vesha-btn--sm vesha-btn--outline" href="${escapeHtml(withQuery(job.audioUrl, 'download=1'))}">Скачать WAV</a>`
        );
        bits.push(
          `<a class="vesha-btn vesha-btn--sm vesha-btn--outline" href="${escapeHtml(audioMp3Href(job))}">Скачать MP3</a>`
        );
      }
      if (job.videoUrl && !hasDownloadStep && status === 'done') {
        bits.push(
          `<a class="vesha-btn vesha-btn--sm vesha-btn--outline" href="${escapeHtml(withQuery(job.videoUrl, 'download=1'))}">Скачать исходный файл</a>`
        );
      }
    }

    if (step.id === 'stt') {
      if ((status === 'done' || status === 'skipped') && job.transcript) {
        bits.push(
          `<textarea class="run-step__transcript" data-transcript rows="8">${escapeHtml(job.transcript)}</textarea>`
        );
        bits.push(
          `<a class="vesha-btn vesha-btn--sm vesha-btn--outline" href="/api/summarize/jobs/${encodeURIComponent(job.id)}/transcript.txt">Скачать текст</a>`
        );
        if (job.canSummarize) {
          bits.push(
            `<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--primary" data-retry-summarize>Суммаризировать</button>`
          );
        }
      }
      if ((status === 'failed' || status === 'skipped') && job.canTranscribe) {
        bits.push(
          `<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--primary" data-retry-transcribe>Распознать текст</button>`
        );
      }
    }

    if (step.id === 'summarize') {
      if (status === 'done' && job.summary) {
        const title = job.summary.title || '';
        const tldr = job.summary.tldr || '';
        if (title || tldr) {
          bits.push(
            `<div class="run-step__summary">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${
              tldr ? `${title ? '<br>' : ''}${escapeHtml(tldr)}` : ''
            }</div>`
          );
        }
        bits.push(
          `<a class="vesha-btn vesha-btn--sm vesha-btn--primary" href="/api/summarize/jobs/${encodeURIComponent(job.id)}/summary.txt">Скачать текст</a>`
        );
      }
      if ((status === 'failed' || status === 'skipped') && job.canSummarize) {
        bits.push(
          `<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--primary" data-retry-summarize>Суммаризировать</button>`
        );
      }
    }

    return bits.join('');
  }

  function actionsKey(step, job) {
    if (!step) return '';
    if (step.id === 'download') {
      return ['download', step.status, job && job.videoUrl ? 'v' : ''].join('|');
    }
    if (step.id === 'ffmpeg') {
      return [
        'ffmpeg',
        step.status,
        job && job.audioUrl ? 'a' : '',
        job && job.videoUrl ? 'v' : '',
      ].join('|');
    }
    if (step.id === 'stt') {
      return [
        'stt',
        step.status,
        job && job.transcript ? 't' : '',
        job && job.canTranscribe ? 'c' : '',
        job && job.canSummarize ? 's' : '',
      ].join('|');
    }
    if (step.id === 'summarize') {
      return [
        'summarize',
        step.status,
        job && job.summary ? 's' : '',
        job && job.canSummarize ? 'c' : '',
      ].join('|');
    }
    return [step.id, step.status].join('|');
  }

  function stepActionsBlock(step, job) {
    const inner = stepActionsInner(step, job);
    if (!inner) return '';
    return `<div class="run-step__actions" data-key="${escapeHtml(actionsKey(step, job))}">${inner}</div>`;
  }

  function fillActions(article, step, job) {
    const inner = stepActionsInner(step, job);
    let box = article.querySelector('.run-step__actions');
    const key = actionsKey(step, job);
    if (!inner) {
      if (box) box.remove();
      return;
    }
    if (box && box.dataset.key === key) return;
    const prevTa = box && box.querySelector('[data-transcript]');
    const prevVal = prevTa ? prevTa.value : null;
    const prevFocused = Boolean(prevTa && document.activeElement === prevTa);
    if (!box) {
      box = document.createElement('div');
      box.className = 'run-step__actions';
      article.querySelector('.run-step__card').appendChild(box);
    }
    box.dataset.key = key;
    box.innerHTML = inner;
    if (prevVal != null) {
      const nextTa = box.querySelector('[data-transcript]');
      if (nextTa) {
        nextTa.value = prevVal;
        if (prevFocused) nextTa.focus();
      }
    }
  }

  function fillLive(article, stats) {
    const card = article.querySelector('.run-step__card');
    if (!card) return;
    let live = article.querySelector('.run-step__live');
    if (!stats || (!stats.phaseLabel && !(stats.items && stats.items.length) && !(stats.log && stats.log.length))) {
      if (live) live.hidden = true;
      return;
    }
    if (!live) {
      live = document.createElement('div');
      live.className = 'run-step__live';
      const cmdWrap = article.querySelector('.run-step__cmd-wrap');
      card.insertBefore(live, cmdWrap || null);
    }
    live.hidden = false;
    live.innerHTML = `
      ${stats.phaseLabel ? `<p class="run-step__phase">${escapeHtml(stats.phaseLabel)}</p>` : ''}
      ${stats.items && stats.items.length ? `<div class="run-step__stats">${statsItemsHtml(stats.items)}</div>` : ''}
      ${statsLogHtml(stats.log)}
    `;
  }

  function patchStepEl(article, step, idx) {
    const v = stepView(step, idx);
    article.className = 'run-step is-' + v.status;
    setText(article.querySelector('.run-step__index'), String(v.n));
    setText(article.querySelector('h3'), 'Блок ' + v.n + ' — ' + v.title);
    const toolEl = article.querySelector('.run-step__tool');
    if (toolEl) setText(toolEl, v.tool);
    const whyEl = article.querySelector('.run-step__why');
    if (whyEl) setText(whyEl, v.why);
    setText(article.querySelector('.run-step__badge'), stepBadge(v.status));
    const bar = article.querySelector('.run-step__bar');
    if (bar) {
      bar.classList.toggle('is-indeterminate', v.indeterminate);
      bar.setAttribute('aria-valuenow', String(v.pct != null ? v.pct : 0));
      const fill = bar.querySelector('i');
      if (fill) fill.style.width = v.barWidth + '%';
    }
    setText(article.querySelector('.run-step__pct'), v.pctLabel);
    setText(article.querySelector('.run-step__cmd-label'), cmdLabel(v.status));
    setText(article.querySelector('.run-step__cmd'), v.command);
    fillLive(article, v.stats);
    fillActions(article, step, latestJob);
    let detailEl = article.querySelector('.run-step__detail');
    if (v.liveDetail) {
      if (!detailEl) {
        detailEl = document.createElement('p');
        detailEl.className = 'run-step__detail';
        article.querySelector('.run-step__card').appendChild(detailEl);
      }
      setText(detailEl, v.liveDetail);
    } else if (detailEl) {
      detailEl.remove();
    }
  }

  function stepTemplate(step, idx) {
    const v = stepView(step, idx);
    return `
      <article class="run-step is-${escapeHtml(v.status)}" data-step-id="${escapeHtml(step.id || String(idx))}">
        <div class="run-step__index" aria-hidden="true">${v.n}</div>
        <div class="run-step__card">
          <div class="run-step__head">
            <div class="run-step__titles">
              <h3>Блок ${v.n} — ${escapeHtml(v.title)}</h3>
              <div class="run-step__meta">
                ${v.tool ? `<span class="run-step__tool">${escapeHtml(v.tool)}</span>` : ''}
              </div>
              ${v.why ? `<p class="run-step__why">${escapeHtml(v.why)}</p>` : ''}
            </div>
            <span class="run-step__badge">${stepBadge(v.status)}</span>
          </div>
          <div class="run-step__progress">
            <div class="run-step__bar${v.indeterminate ? ' is-indeterminate' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v.pct != null ? v.pct : 0}">
              <i style="width:${v.barWidth}%"></i>
            </div>
            <span class="run-step__pct">${escapeHtml(v.pctLabel)}</span>
          </div>
          <div class="run-step__live"${v.stats ? '' : ' hidden'}>
            ${v.stats && v.stats.phaseLabel ? `<p class="run-step__phase">${escapeHtml(v.stats.phaseLabel)}</p>` : ''}
            ${v.stats && v.stats.items && v.stats.items.length ? `<div class="run-step__stats">${statsItemsHtml(v.stats.items)}</div>` : ''}
            ${v.stats ? statsLogHtml(v.stats.log) : ''}
          </div>
          <div class="run-step__cmd-wrap">
            <span class="run-step__cmd-label">${cmdLabel(v.status)}</span>
            <pre class="run-step__cmd">${escapeHtml(v.command)}</pre>
          </div>
          ${v.liveDetail ? `<p class="run-step__detail">${escapeHtml(v.liveDetail)}</p>` : ''}
          ${stepActionsBlock(step, latestJob)}
        </div>
      </article>
    `;
  }

  function formatElapsedLocal(startedAt) {
    const t = Date.parse(startedAt);
    if (!Number.isFinite(t)) return null;
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const r = sec % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function stepsWithLocalElapsed(steps) {
    return (steps || []).map((s) => {
      if (s.status !== 'active' || !s.startedAt || !s.stats) return s;
      const elapsed = formatElapsedLocal(s.startedAt);
      if (!elapsed) return s;
      const items = (s.stats.items || []).map((it) =>
        it.key === 'elapsed' ? { ...it, value: elapsed } : it
      );
      return { ...s, stats: { ...s.stats, items } };
    });
  }

  function stopElapsedClock() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function startElapsedClock() {
    if (elapsedTimer) return;
    elapsedTimer = setInterval(() => {
      if (!latestSteps.some((s) => s.status === 'active' && s.startedAt)) {
        stopElapsedClock();
        return;
      }
      paintRunSteps(latestSteps, latestJobStatus);
    }, 1000);
  }

  function paintRunSteps(steps, jobStatus) {
    if (!runLog || !runSteps) return;
    if (!Array.isArray(steps) || !steps.length) {
      runLog.hidden = true;
      return;
    }
    runLog.hidden = false;
    updateRunLogHead(steps, jobStatus);
    const viewSteps = stepsWithLocalElapsed(steps);
    const existing = runSteps.querySelectorAll('.run-step');
    if (existing.length === viewSteps.length) {
      viewSteps.forEach((step, idx) => patchStepEl(existing[idx], step, idx));
      return;
    }
    runSteps.innerHTML = viewSteps.map(stepTemplate).join('');
  }

  function renderRunSteps(steps, jobStatus) {
    latestSteps = steps || [];
    latestJobStatus = jobStatus;
    paintRunSteps(latestSteps, latestJobStatus);
    if (latestSteps.some((s) => s.status === 'active' && s.startedAt)) startElapsedClock();
  }

  // Load server tool availability
  async function checkTools() {
    try {
      const res = await fetch('/api/summarize/tools');
      const data = await res.json();
      const q = data.queue;
      const qText = q
        ? ` · очередь ${q.total || 0} (ждёт ${q.waiting || 0})`
        : '';
      if (data.ready) {
        toolsStatusEl.textContent = `yt-dlp ${data.ytdlp?.version || ''} · ffmpeg готов · AI: ${data.geminiConfigured ? 'Gemini active' : 'demo mode'}${qText}`;
        toolsStatusEl.style.color = '#34d399';
      } else {
        toolsStatusEl.textContent = 'Локальные бинарники: не установлены (работает браузерный режим)' + qText;
      }
    } catch {
      toolsStatusEl.textContent = 'Серверные инструменты: оффлайн';
    }
  }

  // Tab switching
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach((p) => {
        p.classList.remove('is-active');
        p.hidden = true;
      });

      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      const targetPanel = document.getElementById(tab.dataset.target);
      if (targetPanel) {
        targetPanel.classList.add('is-active');
        targetPanel.hidden = false;
      }
    });
  });

  // Output view switching
  outputTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      outputTabs.forEach((t) => t.classList.remove('is-active'));
      outputPanels.forEach((p) => {
        p.classList.remove('is-active');
        p.hidden = true;
      });

      tab.classList.add('is-active');
      const panel = document.getElementById('view-' + tab.dataset.view);
      if (panel) {
        panel.classList.add('is-active');
        panel.hidden = false;
      }
    });
  });

  // File dropzone handlers
  function setSelectedFile(file) {
    if (!file) {
      currentFile = null;
      fileChosen.hidden = true;
      fileDropzone.hidden = false;
      return;
    }
    currentFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileChosen.hidden = false;
    fileDropzone.hidden = true;
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      setSelectedFile(fileInput.files[0]);
    }
  });

  fileClearBtn.addEventListener('click', () => {
    fileInput.value = '';
    setSelectedFile(null);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropzone.classList.remove('is-dragover');
    });
  });

  fileDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      setSelectedFile(dt.files[0]);
    }
  });

  // In-Browser Audio Extraction from Video using Web Audio API
  async function extractAudioInBrowser(videoOrAudioBlob) {
    return new Promise((resolve, reject) => {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          // Resample and convert to mono 16kHz WAV
          const targetSampleRate = 16000;
          const offlineCtx = new OfflineAudioContext(
            1,
            Math.ceil(audioBuffer.duration * targetSampleRate),
            targetSampleRate
          );

          const source = offlineCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineCtx.destination);
          source.start();

          const renderedBuffer = await offlineCtx.startRendering();
          const wavBlob = bufferToWaveBlob(renderedBuffer);
          resolve(wavBlob);
        } catch (err) {
          reject(new Error('Не удалось декодировать аудиодорожку в браузере: ' + err.message));
        } finally {
          try { audioCtx.close(); } catch (_) {}
        }
      };

      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsArrayBuffer(videoOrAudioBlob);
    });
  }

  // Fast WAV PCM Encoder
  function bufferToWaveBlob(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const outBuffer = new ArrayBuffer(length);
    const view = new DataView(outBuffer);
    const channels = [];
    let sampleRate = abuffer.sampleRate;
    let offset = 0;
    let pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    // RIFF chunk descriptor
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    // fmt sub-chunk
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // SubChunk1Size (16 for PCM)
    setUint16(1);          // AudioFormat (1 for PCM)
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan); // byte rate
    setUint16(numOfChan * 2);              // block align
    setUint16(16);                         // bits per sample

    // data sub-chunk
    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4);

    for (let i = 0; i < abuffer.numberOfChannels; i++) {
      channels.push(abuffer.getChannelData(i));
    }

    while (offset < abuffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([outBuffer], { type: 'audio/wav' });
  }

  // Mic Recording handlers
  micToggleBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          currentAudioBlob = blob;
          const file = new File([blob], 'mic_record.webm', { type: 'audio/webm' });
          setSelectedFile(file);
          // Switch to file tab to show chosen recording
          document.getElementById('tab-file').click();
          stream.getTracks().forEach((t) => t.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        micToggleBtn.classList.add('is-recording');
        micStatusText.textContent = 'Идёт запись… Нажмите чтобы остановить';
        micTimer.hidden = false;
        recordSeconds = 0;
        micTimer.textContent = '00:00';
        recordTimerInterval = setInterval(() => {
          recordSeconds++;
          micTimer.textContent = formatTime(recordSeconds);
        }, 1000);
      } catch (err) {
        showError('Не удалось получить доступ к микрофону: ' + err.message);
      }
    } else {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      isRecording = false;
      micToggleBtn.classList.remove('is-recording');
      micStatusText.textContent = 'Запись завершена';
      clearInterval(recordTimerInterval);
    }
  });

  // Client speech recognition (Web Speech API)
  async function transcribeLocally(audioBlob) {
    return new Promise((resolve) => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        resolve('Web Speech API не поддерживается в данном браузере (используется серверная модель).');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.continuous = true;
      recognition.interimResults = false;

      let transcript = '';
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
      };

      recognition.onerror = () => {
        resolve(transcript || 'Аудиозапись обработана.');
      };

      recognition.onend = () => {
        resolve(transcript || 'Расшифровка аудиозаписи.');
      };

      try {
        recognition.start();
        setTimeout(() => {
          try { recognition.stop(); } catch (_) {}
          resolve(transcript || 'Расшифровка аудиозаписи.');
        }, 8000);
      } catch {
        resolve('Локальное распознавание речи завершено.');
      }
    });
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollRetries = 0;
    stopElapsedClock();
  }

  function applyJobView(job) {
    latestJob = job || null;
    renderRunSteps(job.steps || [], job.status);
  }

  function rememberJob(job) {
    currentJobData = {
      id: job.id,
      jobId: job.id,
      sourceTitle: job.title,
      audioUrl: job.audioUrl,
      transcript: job.transcript || null,
      transcriptUrl: job.transcriptUrl || null,
      bytes: job.bytes,
      provider: job.provider,
      model: job.model,
    };
  }

  function currentTranscriptText() {
    const ta = runSteps && runSteps.querySelector('[data-transcript]');
    if (ta && ta.value.trim()) return ta.value;
    if (latestJob && latestJob.transcript) return latestJob.transcript;
    if (currentJobData && currentJobData.transcript) return currentJobData.transcript;
    return '';
  }

  function setRetryButtonsBusy(attr, busy) {
    if (runSteps) {
      runSteps.querySelectorAll(attr).forEach((btn) => {
        btn.disabled = busy;
      });
    }
  }

  function setRetrySummarizeBusy(busy) {
    if (continueSummarizeBtn) continueSummarizeBtn.disabled = busy;
    setRetryButtonsBusy('[data-retry-summarize]', busy);
  }

  function setRetryTranscribeBusy(busy) {
    if (continueTranscribeBtn) continueTranscribeBtn.disabled = busy;
    setRetryButtonsBusy('[data-retry-transcribe]', busy);
  }

  async function requestTranscribe() {
    const jobId = currentJobData && currentJobData.jobId;
    if (!jobId) {
      showError('Нет готового аудио для распознавания');
      return;
    }
    showError('');
    setRetryTranscribeBusy(true);
    processBtn.disabled = true;
    hideAudioReadyBar();
    showStatus('Ставим распознавание в очередь. Аудио уже есть, скачивать не будем.');
    try {
      const res = await fetch('/api/summarize/jobs/' + encodeURIComponent(jobId) + '/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectAiOptions()),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Не удалось запустить распознавание');
      renderQueue(job);
      applyJobView(job);
      await pollJob(job.id);
    } catch (err) {
      queueCard.hidden = true;
      if (currentJobData && currentJobData.audioUrl) {
        showAudioReadyBar({
          audioUrl: currentJobData.audioUrl,
        });
      }
      showError(err.message || 'Ошибка распознавания');
      showStatus('');
      processBtn.disabled = false;
      setRetryTranscribeBusy(false);
    }
  }

  async function requestSummarize() {
    const jobId = currentJobData && currentJobData.jobId;
    if (!jobId) {
      showError('Нет расшифровки для суммаризации');
      return;
    }
    showError('');
    setRetrySummarizeBusy(true);
    processBtn.disabled = true;
    hideAudioReadyBar();
    showStatus('Ставим суммаризацию в очередь. Текст уже есть, аудио заново не отправляем.');
    try {
      const res = await fetch('/api/summarize/jobs/' + encodeURIComponent(jobId) + '/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...collectAiOptions(),
          transcript: currentTranscriptText(),
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Не удалось запустить суммаризацию');
      renderQueue(job);
      applyJobView(job);
      await pollJob(job.id);
    } catch (err) {
      queueCard.hidden = true;
      if (currentJobData && (currentJobData.transcript || currentTranscriptText())) {
        showTranscriptReadyBar({
          audioUrl: currentJobData.audioUrl,
          transcriptUrl: currentJobData.transcriptUrl,
        });
      } else if (currentJobData && currentJobData.audioUrl) {
        showAudioReadyBar({
          audioUrl: currentJobData.audioUrl,
        });
      }
      showError(err.message || 'Ошибка суммаризации');
      showStatus('');
      processBtn.disabled = false;
      setRetrySummarizeBusy(false);
    }
  }

  function renderQueue(job) {
    const q = job.queue || {};
    queueCard.hidden = false;
    if (q.you === 'running') {
      queueTitle.textContent = 'Ваша задача выполняется';
      queueLead.textContent = 'Сейчас обрабатываем её. Остальные ждут в общей очереди.';
      queueRunning.textContent = q.waiting
        ? `После вас в очереди: ${q.waiting}`
        : 'Очередь за вами пустая.';
      return;
    }
    const pos = q.position || 2;
    queueTitle.textContent = `Вы в очереди — №${pos}`;
    queueLead.textContent = 'Задача поставлена. Сервер делает только одну суммаризацию за раз.';
    const running = q.running && q.running.label ? q.running.label : 'другая задача';
    const ahead = q.ahead || 0;
    queueRunning.textContent =
      `Сейчас выполняется ${running}. Перед вами ${ahead} ${ahead === 1 ? 'задача' : 'задач(и)'}.`;
  }

  let pollRetries = 0;

  async function pollJob(jobId) {
    let job;
    try {
      job = await fetchJson('/api/summarize/jobs/' + encodeURIComponent(jobId));
      pollRetries = 0;
    } catch (err) {
      if (err.retryable && pollRetries < 40) {
        pollRetries += 1;
        showStatus(err.message || 'Нет связи с сервером, повторяем запрос статуса…');
        pollTimer = setTimeout(() => {
          pollJob(jobId).catch((waitErr) => {
            showError(waitErr.message || 'Ошибка очереди');
            processBtn.disabled = false;
          });
        }, 2000);
        return;
      }
      throw err;
    }

    applyJobView(job);

    if (job.status === 'queued') {
      hideAudioReadyBar();
      renderQueue(job);
      showStatus(`Вы в очереди — №${job.queue?.position || '…'}. Ниже план команд.`);
      pollTimer = setTimeout(() => {
        pollJob(jobId).catch((err) => {
          showError(err.message || 'Ошибка очереди');
          processBtn.disabled = false;
        });
      }, 500);
      return;
    }

    if (job.status === 'running') {
      hideAudioReadyBar();
      renderQueue(job);
      const active = (job.steps || []).find((s) => s.status === 'active');
      if (active) {
        const n = active.n || (job.steps || []).findIndex((s) => s.id === active.id) + 1;
        const speed = (active.stats && active.stats.items || []).find((it) => it.key === 'speed');
        const pct = Number.isFinite(active.progress) && !active.indeterminate ? ` ${active.progress}%` : '';
        const spd = speed && speed.value && speed.value !== '—' ? ` · ${speed.value}` : '';
        showStatus(
          active.stats && active.stats.phaseLabel
            ? active.stats.phaseLabel
            : `Сейчас: блок ${n} — ${active.title}${pct}${spd}`
        );
      } else if (job.phase === 'downloading') showStatus('Скачиваем видео…');
      else if (job.phase === 'extracting') showStatus('Извлекаем звук…');
      else if (job.phase === 'transcribing') showStatus('Распознаём речь…');
      else if (job.phase === 'summarizing') showStatus('Суммаризируем текст…');
      else showStatus('Задача выполняется…');
      pollTimer = setTimeout(() => {
        pollJob(jobId).catch((err) => {
          showError(err.message || 'Ошибка очереди');
          processBtn.disabled = false;
        });
      }, 350);
      return;
    }

    queueCard.hidden = true;
    if (job.status === 'failed') {
      hideAudioReadyBar();
      showStatus('');
      rememberJob(job);
      currentSummaryData = null;
      if (resultSection && !job.summary) resultSection.hidden = true;
      showError(job.error || job.aiError || 'Задача не выполнилась');
      processBtn.disabled = false;
      setRetrySummarizeBusy(false);
      setRetryTranscribeBusy(false);
      checkTools();
      refreshHistoryIfOpen();
      return;
    }

    applyJobView(job);
    rememberJob(job);

    if (job.status === 'audio_ready' || job.canTranscribe) {
      showStatus('Аудио готово. Распознавание не запускалось.');
      currentSummaryData = null;
      renderAudioOnlyResult(job);
      showAudioReadyBar(job);
      processBtn.disabled = false;
      setRetryTranscribeBusy(false);
      setRetrySummarizeBusy(false);
      checkTools();
      refreshHistoryIfOpen();
      return;
    }

    if (job.status === 'transcript_ready' || job.canSummarize) {
      showStatus('Расшифровка готова. Суммаризация не запускалась.');
      currentSummaryData = null;
      renderTranscriptReadyResult(job);
      showTranscriptReadyBar(job);
      processBtn.disabled = false;
      setRetryTranscribeBusy(false);
      setRetrySummarizeBusy(false);
      checkTools();
      refreshHistoryIfOpen();
      return;
    }

    hideAudioReadyBar();
    showStatus('Суммаризация готова!');
    currentSummaryData = job.summary || {};
    renderResults(currentSummaryData, currentJobData);
    processBtn.disabled = false;
    setRetryTranscribeBusy(false);
    setRetrySummarizeBusy(false);
    checkTools();
    refreshHistoryIfOpen();
  }

  function historyKindLabel(kind) {
    if (kind === 'url') return 'Ссылка';
    if (kind === 'mic') return 'Микрофон';
    return 'Файл';
  }

  function historyStatusLabel(item) {
    if (item.status === 'ready') return { text: 'Суммаризация готова', cls: 'is-ok' };
    if (item.status === 'audio_ready') return { text: 'Только аудио', cls: 'is-ok' };
    if (item.status === 'transcript_ready') return { text: 'Только расшифровка', cls: 'is-ok' };
    if (item.status === 'failed') return { text: 'Ошибка', cls: 'is-fail' };
    if (item.status === 'running') return { text: 'Выполняется', cls: 'is-wait' };
    if (item.status === 'queued') return { text: 'В очереди', cls: 'is-wait' };
    return { text: item.status || '—', cls: '' };
  }

  function addHistoryTag(parent, text, cls) {
    if (!text) return;
    const tag = document.createElement('span');
    tag.className = 'history-tag' + (cls ? ' ' + cls : '');
    tag.textContent = text;
    parent.appendChild(tag);
  }

  function renderHistory(items, warning) {
    historyList.innerHTML = '';
    if (historyError) {
      if (warning) {
        historyError.hidden = false;
        historyError.textContent = warning;
      } else {
        historyError.hidden = true;
        historyError.textContent = '';
      }
    }
    if (!items.length) {
      if (historyEmpty) historyEmpty.hidden = false;
      return;
    }
    if (historyEmpty) historyEmpty.hidden = true;

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'history-card';

      const top = document.createElement('div');
      top.className = 'history-card__top';
      const title = document.createElement('h3');
      title.className = 'history-card__title';
      title.textContent = item.summaryTitle || item.sourceTitle || item.sourceHost || 'Конвертация';
      const when = document.createElement('span');
      when.className = 'history-card__when';
      when.textContent = formatWhen(item.createdAt);
      top.appendChild(title);
      top.appendChild(when);
      card.appendChild(top);

      if (item.sourceUrl) {
        const link = document.createElement('a');
        link.className = 'history-card__url';
        link.href = item.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.sourceUrl;
        card.appendChild(link);
      }

      const meta = document.createElement('div');
      meta.className = 'history-card__meta';
      const st = historyStatusLabel(item);
      addHistoryTag(meta, historyKindLabel(item.kind));
      addHistoryTag(meta, st.text, st.cls);
      addHistoryTag(
        meta,
        item.hasSummary
          ? 'С суммаризацией'
          : item.status === 'transcript_ready'
            ? 'Только расшифровка'
            : item.audioOnly
              ? 'Только аудио'
              : null
      );
      addHistoryTag(meta, item.durationSec != null ? `Длительность ${formatClock(item.durationSec)}` : null);
      addHistoryTag(meta, item.audioBytes != null ? `Аудио ${formatBytes(item.audioBytes)}` : null);
      addHistoryTag(meta, item.sourceBytes != null ? `Исходник ${formatBytes(item.sourceBytes)}` : null);
      addHistoryTag(meta, item.language ? `Язык ${item.language}` : null);
      addHistoryTag(
        meta,
        item.model ? `${item.provider || 'модель'}: ${item.model}` : null
      );
      addHistoryTag(meta, item.elapsedMs >= 1000 ? `Обработка ${formatElapsedMs(item.elapsedMs)}` : null);
      addHistoryTag(meta, item.hasFiles ? null : 'Файлы уже удалены');
      card.appendChild(meta);

      if (item.error) {
        const err = document.createElement('p');
        err.className = 'history-card__error';
        err.textContent = item.error;
        card.appendChild(err);
      }

      const actions = document.createElement('div');
      actions.className = 'history-card__actions';
      if (item.hasFiles) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'vesha-btn vesha-btn--sm vesha-btn--primary';
        openBtn.textContent = item.hasSummary ? 'Открыть результат' : 'Открыть';
        openBtn.addEventListener('click', () => openHistoryJob(item.id));
        actions.appendChild(openBtn);
      }
      if (item.audioUrl) {
        const dlWav = document.createElement('a');
        dlWav.className = 'vesha-btn vesha-btn--sm vesha-btn--outline';
        dlWav.href = item.audioUrl + (item.audioUrl.includes('?') ? '&' : '?') + 'download=1';
        dlWav.textContent = 'Скачать WAV';
        dlWav.setAttribute('download', '');
        actions.appendChild(dlWav);
        const dlMp3 = document.createElement('a');
        dlMp3.className = 'vesha-btn vesha-btn--sm vesha-btn--outline';
        dlMp3.href = item.audioMp3Url || '/api/summarize/jobs/' + encodeURIComponent(item.id) + '/audio.mp3';
        dlMp3.textContent = 'Скачать MP3';
        dlMp3.setAttribute('download', '');
        actions.appendChild(dlMp3);
      }
      if (actions.childNodes.length) card.appendChild(actions);
      historyList.appendChild(card);
    });
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/summarize/history', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить историю');
      renderHistory(Array.isArray(data.items) ? data.items : [], data.warning || null);
    } catch (err) {
      historyList.innerHTML = '';
      if (historyEmpty) historyEmpty.hidden = true;
      if (historyError) {
        historyError.hidden = false;
        historyError.textContent = err.message || 'История недоступна (нет подключения к БД).';
      }
    }
  }

  function refreshHistoryIfOpen() {
    if (historyPanel && !historyPanel.hidden) loadHistory();
  }

  async function openHistoryJob(jobId) {
    showError('');
    showStatus('');
    queueCard.hidden = true;
    hideAudioReadyBar();
    stopPolling();
    processBtn.disabled = true;
    if (runLog) runLog.hidden = false;
    try {
      await pollJob(jobId);
      if (runLog) runLog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message || 'Не удалось открыть конвертацию');
      showStatus('');
      processBtn.disabled = false;
    }
  }

  if (historyBtn && historyPanel) {
    historyBtn.addEventListener('click', async () => {
      const willShow = historyPanel.hidden;
      historyPanel.hidden = !willShow;
      if (willShow) {
        await loadHistory();
        historyPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  if (historyClose && historyPanel) {
    historyClose.addEventListener('click', () => {
      historyPanel.hidden = true;
    });
  }

  let filesFilter = 'all';
  let filesCache = null;

  function fileRoleLabel(file) {
    if (file.role === 'extracted') return 'Извлечённое аудио';
    if (file.kind === 'audio') return 'Исходное аудио';
    return 'Видео';
  }

  function closeFilesModal() {
    if (!filesModal) return;
    filesModal.hidden = true;
    document.body.classList.remove('vesha-modal-open');
  }

  function renderFilesModal() {
    if (!filesModalList) return;
    const data = filesCache || { jobs: [], totalBytes: 0, videoCount: 0, audioCount: 0 };
    const jobs = (data.jobs || []).map((job) => ({
      ...job,
      files: (job.files || []).filter((f) => filesFilter === 'all' || f.kind === filesFilter),
    })).filter((job) => job.files.length);

    if (filesModalHint) {
      filesModalHint.textContent =
        `На диске это source.* и audio.wav. Имена ниже — из задания: ролик, исходный файл или заголовок суммаризации. ` +
        `${data.videoCount || 0} видео · ${data.audioCount || 0} аудио · ${formatBytes(data.totalBytes || 0)}.`;
    }

    document.querySelectorAll('[data-files-filter]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-files-filter') === filesFilter);
    });

    filesModalList.innerHTML = '';
    if (filesModalError) filesModalError.hidden = true;
    if (!jobs.length) {
      if (filesModalEmpty) {
        filesModalEmpty.hidden = false;
        filesModalEmpty.textContent = data.jobs && data.jobs.length
          ? 'Нет файлов выбранного типа.'
          : 'На сервере сейчас нет сохранённых видео и аудио.';
      }
      return;
    }
    if (filesModalEmpty) filesModalEmpty.hidden = true;

    jobs.forEach((job) => {
      const card = document.createElement('article');
      card.className = 'files-job';

      const top = document.createElement('div');
      top.className = 'files-job__top';
      const title = document.createElement('h3');
      title.className = 'files-job__title';
      title.textContent = job.title || 'Без названия';
      const when = document.createElement('span');
      when.className = 'files-job__when';
      when.textContent = formatWhen(job.createdAt);
      top.appendChild(title);
      top.appendChild(when);
      card.appendChild(top);

      if (job.sourceUrl) {
        const link = document.createElement('a');
        link.className = 'files-job__url';
        link.href = job.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = job.sourceUrl;
        card.appendChild(link);
      }

      const meta = document.createElement('div');
      meta.className = 'files-job__meta';
      addHistoryTag(meta, job.duration != null ? `Длительность ${formatClock(job.duration)}` : null);
      addHistoryTag(
        meta,
        job.status === 'failed'
          ? 'Ошибка'
          : job.status === 'ready'
            ? 'Готово'
            : job.status === 'audio_ready'
              ? 'Только аудио'
              : job.status === 'transcript_ready'
                ? 'Только расшифровка'
                : job.status
      );
      card.appendChild(meta);

      job.files.forEach((file) => {
        const row = document.createElement('div');
        row.className = 'files-row';
        const label = document.createElement('span');
        label.className = 'files-row__label';
        label.textContent = fileRoleLabel(file);
        const name = document.createElement('span');
        name.className = 'files-row__name';
        name.textContent = `${file.diskName} · ${formatBytes(file.bytes)}`;
        row.appendChild(label);
        row.appendChild(name);
        if (file.kind === 'audio') {
          const playerEl = document.createElement('audio');
          playerEl.className = 'files-row__player';
          playerEl.controls = true;
          playerEl.preload = 'metadata';
          playerEl.src = file.url + (file.url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(job.id);
          row.appendChild(playerEl);
        }
        const actions = document.createElement('div');
        actions.className = 'files-row__actions';
        const dl = document.createElement('a');
        dl.className = 'vesha-btn vesha-btn--sm vesha-btn--primary';
        dl.href = file.downloadUrl;
        dl.textContent = 'Скачать';
        actions.appendChild(dl);
        row.appendChild(actions);
        card.appendChild(row);
      });

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'vesha-btn vesha-btn--sm vesha-btn--outline';
      openBtn.textContent = 'Открыть задачу';
      openBtn.addEventListener('click', () => {
        closeFilesModal();
        openHistoryJob(job.id);
      });
      card.appendChild(openBtn);

      filesModalList.appendChild(card);
    });
  }

  async function openFilesModal() {
    if (!filesModal) return;
    filesModal.hidden = false;
    document.body.classList.add('vesha-modal-open');
    if (filesModalEmpty) filesModalEmpty.hidden = true;
    if (filesModalError) {
      filesModalError.hidden = true;
      filesModalError.textContent = '';
    }
    filesModalList.innerHTML = '';
    try {
      const data = await fetchJson('/api/summarize/files');
      filesCache = data;
      renderFilesModal();
    } catch (err) {
      filesCache = { jobs: [] };
      if (filesModalError) {
        filesModalError.hidden = false;
        filesModalError.textContent = err.message || 'Не удалось прочитать файлы на сервере';
      }
    }
  }

  if (filesBtn) {
    filesBtn.addEventListener('click', () => {
      openFilesModal();
    });
  }
  if (filesModal) {
    filesModal.addEventListener('click', (event) => {
      if (event.target && event.target.closest('[data-close-files]')) closeFilesModal();
    });
    filesModal.querySelectorAll('[data-files-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filesFilter = btn.getAttribute('data-files-filter') || 'all';
        renderFilesModal();
      });
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filesModal && !filesModal.hidden) closeFilesModal();
  });

  processBtn.addEventListener('click', async () => {
    showError('');
    showStatus('');
    resetResultView();
    queueCard.hidden = true;
    hideAudioReadyBar();
    stopPolling();

    const activeTab = document.querySelector('.summarize-tab.is-active').dataset.target;
    const targetFile = currentFile;
    const url = urlInput.value.trim();

    if (activeTab === 'panel-url' && !url) {
      showError('Укажите корректную ссылку на видео или аудио');
      return;
    }
    if ((activeTab === 'panel-file' || activeTab === 'panel-mic') && !targetFile) {
      showError('Выберите или перетащите видео/аудио файл');
      return;
    }

    processBtn.disabled = true;
    latestJob = null;
    const mode = stopMode();
    const audioOnly = mode === 'audio';
    const transcriptOnly = mode === 'transcript';
    const aiOpts = collectAiOptions();
    const preview =
      activeTab === 'panel-url'
        ? previewUrlSteps(url, mode)
        : previewFileSteps(targetFile && targetFile.name, mode);
    renderRunSteps(preview, 'queued');
    if (runLog) {
      runLog.hidden = false;
      runLog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      let job;
      if (activeTab === 'panel-url') {
        showStatus(
          audioOnly
            ? 'Ставим задачу: скачать и извлечь аудио, без распознавания.'
            : transcriptOnly
              ? 'Ставим задачу: скачать, извлечь звук и распознать текст, без суммаризации.'
              : 'Ставим задачу в очередь. Ниже уже виден весь план шагов.'
        );
        const res = await fetch('/api/summarize/from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, audioOnly, transcriptOnly, ...aiOpts }),
        });
        job = await res.json();
        if (!res.ok) throw new Error(job.error || 'Ошибка постановки в очередь');
      } else {
        showStatus(
          audioOnly
            ? 'Загружаем файл. Извлечём аудио, без распознавания.'
            : transcriptOnly
              ? 'Загружаем файл. Извлечём звук и распознаем текст, без суммаризации.'
              : 'Загружаем файл. Ниже уже виден весь план шагов.'
        );
        const fd = new FormData();
        fd.append('file', targetFile);
        fd.append('audioOnly', audioOnly ? 'true' : 'false');
        fd.append('transcriptOnly', transcriptOnly ? 'true' : 'false');
        fd.append('sttProvider', aiOpts.sttProvider);
        fd.append('sttApiKey', aiOpts.sttApiKey);
        fd.append('summarizeProvider', aiOpts.summarizeProvider);
        fd.append('summarizeApiKey', aiOpts.summarizeApiKey);
        const res = await fetch('/api/summarize/upload', {
          method: 'POST',
          body: fd,
        });
        job = await res.json();
        if (!res.ok) throw new Error(job.error || 'Ошибка загрузки файла');
      }

      renderQueue(job);
      applyJobView(job);
      await pollJob(job.id);
    } catch (err) {
      queueCard.hidden = true;
      showError(err.message || 'Ошибка обработки');
      showStatus('');
      processBtn.disabled = false;
    }
  });

  function renderAudioOnlyResult(job) {
    resultSection.hidden = false;
    resultSection.classList.add('is-audio-only');
    resultTitle.textContent = job.title || job.sourceTitle || 'Аудио готово';
    resultMetaTags.innerHTML = `
      <span class="summarize-tag">Только аудио</span>
      <span class="summarize-tag" style="color:var(--sm-accent)">Без распознавания</span>
    `;
    if (job.audioUrl) {
      player.src = mediaSrc(job.audioUrl, job);
    }
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTranscriptReadyResult(job) {
    resultSection.hidden = false;
    resultSection.classList.add('is-audio-only');
    resultTitle.textContent = job.title || job.sourceTitle || 'Расшифровка готова';
    resultMetaTags.innerHTML = `
      <span class="summarize-tag">Только расшифровка</span>
      <span class="summarize-tag" style="color:var(--sm-accent)">Без суммаризации</span>
    `;
    if (job.audioUrl) {
      player.src = mediaSrc(job.audioUrl, job);
    }
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResults(summary, job) {
    resultSection.hidden = false;
    resultSection.classList.remove('is-audio-only');
    resultTitle.textContent = summary.title || job.sourceTitle || 'Результат суммаризации';

    // Meta tags
    resultMetaTags.innerHTML = `
      <span class="summarize-tag">Язык: ${summary.language || 'ru'}</span>
      ${summary.timeline?.length ? `<span class="summarize-tag">Главы: ${summary.timeline.length}</span>` : ''}
      ${summary.key_points?.length ? `<span class="summarize-tag">Тезисы: ${summary.key_points.length}</span>` : ''}
      ${job.model ? `<span class="summarize-tag">${escapeHtml(job.provider || 'AI')}: ${escapeHtml(job.model)}</span>` : ''}
      <span class="summarize-tag" style="color:var(--sm-accent)">Готово</span>
    `;

    // Audio player
    if (job.audioUrl) {
      player.src = mediaSrc(job.audioUrl, job);
    }

    // View: TLDR
    outputTldr.textContent = summary.tldr || 'Краткое содержание отсутствует.';

    // View: Key Points
    outputKeypoints.innerHTML = '';
    const points = Array.isArray(summary.key_points) ? summary.key_points : [];
    if (points.length) {
      points.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        outputKeypoints.appendChild(li);
      });
    } else {
      outputKeypoints.innerHTML = '<li>Тезисы не выделены</li>';
    }

    // View: Timeline
    outputTimeline.innerHTML = '';
    const timeline = Array.isArray(summary.timeline) ? summary.timeline : [];
    if (timeline.length) {
      timeline.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'timeline-item';
        row.innerHTML = `
          <span class="timeline-timestamp">${item.time || '00:00'}</span>
          <div class="timeline-body">
            <strong>${escapeHtml(item.title || '')}</strong>
            <p>${escapeHtml(item.summary || '')}</p>
          </div>
        `;
        row.addEventListener('click', () => {
          if (item.seconds != null) {
            player.currentTime = item.seconds;
            player.play().catch(() => {});
          }
        });
        outputTimeline.appendChild(row);
      });
    } else {
      outputTimeline.innerHTML = '<p class="summarize-drop-hint">Таймкоды не сформированы</p>';
    }

    // View: Actions
    outputActions.innerHTML = '';
    const actions = Array.isArray(summary.action_items) ? summary.action_items : [];
    if (actions.length) {
      actions.forEach((a) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <input type="checkbox" />
          <span>${escapeHtml(a)}</span>
        `;
        outputActions.appendChild(li);
      });
    } else {
      outputActions.innerHTML = '<li>Действия не сформулированы</li>';
    }

    // View: Transcript
    outputTranscript.textContent = summary.transcript || 'Текстовая расшифровка формируется…';

    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Transcript Search filter
  transcriptSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const text = currentSummaryData?.transcript || '';
    if (!query) {
      outputTranscript.textContent = text;
      return;
    }
    // Highlighting
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    outputTranscript.innerHTML = escapeHtml(text).replace(
      regex,
      '<mark style="background:var(--sm-accent);color:#000;border-radius:2px;padding:0 2px;">$1</mark>'
    );
  });

  // Export to Markdown
  copyMdBtn.addEventListener('click', async () => {
    if (!currentSummaryData) return;
    const s = currentSummaryData;
    let md = `# ${s.title || 'Суммаризация'}\n\n`;
    md += `## ⚡ Краткая суть\n${s.tldr || ''}\n\n`;

    if (s.key_points?.length) {
      md += `## 📌 Ключевые тезисы\n`;
      s.key_points.forEach((p) => { md += `- ${p}\n`; });
      md += `\n`;
    }

    if (s.timeline?.length) {
      md += `## ⏱️ Таймкоды\n`;
      s.timeline.forEach((t) => { md += `- **${t.time}** — ${t.title}: ${t.summary}\n`; });
      md += `\n`;
    }

    if (s.action_items?.length) {
      md += `## 📝 Задачи и выводы\n`;
      s.action_items.forEach((a) => { md += `- [ ] ${a}\n`; });
      md += `\n`;
    }

    if (s.transcript) {
      md += `## 📜 Расшифровка\n${s.transcript}\n`;
    }

    try {
      await navigator.clipboard.writeText(md);
      copyMdBtn.textContent = '✓ Скопировано';
      setTimeout(() => { copyMdBtn.textContent = '📋 Скопировать Markdown'; }, 1500);
    } catch {
      showError('Не удалось скопировать Markdown');
    }
  });

  // Download TXT
  downloadTxtBtn.addEventListener('click', () => {
    if (!currentSummaryData) return;
    const text = `СУММАРИЗАЦИЯ: ${currentSummaryData.title || ''}\n\nКРАТКАЯ СУТЬ:\n${currentSummaryData.tldr || ''}\n\nРАСШИФРОВКА:\n${currentSummaryData.transcript || ''}`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'summary.txt';
    a.click();
  });

  copyTranscriptBtn.addEventListener('click', async () => {
    const text = currentSummaryData?.transcript || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyTranscriptBtn.textContent = '✓ Скопировано';
      setTimeout(() => { copyTranscriptBtn.textContent = 'Скопировать текст'; }, 1500);
    } catch {
      showError('Не удалось скопировать текст');
    }
  });

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  if (audioOnlyEl) {
    audioOnlyEl.addEventListener('change', () => syncStopChecks('audio'));
  }
  if (transcriptOnlyEl) {
    transcriptOnlyEl.addEventListener('change', () => syncStopChecks('transcript'));
  }
  if (sttApiKeyEl) sttApiKeyEl.addEventListener('change', saveKeys);
  if (summarizeApiKeyEl) summarizeApiKeyEl.addEventListener('change', saveKeys);
  document.querySelectorAll('input[name="stt-provider"], input[name="summarize-provider"]').forEach((el) => {
    el.addEventListener('change', saveKeys);
  });

  if (runSteps) {
    runSteps.addEventListener('click', (event) => {
      const transcribeBtn = event.target.closest('[data-retry-transcribe]');
      if (transcribeBtn && !transcribeBtn.disabled) {
        requestTranscribe();
        return;
      }
      const summarizeBtn = event.target.closest('[data-retry-summarize]');
      if (summarizeBtn && !summarizeBtn.disabled) {
        requestSummarize();
      }
    });
  }

  if (continueTranscribeBtn) {
    continueTranscribeBtn.addEventListener('click', () => {
      requestTranscribe();
    });
  }

  if (continueSummarizeBtn) {
    continueSummarizeBtn.addEventListener('click', () => {
      requestSummarize();
    });
  }

  loadSavedKeys();
  checkTools();
  syncProcessLabel();
})();
