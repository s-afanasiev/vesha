function na(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(NA|N\/A|None|null|-|Unknown)$/i.test(s)) return null;
  return s;
}

function num(v) {
  const s = na(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function formatSpeed(bps) {
  const label = formatBytes(bps);
  return label ? `${label}/с` : null;
}

function formatElapsed(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function prettySizeToken(token) {
  const s = na(token);
  if (!s) return null;
  if (s === '?' || /unknown/i.test(s)) return null;
  return s.replace(/~/g, '≈ ');
}

function prettySpeedToken(token) {
  const s = na(token);
  if (!s || /unknown/i.test(s)) return null;
  return s
    .replace(/MiB\/s/i, 'МиБ/с')
    .replace(/KiB\/s/i, 'КиБ/с')
    .replace(/GiB\/s/i, 'ГиБ/с')
    .replace(/B\/s/i, 'Б/с');
}

function kindFromDestination(name) {
  const lower = String(name || '').toLowerCase();
  if (/\.f\d+\.(mp4|webm|mkv|mov)$/i.test(lower) || /video/i.test(lower)) return 'видео';
  if (/\.(m4a|mp3|opus|ogg|aac)$/i.test(lower) || /audio/i.test(lower)) return 'аудио';
  if (/\.f1(39|40|249|250|251)\./i.test(lower)) return 'аудио';
  return 'файл';
}

function translateLine(line) {
  if (/\[Cookies\].*Extracting cookies from (\w+)/i.test(line)) {
    const browser = line.match(/from (\w+)/i)[1];
    return `Читаем cookies из ${browser}. Это может занять несколько секунд, файл ещё не качается.`;
  }
  if (/\[Cookies\].*Extracted (\d+)/i.test(line)) {
    return `Взяли ${line.match(/Extracted (\d+)/i)[1]} cookies. Дальше запрашиваем страницу ролика.`;
  }
  if (/Extracting URL/i.test(line)) return 'Разбираем ссылку и определяем площадку.';
  if (/Downloading webpage/i.test(line)) return 'Соединяемся с YouTube: скачиваем страницу ролика.';
  if (/Downloading.*player API JSON/i.test(line)) return 'Запрашиваем API плеера YouTube — получаем список форматов.';
  if (/Downloading player/i.test(line)) return 'Загружаем JS-плеер YouTube (нужен, чтобы обойти защиту).';
  if (/Downloading m3u8/i.test(line)) return 'Получаем HLS-манифест.';
  if (/Downloading tv client config/i.test(line)) return 'Запрашиваем конфиг TV-клиента YouTube.';
  if (/Downloading ios (client )?config/i.test(line)) return 'Запрашиваем конфиг iOS-клиента YouTube.';
  if (/Downloading android (player )?API/i.test(line)) return 'Запрашиваем Android API YouTube.';
  if (/Sleeping ([\d.]+) seconds/i.test(line)) {
    return `YouTube просит подождать ${line.match(/Sleeping ([\d.]+)/i)[1]} с — соединение ещё не на загрузке файла.`;
  }
  if (/Downloading 1 format\(s\):\s*(.+)/i.test(line)) {
    return `Выбраны форматы: ${line.match(/format\(s\):\s*(.+)/i)[1].trim()} (обычно видео + аудио). Сейчас откроем загрузку.`;
  }
  if (/\[info\].*Downloading (\d+) format/i.test(line)) {
    return line.replace(/^\[info\]\s*/i, 'Информация: ');
  }
  if (/\[Merger\]/i.test(line)) return 'Файл(ы) скачаны. Склеиваем видео и аудио через ffmpeg.';
  if (/Deleting original file/i.test(line)) return 'Удаляем временные куски после склейки.';
  if (/Destination:\s*(.+)/i.test(line)) {
    const dest = line.match(/Destination:\s*(.+)/i)[1].trim();
    return `Начали писать файл ${dest}. Если скорость ещё пустая — ждём первые байты.`;
  }
  if (/Retrying/i.test(line)) return `Повтор соединения: ${line}`;
  if (/Failed to resolve|getaddrinfo failed|Errno 11001/i.test(line)) {
    return 'DNS не резолвит YouTube по IPv6 (Windows 11001). Нужен IPv4. Повтор без IPv6…';
  }
  if (/^WARNING:/i.test(line)) return `Предупреждение: ${line.replace(/^WARNING:\s*/i, '')}`;
  if (/^ERROR:/i.test(line)) return `Ошибка: ${line.replace(/^ERROR:\s*/i, '')}`;
  if (/^\[download\]/.test(line) && /%\s+of/.test(line)) return null;
  if (/^PROGRESS\t/.test(line) || /^TITLE\t/.test(line) || /^META\t/.test(line)) return null;
  if (/^\[debug\]/i.test(line)) return null;
  if (/^\[[^\]]+\]/.test(line)) return line.replace(/^\[[^\]]+\]\s*/, '');
  return line;
}

function createYtdlpTracker({ cookiesBrowser, startedAt }) {
  const state = {
    phase: 'starting',
    title: null,
    format: null,
    resolution: null,
    duration: null,
    destination: null,
    streamKind: null,
    streamIndex: 0,
    percent: null,
    speed: null,
    eta: null,
    sizeLabel: null,
    downloadedLabel: null,
    downloadedBytes: null,
    totalBytes: null,
    fragment: null,
    fragmentCount: null,
    estimated: false,
    log: [],
    cookies: cookiesBrowser || null,
  };

  function setPhase(phase) {
    const rank = {
      starting: 0,
      cookies: 1,
      resolving: 2,
      formats: 3,
      connecting: 4,
      downloading: 5,
      merging: 6,
    };
    if ((rank[phase] || 0) >= (rank[state.phase] || 0)) state.phase = phase;
  }

  function pushLog(human) {
    if (!human) return;
    if (state.log[state.log.length - 1] === human) return;
    state.log.push(human);
    if (state.log.length > 8) state.log.shift();
  }

  function applyProgress({
    percent,
    speed,
    eta,
    sizeLabel,
    downloadedLabel,
    downloadedBytes,
    totalBytes,
    fragment,
    fragmentCount,
    estimated,
  }) {
    if (percent != null) state.percent = percent;
    if (speed) state.speed = speed;
    if (eta) state.eta = eta;
    if (sizeLabel) state.sizeLabel = sizeLabel;
    if (downloadedLabel) state.downloadedLabel = downloadedLabel;
    if (downloadedBytes != null) state.downloadedBytes = downloadedBytes;
    if (totalBytes != null) state.totalBytes = totalBytes;
    if (fragment != null) state.fragment = fragment;
    if (fragmentCount != null) state.fragmentCount = fragmentCount;
    if (estimated != null) state.estimated = estimated;
    if (percent != null || downloadedBytes > 0 || (speed && speed !== '—')) {
      setPhase('downloading');
    } else {
      setPhase('connecting');
    }
  }

  function ingestLine(line) {
    if (!line) return;

    if (line.startsWith('TITLE\t')) {
      state.title = na(line.slice(6));
      if (state.title) pushLog(`Название ролика: ${state.title}`);
      return;
    }

    if (line.startsWith('META\t')) {
      const parts = line.split('\t');
      state.duration = num(parts[1]);
      state.resolution = na(parts[2]);
      state.format = na(parts[4]) || state.format;
      pushLog(
        `Метаданные: ${[state.resolution, state.format, state.duration ? `${Math.round(state.duration)} с` : null]
          .filter(Boolean)
          .join(' · ') || 'получены'}`
      );
      return;
    }

    if (line.startsWith('PROGRESS\t')) {
      const p = line.split('\t');
      const downloadedBytes = num(p[1]);
      const totalBytes = num(p[2]) || num(p[3]);
      const speedBps = num(p[4]);
      const etaSec = num(p[5]);
      const frag = num(p[7]);
      const fragCount = num(p[8]);
      let percent = null;
      if (downloadedBytes != null && totalBytes) {
        percent = Math.max(0, Math.min(99.9, (downloadedBytes / totalBytes) * 100));
      }
      applyProgress({
        percent,
        speed: formatSpeed(speedBps) || (downloadedBytes ? 'считаем…' : null),
        eta: etaSec != null ? formatElapsed(etaSec) : null,
        sizeLabel: formatBytes(totalBytes),
        downloadedLabel: formatBytes(downloadedBytes),
        downloadedBytes,
        totalBytes,
        fragment: frag,
        fragmentCount: fragCount,
        estimated: !num(p[2]) && Boolean(num(p[3])),
      });
      return;
    }

    const dest = line.match(/\[download\]\s+Destination:\s+(.+)/i);
    if (dest) {
      state.destination = dest[1].trim();
      state.streamIndex += 1;
      state.streamKind = kindFromDestination(state.destination);
      state.percent = 0;
      state.speed = null;
      setPhase('connecting');
      pushLog(
        `Начали скачивать ${state.streamKind}: ${state.destination}. Ждём первые байты и скорость.`
      );
      return;
    }

    const progress = line.match(
      /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~?)\s*(\S+)\s+at\s+(\S+)(?:\s+ETA\s+(\S+))?(?:\s+\(frag\s+(\d+)\/(\d+)\))?/i
    );
    if (progress) {
      applyProgress({
        percent: Number(progress[1]),
        estimated: Boolean(progress[2]),
        sizeLabel: prettySizeToken(progress[3]),
        speed: prettySpeedToken(progress[4]),
        eta: na(progress[5]) && !/unknown/i.test(progress[5]) ? progress[5] : null,
        fragment: progress[6] ? Number(progress[6]) : null,
        fragmentCount: progress[7] ? Number(progress[7]) : null,
      });
      return;
    }

    const done = line.match(/\[download\]\s+100%\s+of\s+(\S+)\s+in\s+(\S+)(?:\s+at\s+(\S+))?/i);
    if (done) {
      applyProgress({
        percent: 100,
        sizeLabel: prettySizeToken(done[1]),
        downloadedLabel: prettySizeToken(done[1]),
        speed: prettySpeedToken(done[3]),
        eta: '00:00',
      });
      pushLog(`Поток скачан: ${prettySizeToken(done[1]) || 'готово'} за ${done[2]}.`);
      return;
    }

    if (/\[Merger\]/i.test(line)) {
      setPhase('merging');
      pushLog(translateLine(line));
      return;
    }
    if (/\[Cookies\]/i.test(line)) {
      setPhase('cookies');
      pushLog(translateLine(line));
      return;
    }
    if (/Downloading 1 format/i.test(line) || /Downloading \d+ format/i.test(line)) {
      const formats = line.match(/format\(s\):\s*(.+)/i);
      if (formats) state.format = formats[1].trim();
      setPhase('formats');
      pushLog(translateLine(line));
      return;
    }
    if (/Extracting URL|Downloading webpage|player API|Downloading player|m3u8|client config/i.test(line)) {
      setPhase('resolving');
      pushLog(translateLine(line));
      return;
    }

    const human = translateLine(line);
    if (human) pushLog(human);
  }

  function ingest(chunk) {
    const text = String(chunk || '').replace(/\r/g, '\n');
    for (const line of text.split('\n')) {
      ingestLine(line.trim());
    }
  }

  function phaseLabel(elapsedSec) {
    const t = formatElapsed(elapsedSec);
    switch (state.phase) {
      case 'cookies':
        return `Читаем cookies ${state.cookies || 'браузера'} · прошло ${t}. Файл ещё не качается.`;
      case 'resolving':
        return `Соединяемся с YouTube и разбираем ролик · прошло ${t}. Скорости ещё нет — это запросы API, не скачивание.`;
      case 'formats':
        return `Форматы выбраны${state.format ? ` (${state.format})` : ''}. Открываем соединение на файл · прошло ${t}.`;
      case 'connecting':
        return `Соединение открыто${state.destination ? `, пишем ${state.destination}` : ''}. Ждём первые байты · прошло ${t}.`;
      case 'downloading': {
        const pct = state.percent != null ? `${Math.round(state.percent)}%` : 'идёт';
        const spd = state.speed || 'скорость считается…';
        const kind = state.streamKind ? ` (${state.streamKind})` : '';
        return `Скачивание идёт${kind}: ${pct} · ${spd} · прошло ${t}.`;
      }
      case 'merging':
        return `Скачивание закончено, склеиваем видео+аудио · прошло ${t}.`;
      default:
        return `yt-dlp запущен, пытаемся соединиться с YouTube${state.cookies ? ` (cookies ${state.cookies})` : ''} · прошло ${t}. Скорости нет, пока не пойдут байты файла.`;
    }
  }

  function snapshot() {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const downloading = state.phase === 'downloading' && state.percent != null;
    const sizeValue = (() => {
      if (state.downloadedLabel && state.sizeLabel) {
        return `${state.downloadedLabel} из ${state.estimated ? '≈ ' : ''}${state.sizeLabel}`;
      }
      if (state.sizeLabel) return `0 из ${state.sizeLabel}`;
      if (state.phase === 'downloading' || state.phase === 'connecting') {
        return 'размер пока неизвестен — YouTube не всегда отдаёт его сразу';
      }
      return 'ещё 0 — до файла не дошли';
    })();

    const speedValue = state.speed
      ? state.speed
      : state.phase === 'downloading' || state.phase === 'connecting'
        ? 'пока нет — ждём первые байты'
        : 'нет: сейчас не качаем файл, а соединяемся';

    const items = [
      { key: 'speed', label: 'Скорость', value: speedValue },
      { key: 'size', label: 'Скачано', value: sizeValue },
      {
        key: 'eta',
        label: 'Осталось',
        value: state.eta || (downloading ? 'считаем после стабилизации скорости' : 'появится, когда пойдёт файл'),
      },
      { key: 'elapsed', label: 'Прошло', value: formatElapsed(elapsedSec) },
    ];
    if (state.destination) {
      items.push({
        key: 'file',
        label: 'Файл',
        value: `${state.streamKind || 'файл'}: ${state.destination}${state.streamIndex > 1 ? ` · поток ${state.streamIndex}` : ''}`,
      });
    }
    if (state.fragment && state.fragmentCount) {
      items.push({
        key: 'frag',
        label: 'Фрагмент',
        value: `${state.fragment} из ${state.fragmentCount}`,
      });
    }
    if (state.format || state.resolution) {
      items.push({
        key: 'format',
        label: 'Формат',
        value: [state.format, state.resolution].filter(Boolean).join(' · '),
      });
    }
    if (state.title) {
      items.push({ key: 'title', label: 'Ролик', value: state.title });
    }

    return {
      status: 'active',
      progress: downloading ? Math.max(0, Math.min(99, Math.round(state.percent))) : state.phase === 'merging' ? 99 : 0,
      indeterminate: !downloading,
      startedAt: new Date(startedAt).toISOString(),
      detail: phaseLabel(elapsedSec),
      stats: {
        phase: state.phase,
        phaseLabel: phaseLabel(elapsedSec),
        items,
        log: state.log.slice(-6),
      },
    };
  }

  return { ingest, snapshot, title: () => state.title || null };
}

module.exports = {
  createYtdlpTracker,
  formatElapsed,
  formatBytes,
  formatSpeed,
};
