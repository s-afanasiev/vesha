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
  const audioReadyBar = document.getElementById('audio-ready-bar');
  const continueSummarizeBtn = document.getElementById('continue-summarize-btn');
  const downloadAudioLink = document.getElementById('download-audio-link');

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

  function isAudioOnly() {
    return Boolean(audioOnlyEl && audioOnlyEl.checked);
  }

  function syncProcessLabel() {
    if (!processBtnLabel) return;
    processBtnLabel.textContent = isAudioOnly()
      ? 'Получить аудио'
      : 'Запустить суммаризацию';
  }

  function hideAudioReadyBar() {
    if (audioReadyBar) audioReadyBar.hidden = true;
    if (continueSummarizeBtn) continueSummarizeBtn.disabled = false;
  }

  function showAudioReadyBar(job) {
    if (!audioReadyBar) return;
    audioReadyBar.hidden = false;
    if (downloadAudioLink && job.audioUrl) {
      downloadAudioLink.href = job.audioUrl + (job.audioUrl.includes('?') ? '&' : '?') + 'download=1';
    }
    if (continueSummarizeBtn) continueSummarizeBtn.disabled = false;
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
    return [
      'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      '  Content-Type: application/json',
      '  parts: prompt (суммаризация на русском) + inlineData audio.wav',
    ].join('\n');
  }

  function applyAudioOnlyToSteps(steps, audioOnly) {
    if (!audioOnly) return steps;
    return steps.map((s) => {
      if (s.id !== 'summarize') return s;
      return {
        ...s,
        status: 'skipped',
        waitHint: 'Пропущен: выбрано «только аудио». Можно запустить позже, не качая заново.',
        detail: 'Автоматически не стартует. Кнопка появится, когда будет audio.wav.',
      };
    });
  }

  function previewUrlSteps(url, audioOnly) {
    return applyAudioOnlyToSteps(
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
          waitHint: audioOnly
            ? 'После этого шага остановимся: суммаризация не запустится сама.'
            : 'Ещё не начался. Стартует сразу после скачивания.',
          detail: 'Ждёт файл source.* от yt-dlp.',
        },
        {
          n: 3,
          id: 'summarize',
          title: 'Распознавание речи и суммаризация',
          tool: 'Gemini',
          why: 'Модель получит готовый WAV и вернёт расшифровку, тезисы, таймкоды и список задач.',
          command: geminiPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов audio.wav.',
          detail: 'Ждёт audio.wav после ffmpeg.',
        },
      ],
      audioOnly
    );
  }

  function previewFileSteps(filename, audioOnly) {
    const src = filename || 'source.*';
    return applyAudioOnlyToSteps(
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
          waitHint: audioOnly
            ? 'После этого шага остановимся: суммаризация не запустится сама.'
            : 'Ещё не начался. Запустится первым, как только дойдёт очередь.',
          detail: 'Ставим задачу и сразу показываем весь план шагов.',
        },
        {
          n: 2,
          id: 'summarize',
          title: 'Распознавание речи и суммаризация',
          tool: 'Gemini',
          why: 'Модель получит готовый WAV и вернёт расшифровку, тезисы, таймкоды и список задач.',
          command: geminiPreviewCommand(),
          status: 'pending',
          progress: 0,
          waitHint: 'Ещё не начался. Стартует, когда будет готов audio.wav.',
          detail: 'Ждёт audio.wav после ffmpeg.',
        },
      ],
      audioOnly
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
      runLogLead.textContent = 'Один из шагов завершился с ошибкой. Ниже видно, на какой команде остановились.';
      return;
    }
    if (jobStatus === 'audio_ready') {
      runLogTitle.textContent = 'Аудио готово · суммаризация на паузе';
      runLogLead.textContent = 'Скачивание и извлечение звука закончены. Распознавание не запускалось — его можно включить кнопкой ниже.';
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
    stopElapsedClock();
  }

  function applyJobView(job) {
    renderRunSteps(job.steps || [], job.status);
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

  async function pollJob(jobId) {
    const res = await fetch('/api/summarize/jobs/' + encodeURIComponent(jobId));
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Не удалось узнать статус');

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
      else if (job.phase === 'summarizing') showStatus('Распознаём речь и суммаризируем…');
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
      refreshHistoryIfOpen();
      throw new Error(job.error || 'Задача не выполнилась');
    }

    applyJobView(job);
    currentJobData = {
      id: job.id,
      jobId: job.id,
      sourceTitle: job.title,
      audioUrl: job.audioUrl,
      bytes: job.bytes,
      provider: job.provider,
      model: job.model,
    };

    if (job.status === 'audio_ready' || (job.canSummarize && !job.summary)) {
      showStatus('Аудио готово. Распознавание не запускалось.');
      currentSummaryData = null;
      renderAudioOnlyResult(job);
      showAudioReadyBar(job);
      processBtn.disabled = false;
      checkTools();
      refreshHistoryIfOpen();
      return;
    }

    hideAudioReadyBar();
    showStatus('Суммаризация готова!');
    currentSummaryData = job.summary || {};
    renderResults(currentSummaryData, currentJobData);
    processBtn.disabled = false;
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

  function renderHistory(items) {
    historyList.innerHTML = '';
    if (historyError) {
      historyError.hidden = true;
      historyError.textContent = '';
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
        item.hasSummary ? 'С суммаризацией' : item.audioOnly ? 'Только аудио' : null
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
        const dl = document.createElement('a');
        dl.className = 'vesha-btn vesha-btn--sm vesha-btn--outline';
        dl.href = item.audioUrl + (item.audioUrl.includes('?') ? '&' : '?') + 'download=1';
        dl.textContent = 'Скачать аудио';
        dl.setAttribute('download', '');
        actions.appendChild(dl);
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
      renderHistory(Array.isArray(data.items) ? data.items : []);
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
    const audioOnly = isAudioOnly();
    const preview =
      activeTab === 'panel-url'
        ? previewUrlSteps(url, audioOnly)
        : previewFileSteps(targetFile && targetFile.name, audioOnly);
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
            : 'Ставим задачу в очередь. Ниже уже виден весь план шагов.'
        );
        const res = await fetch('/api/summarize/from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, audioOnly }),
        });
        job = await res.json();
        if (!res.ok) throw new Error(job.error || 'Ошибка постановки в очередь');
      } else {
        showStatus('Загружаем файл. Ниже уже виден весь план шагов.');
        const fd = new FormData();
        fd.append('file', targetFile);
        fd.append('audioOnly', audioOnly ? 'true' : 'false');
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
    audioOnlyEl.addEventListener('change', syncProcessLabel);
  }

  if (continueSummarizeBtn) {
    continueSummarizeBtn.addEventListener('click', async () => {
      const jobId = currentJobData && currentJobData.jobId;
      if (!jobId) {
        showError('Нет готового аудио для суммаризации');
        return;
      }
      showError('');
      continueSummarizeBtn.disabled = true;
      processBtn.disabled = true;
      hideAudioReadyBar();
      showStatus('Ставим суммаризацию в очередь. Аудио уже есть, скачивать не будем.');
      try {
        const res = await fetch('/api/summarize/jobs/' + encodeURIComponent(jobId) + '/summarize', {
          method: 'POST',
        });
        const job = await res.json();
        if (!res.ok) throw new Error(job.error || 'Не удалось запустить суммаризацию');
        renderQueue(job);
        applyJobView(job);
        await pollJob(job.id);
      } catch (err) {
        queueCard.hidden = true;
        showAudioReadyBar({
          audioUrl: currentJobData.audioUrl,
        });
        showError(err.message || 'Ошибка суммаризации');
        showStatus('');
        processBtn.disabled = false;
        continueSummarizeBtn.disabled = false;
      }
    });
  }

  checkTools();
  syncProcessLabel();
})();
