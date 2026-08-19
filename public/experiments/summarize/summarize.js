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

  const pipeline = document.getElementById('pipeline');
  const stepExtract = document.getElementById('step-extract');
  const stepStt = document.getElementById('step-stt');
  const stepAi = document.getElementById('step-ai');
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

  function showStatus(text) {
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
  }

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  function setPipelineStep(stepEl, state) {
    stepEl.classList.remove('is-active', 'is-done');
    if (state === 'active') stepEl.classList.add('is-active');
    if (state === 'done') stepEl.classList.add('is-done');
  }

  // Load server tool availability
  async function checkTools() {
    try {
      const res = await fetch('/api/summarize/tools');
      const data = await res.json();
      if (data.ready) {
        toolsStatusEl.textContent = `yt-dlp ${data.ytdlp?.version || ''} · ffmpeg готов · AI: ${data.geminiConfigured ? 'Gemini active' : 'demo mode'}`;
        toolsStatusEl.style.color = '#34d399';
      } else {
        toolsStatusEl.textContent = 'Локальные бинарники: не установлены (работает браузерный режим)';
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

  // Pipeline Processing Flow
  processBtn.addEventListener('click', async () => {
    showError('');
    showStatus('');
    resultSection.hidden = true;

    const activeTab = document.querySelector('.summarize-tab.is-active').dataset.target;
    const mode = document.querySelector('input[name="proc-mode"]:checked').value;

    let targetFile = currentFile;
    let url = urlInput.value.trim();

    if (activeTab === 'panel-url' && !url) {
      showError('Укажите корректную ссылку на видео или аудио');
      return;
    }
    if (activeTab === 'panel-file' && !targetFile) {
      showError('Выберите или перетащите видео/аудио файл');
      return;
    }

    processBtn.disabled = true;
    pipeline.hidden = false;
    setPipelineStep(stepExtract, 'active');
    setPipelineStep(stepStt, 'pending');
    setPipelineStep(stepAi, 'pending');

    try {
      let audioUrl = '';
      let jobId = null;
      let transcriptText = '';
      let sourceTitle = targetFile ? targetFile.name : url;

      // STEP 1: Extract Audio
      showStatus('Шаг 1: Извлечение звука…');

      if (activeTab === 'panel-url') {
        const res = await fetch('/api/summarize/from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки по ссылке');
        jobId = data.id;
        audioUrl = data.audioUrl;
        sourceTitle = data.title || url;
      } else {
        // If file provided: extract locally or upload to server
        if (mode === 'client' && targetFile.type.includes('video')) {
          showStatus('Шаг 1: Извлечение аудио из видео в браузере (WebAudio)…');
          const wavBlob = await extractAudioInBrowser(targetFile);
          currentAudioBlob = wavBlob;
          audioUrl = URL.createObjectURL(wavBlob);
        } else {
          showStatus('Шаг 1: Загрузка и конвертация аудио на сервере…');
          const fd = new FormData();
          fd.append('file', targetFile);
          const res = await fetch('/api/summarize/upload', {
            method: 'POST',
            body: fd,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Ошибка загрузки файла');
          jobId = data.id;
          audioUrl = data.audioUrl;
          sourceTitle = data.title || targetFile.name;
        }
      }

      setPipelineStep(stepExtract, 'done');
      setPipelineStep(stepStt, 'active');

      // STEP 2: Speech-to-Text / Audio Processing
      showStatus('Шаг 2: Распознавание речи…');
      if (mode === 'client' && currentAudioBlob) {
        transcriptText = await transcribeLocally(currentAudioBlob);
      }

      setPipelineStep(stepStt, 'done');
      setPipelineStep(stepAi, 'active');

      // STEP 3: AI Summarization
      showStatus('Шаг 3: Генерация структурированной суммаризации и таймкодов…');
      const aiRes = await fetch('/api/summarize/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          transcriptText,
          mode,
        }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiData.error || 'Ошибка суммаризации');

      setPipelineStep(stepAi, 'done');
      showStatus('Суммаризация готова!');

      // Render Results
      currentSummaryData = aiData.summary || {};
      currentJobData = { sourceTitle, audioUrl, jobId };
      renderResults(currentSummaryData, currentJobData);
    } catch (err) {
      showError(err.message || 'Ошибка обработки');
      showStatus('');
    } finally {
      processBtn.disabled = false;
    }
  });

  function renderResults(summary, job) {
    resultSection.hidden = false;
    resultTitle.textContent = summary.title || job.sourceTitle || 'Результат суммаризации';

    // Meta tags
    resultMetaTags.innerHTML = `
      <span class="summarize-tag">Язык: ${summary.language || 'ru'}</span>
      ${summary.timeline?.length ? `<span class="summarize-tag">Главы: ${summary.timeline.length}</span>` : ''}
      ${summary.key_points?.length ? `<span class="summarize-tag">Тезисы: ${summary.key_points.length}</span>` : ''}
      <span class="summarize-tag" style="color:var(--sm-accent)">Готово</span>
    `;

    // Audio player
    if (job.audioUrl) {
      player.src = job.audioUrl;
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

  checkTools();
})();
