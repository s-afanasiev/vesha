function quoteArg(arg) {
  const s = String(arg);
  if (!s.length) return '""';
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function formatCommand(binName, args) {
  return [binName, ...args.map(quoteArg)].join(' ');
}

function geminiCommand(model) {
  const name = model || 'gemini-2.5-flash';
  return [
    `POST https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`,
    '  Content-Type: application/json',
    '  parts: prompt (суммаризация на русском) + inlineData audio.wav',
  ].join('\n');
}

function ytdlpShowArgs(url, cookiesBrowser = 'firefox') {
  return [
    '--js-runtimes',
    'node',
    ...(cookiesBrowser ? ['--cookies-from-browser', cookiesBrowser] : []),
    '--force-ipv4',
    '--ffmpeg-location',
    'ffmpeg',
    '-f',
    'bestvideo+bestaudio/best',
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-mtime',
    '-o',
    'source.%(ext)s',
    url,
  ];
}

function ffmpegPreviewArgs(input) {
  return [
    '-y',
    '-i',
    input || 'source.*',
    '-vn',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-nostats',
    '-progress',
    'pipe:1',
    'audio.wav',
  ];
}

function emptyDownloadStats() {
  return {
    phase: 'pending',
    phaseLabel: 'Ещё не начался. После запуска здесь появятся этап, скорость и размер.',
    items: [
      { key: 'speed', label: 'Скорость', value: '—' },
      { key: 'size', label: 'Скачано', value: '—' },
      { key: 'eta', label: 'Осталось', value: '—' },
      { key: 'elapsed', label: 'Прошло', value: '—' },
    ],
    log: [],
  };
}

function makeStep({ n, id, title, tool, why, command, waitHint, detail, stats }) {
  return {
    n,
    id,
    title,
    tool,
    why,
    command,
    waitHint,
    detail,
    stats: stats || null,
    status: 'pending',
    progress: 0,
    indeterminate: false,
  };
}

function skipSummarizeStep(steps, detail) {
  return patchStep(steps, 'summarize', {
    status: 'skipped',
    progress: 0,
    indeterminate: false,
    waitHint:
      detail ||
      'Не запускается: выбран режим «только аудио». После извлечения звука можно попросить суммаризацию.',
    detail:
      detail ||
      'Не запускается: выбран режим «только аудио». После извлечения звука можно попросить суммаризацию.',
  });
}

function buildUrlSteps(url, { audioOnly = false } = {}) {
  const steps = [
    makeStep({
      n: 1,
      id: 'download',
      title: 'Скачивание видео',
      tool: 'yt-dlp',
      why: 'Шаг качает ролик через yt-dlp (видео+аудио). Ниже — живой этап: соединение это или уже байты файла, плюс скорость.',
      command: formatCommand('yt-dlp', ytdlpShowArgs(url)),
      waitHint: 'Ещё не начался. Запустится первым, как только дойдёт очередь.',
      detail: 'В очереди. Как только сервер освободится — запустим эту команду.',
      stats: emptyDownloadStats(),
    }),
    makeStep({
      n: 2,
      id: 'ffmpeg',
      title: 'Извлечение звука',
      tool: 'ffmpeg',
      why: 'После скачивания вырежем аудиодорожку и приведём к WAV 16 kHz mono — так удобнее модели.',
      command: formatCommand('ffmpeg', ffmpegPreviewArgs('source.*')),
      waitHint: audioOnly
        ? 'После этого шага остановимся: суммаризация не запустится сама.'
        : 'Ещё не начался. Стартует сразу после скачивания.',
      detail: 'Ждёт файл source.* от yt-dlp.',
    }),
    makeStep({
      n: 3,
      id: 'summarize',
      title: 'Распознавание речи и суммаризация',
      tool: 'Gemini',
      why: 'Модель получит готовый WAV и вернёт расшифровку, тезисы, таймкоды и список задач.',
      command: geminiCommand(),
      waitHint: audioOnly
        ? 'Пропущен: выбрано «только аудио». Можно запустить позже, не качая ролик заново.'
        : 'Ещё не начался. Стартует, когда будет готов audio.wav.',
      detail: audioOnly
        ? 'Автоматически не стартует. Кнопка появится, когда будет audio.wav.'
        : 'Ждёт audio.wav после ffmpeg.',
    }),
  ];
  return audioOnly ? skipSummarizeStep(steps) : steps;
}

function buildFileSteps(filename, { audioOnly = false } = {}) {
  const src = filename || 'source.*';
  const steps = [
    makeStep({
      n: 1,
      id: 'ffmpeg',
      title: 'Извлечение звука',
      tool: 'ffmpeg',
      why: 'Из загруженного файла вырежем дорожку и сделаем WAV 16 kHz mono.',
      command: formatCommand('ffmpeg', ffmpegPreviewArgs(src)),
      waitHint: audioOnly
        ? 'После этого шага остановимся: суммаризация не запустится сама.'
        : 'Ещё не начался. Запустится первым, как только дойдёт очередь.',
      detail: 'В очереди. Как только сервер освободится — запустим эту команду.',
    }),
    makeStep({
      n: 2,
      id: 'summarize',
      title: 'Распознавание речи и суммаризация',
      tool: 'Gemini',
      why: 'Модель получит готовый WAV и вернёт расшифровку, тезисы, таймкоды и список задач.',
      command: geminiCommand(),
      waitHint: audioOnly
        ? 'Пропущен: выбрано «только аудио». Можно запустить позже.'
        : 'Ещё не начался. Стартует, когда будет готов audio.wav.',
      detail: audioOnly
        ? 'Автоматически не стартует. Кнопка появится, когда будет audio.wav.'
        : 'Ждёт audio.wav после ffmpeg.',
    }),
  ];
  return audioOnly ? skipSummarizeStep(steps) : steps;
}

function patchStep(steps, id, patch) {
  return (steps || []).map((s) => (s.id === id ? { ...s, ...patch } : s));
}

function markDone(steps, id, detail) {
  return patchStep(steps, id, {
    status: 'done',
    progress: 100,
    indeterminate: false,
    detail: detail || undefined,
  });
}

module.exports = {
  emptyDownloadStats,
  formatCommand,
  geminiCommand,
  ytdlpShowArgs,
  ffmpegPreviewArgs,
  buildUrlSteps,
  buildFileSteps,
  skipSummarizeStep,
  patchStep,
  markDone,
};
