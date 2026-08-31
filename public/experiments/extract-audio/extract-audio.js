(function () {
  const STORAGE_KEY = 'vesha.extract-audio.ffmpegDir';
  const QUALITY_STORAGE_KEY = 'vesha.extract-audio.quality';
  const DEFAULT_FFMPEG_DIR = 'C:\\CODE\\VESHA\\v1\\bin\\';
  const QUALITY_ARGS = {
    original: '-c:a libmp3lame -q:a 2',
    compact: '-c:a libmp3lame -b:a 96k',
    low: '-ac 1 -ar 22050 -c:a libmp3lame -b:a 48k',
    speech: '-ac 1 -ar 16000 -c:a libmp3lame -b:a 32k',
  };
  const QUALITY_HINTS = {
    original: 'Без дополнительного сжатия: стерео, VBR ~190 кбит/с. Файл как после обычного извлечения.',
    compact: 'Меньше размер: 96 кбит/с, стерео. Речь и музыка ещё звучат нормально.',
    low: 'Заметно хуже и легче: 48 кбит/с, моно, 22 кГц. Речь слышна, файл примерно в 4 раза меньше.',
    speech: 'Минимум для распознавания речи: 32 кбит/с, моно, 16 кГц. Хватает Whisper и похожим движкам.',
  };
  const QUALITY_LABELS = {
    original: 'как есть',
    compact: 'компактнее',
    low: 'хуже',
    speech: 'для речи',
  };

  const ffmpegDirInput = document.getElementById('ffmpeg-dir');
  const probeBtn = document.getElementById('probe-btn');
  const ffmpegHint = document.getElementById('ffmpeg-hint');
  const fileDropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-input');
  const fileChosen = document.getElementById('file-chosen');
  const fileNameEl = document.getElementById('file-name');
  const fileSizeEl = document.getElementById('file-size');
  const fileClearBtn = document.getElementById('file-clear');
  const extractBtn = document.getElementById('extract-btn');
  const commandEl = document.getElementById('ffmpeg-command');
  const copyCmdBtn = document.getElementById('copy-cmd-btn');
  const resetCmdBtn = document.getElementById('reset-cmd-btn');
  const ranCommandEl = document.getElementById('ran-command');
  const progressPanel = document.getElementById('progress-panel');
  const progressLabel = document.getElementById('progress-label');
  const progressPct = document.getElementById('progress-pct');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const errorEl = document.getElementById('error');
  const resultEl = document.getElementById('result');
  const resultMeta = document.getElementById('result-meta');
  const downloadBtn = document.getElementById('download-btn');
  const player = document.getElementById('player');
  const qualityHint = document.getElementById('quality-hint');
  const qualityInputs = Array.from(document.querySelectorAll('input[name="audio-quality"]'));

  let currentFile = null;
  let progressSource = null;
  let commandDirty = false;
  let previewTimer = null;

  function getQuality() {
    const selected = qualityInputs.find((el) => el.checked);
    const value = selected && selected.value;
    return QUALITY_ARGS[value] ? value : 'original';
  }

  function setQuality(value) {
    const id = QUALITY_ARGS[value] ? value : 'original';
    qualityInputs.forEach((el) => {
      el.checked = el.value === id;
    });
    qualityHint.textContent = QUALITY_HINTS[id];
    return id;
  }

  function fallbackCommandLine(ffmpeg, input, quality) {
    const output = input.replace(/\.[^.]+$/, '') + '.mp3';
    const audioArgs = QUALITY_ARGS[quality] || QUALITY_ARGS.original;
    return (
      '"' + ffmpeg + '" -hide_banner -nostdin -y -i "' + input +
      '" -vn ' + audioArgs + ' -progress pipe:1 -nostats "' + output + '"'
    );
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return (bytes / Math.pow(k, i)).toFixed(i ? 1 : 0) + ' ' + sizes[i];
  }

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  function setHint(text, kind) {
    ffmpegHint.textContent = text;
    ffmpegHint.classList.toggle('is-ok', kind === 'ok');
    ffmpegHint.classList.toggle('is-bad', kind === 'bad');
  }

  function setProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    progressPanel.hidden = false;
    progressLabel.textContent = label || 'Извлечение…';
    progressPct.textContent = value + '%';
    progressFill.style.width = value + '%';
    progressBar.setAttribute('aria-valuenow', String(value));
  }

  function setSelectedFile(file) {
    currentFile = file || null;
    if (!file) {
      fileChosen.hidden = true;
      fileDropzone.hidden = false;
      return;
    }
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileChosen.hidden = false;
    fileDropzone.hidden = true;
  }

  function showRanCommand(commandLine) {
    if (!commandLine) {
      ranCommandEl.hidden = true;
      ranCommandEl.textContent = '';
      return;
    }
    ranCommandEl.hidden = false;
    ranCommandEl.textContent = commandLine;
    commandEl.value = commandLine;
  }

  async function refreshCommand(force) {
    if (commandDirty && !force) return;
    const quality = getQuality();
    const params = new URLSearchParams({
      ffmpegDir: ffmpegDirInput.value.trim(),
      inputName: currentFile ? currentFile.name : 'video.mp4',
      quality,
    });
    try {
      const res = await fetch('/api/extract-audio/preview?' + params.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'preview');
      commandEl.value = data.commandLine || '';
      commandDirty = false;
    } catch {
      const ffmpeg = ffmpegDirInput.value.trim() || 'ffmpeg.exe';
      const input = currentFile ? currentFile.name : 'video.mp4';
      commandEl.value = fallbackCommandLine(ffmpeg, input, quality);
      commandDirty = false;
    }
  }

  function scheduleRefreshCommand() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => refreshCommand(false), 200);
  }

  function closeProgressSource() {
    if (progressSource) {
      progressSource.close();
      progressSource = null;
    }
  }

  function showResult(job) {
    resultEl.hidden = false;
    const ext = (job.audioExt || 'mp3').toUpperCase();
    const parts = [ext];
    if (job.bytes) parts.push(formatBytes(job.bytes));
    const qualityLabel = job.qualityLabel || QUALITY_LABELS[job.quality];
    if (qualityLabel) parts.push(qualityLabel);
    resultMeta.textContent = parts.join(' · ');
    downloadBtn.href = job.downloadUrl;
    downloadBtn.setAttribute('download', '');
    player.src = job.downloadUrl;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function isProjectBinPath(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase();
    return normalized === 'c:\\code\\vesha\\v1\\bin';
  }

  async function loadDefaultPath() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !isProjectBinPath(saved)) {
      ffmpegDirInput.value = saved;
    } else {
      ffmpegDirInput.value = DEFAULT_FFMPEG_DIR;
    }
    setQuality(localStorage.getItem(QUALITY_STORAGE_KEY) || 'original');
  }

  async function probeFfmpeg() {
    const ffmpegDir = ffmpegDirInput.value.trim();
    if (!ffmpegDir) {
      setHint('Укажите папку с ffmpeg.exe', 'bad');
      return false;
    }
    probeBtn.disabled = true;
    setHint('Проверяю ffmpeg…');
    try {
      const res = await fetch('/api/extract-audio/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ffmpegDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ffmpeg не найден');
      localStorage.setItem(STORAGE_KEY, ffmpegDir);
      setHint(data.version || 'ffmpeg готов', 'ok');
      return true;
    } catch (err) {
      setHint(err.message || 'Не удалось проверить ffmpeg', 'bad');
      return false;
    } finally {
      probeBtn.disabled = false;
    }
  }

  function uploadJob(file, ffmpegDir, onUploadProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ffmpegDir', ffmpegDir);
      fd.append('command', commandEl.value);
      fd.append('quality', getQuality());

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch {
          data = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        reject(new Error(data.error || 'Ошибка загрузки файла'));
      };
      xhr.onerror = () => reject(new Error('Сеть: не удалось загрузить файл'));
      xhr.open('POST', '/api/extract-audio/jobs');
      xhr.send(fd);
    });
  }

  function watchProgress(jobId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      closeProgressSource();
      const es = new EventSource('/api/extract-audio/jobs/' + jobId + '/progress');
      progressSource = es;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        closeProgressSource();
        fn(value);
      };

      es.onmessage = (e) => {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        if (data.commandLine) showRanCommand(data.commandLine);
        if (typeof data.percent === 'number') {
          setProgress(15 + data.percent * 0.85, 'Извлекаю звук через ffmpeg…');
        }
        if (data.status === 'ready') finish(resolve, data);
        else if (data.status === 'failed') {
          finish(reject, new Error(data.error || 'Не удалось извлечь звук'));
        }
      };

      es.onerror = () => {
        if (settled) return;
        fetch('/api/extract-audio/jobs/' + jobId)
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then(({ ok, data }) => {
            if (!ok) throw new Error(data.error || 'Задание пропало');
            if (data.status === 'ready') {
              finish(resolve, data);
              return;
            }
            if (data.status === 'failed') {
              throw new Error(data.error || 'Не удалось извлечь звук');
            }
            throw new Error('Потеряно соединение с прогрессом');
          })
          .catch((err) => finish(reject, err));
      };
    });
  }

  qualityInputs.forEach((el) => {
    el.addEventListener('change', () => {
      const quality = setQuality(el.value);
      localStorage.setItem(QUALITY_STORAGE_KEY, quality);
      commandDirty = false;
      refreshCommand(true);
    });
  });

  commandEl.addEventListener('input', () => {
    commandDirty = true;
  });

  copyCmdBtn.addEventListener('click', async () => {
    const text = commandEl.value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyCmdBtn.textContent = 'Скопировано';
      setTimeout(() => {
        copyCmdBtn.textContent = 'Копировать';
      }, 1400);
    } catch {
      commandEl.focus();
      commandEl.select();
      showError('Не удалось скопировать — выделите команду вручную');
    }
  });

  resetCmdBtn.addEventListener('click', () => {
    commandDirty = false;
    refreshCommand(true);
  });

  probeBtn.addEventListener('click', async () => {
    const ok = await probeFfmpeg();
    if (ok) scheduleRefreshCommand();
  });

  ffmpegDirInput.addEventListener('change', () => {
    const value = ffmpegDirInput.value.trim();
    if (value) localStorage.setItem(STORAGE_KEY, value);
    scheduleRefreshCommand();
  });

  ffmpegDirInput.addEventListener('input', () => {
    scheduleRefreshCommand();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      setSelectedFile(fileInput.files[0]);
      scheduleRefreshCommand();
    }
  });

  fileClearBtn.addEventListener('click', () => {
    fileInput.value = '';
    setSelectedFile(null);
    scheduleRefreshCommand();
  });

  ['dragenter', 'dragover'].forEach((name) => {
    fileDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      fileDropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((name) => {
    fileDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      fileDropzone.classList.remove('is-dragover');
    });
  });

  fileDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      scheduleRefreshCommand();
    }
  });

  extractBtn.addEventListener('click', async () => {
    showError('');
    resultEl.hidden = true;
    player.removeAttribute('src');

    const ffmpegDir = ffmpegDirInput.value.trim();
    if (!ffmpegDir) {
      showError('Укажите папку с ffmpeg.exe');
      return;
    }
    if (!currentFile) {
      showError('Выберите видеофайл');
      return;
    }

    extractBtn.disabled = true;
    showRanCommand('');
    setProgress(0, 'Загружаю видео…');

    try {
      const job = await uploadJob(currentFile, ffmpegDir, (ratio) => {
        setProgress(ratio * 15, 'Загружаю видео…');
      });
      localStorage.setItem(STORAGE_KEY, ffmpegDir);
      if (job.commandLine) showRanCommand(job.commandLine);
      setProgress(15, 'Извлекаю звук через ffmpeg…');
      const done = await watchProgress(job.id);
      setProgress(100, 'Готово');
      showResult(done);
    } catch (err) {
      showError(err.message || 'Ошибка извлечения');
    } finally {
      extractBtn.disabled = false;
    }
  });

  loadDefaultPath().then(() => refreshCommand(true));
})();
