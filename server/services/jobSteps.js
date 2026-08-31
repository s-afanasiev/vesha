function quoteArg(arg) {
  const s = String(arg);
  if (!s.length) return '""';
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function formatCommand(binName, args) {
  return [binName, ...args.map(quoteArg)].join(' ');
}

function buildUrlSteps(url) {
  const ytdlpShow = [
    '--js-runtimes',
    'node',
    '--cookies-from-browser',
    'firefox',
    '-f',
    'bestvideo+bestaudio/best',
    '--no-playlist',
    '--newline',
    url,
  ];
  const ffmpegShow = [
    '-y',
    '-i',
    'source.*',
    '-vn',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    'audio.wav',
  ];
  return [
    {
      id: 'download',
      title: 'Скачивание видео',
      command: formatCommand('yt-dlp', ytdlpShow),
      status: 'pending',
      progress: null,
      detail: 'Если YouTube отвечает 403, берём cookies из Firefox и JS-runtime Node.',
    },
    {
      id: 'ffmpeg',
      title: 'Извлечение звука',
      command: formatCommand('ffmpeg', ffmpegShow),
      status: 'pending',
      progress: null,
      detail: 'После скачивания вырежем аудио и приведём к WAV 16 kHz mono.',
    },
    {
      id: 'summarize',
      title: 'Распознавание речи и суммаризация',
      command: 'Gemini generateContent ← audio.wav',
      status: 'pending',
      progress: null,
      detail: 'Модель получит WAV и вернёт расшифровку, тезисы и таймкоды.',
    },
  ];
}

function buildFileSteps(filename) {
  const src = filename || 'source.*';
  return [
    {
      id: 'ffmpeg',
      title: 'Извлечение звука',
      command: formatCommand('ffmpeg', [
        '-y',
        '-i',
        src,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        'audio.wav',
      ]),
      status: 'pending',
      progress: null,
      detail: 'Из загруженного файла вырежем дорожку и сделаем WAV 16 kHz mono.',
    },
    {
      id: 'summarize',
      title: 'Распознавание речи и суммаризация',
      command: 'Gemini generateContent ← audio.wav',
      status: 'pending',
      progress: null,
      detail: 'Модель получит WAV и вернёт расшифровку, тезисы и таймкоды.',
    },
  ];
}

function patchStep(steps, id, patch) {
  return (steps || []).map((s) => (s.id === id ? { ...s, ...patch } : s));
}

function markDone(steps, id, detail) {
  return patchStep(steps, id, {
    status: 'done',
    progress: 100,
    detail: detail || undefined,
  });
}

module.exports = {
  formatCommand,
  buildUrlSteps,
  buildFileSteps,
  patchStep,
  markDone,
};
