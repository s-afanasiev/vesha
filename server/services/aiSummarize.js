const fs = require('fs');
const path = require('path');
const config = require('../config');
const { requireBins, run } = require('./mediaBins');

const INLINE_LIMIT = 12 * 1024 * 1024;

const SUMMARIZE_PROMPT = `Ты эксперт по анализу и суммаризации аудио и видео контента.
Твоя задача — проанализировать предоставленный контент (аудиозапись или расшифровку) и сделать структурированную, полезную и лаконичную выжимку на РУССКОМ языке.

Верни ТОЛЬКО валидный JSON со следующей структурой (без markdown-оберток):
{
  "title": "Краткий и емкий заголовок записи",
  "tldr": "Краткая суть в 2-3 предложениях (главный посыл)",
  "language": "ru|en|другой",
  "key_points": [
    "Ключевой тезис 1 с важными деталями",
    "Ключевой тезис 2 с важными деталями",
    "Ключевой тезис 3..."
  ],
  "timeline": [
    {
      "time": "00:00",
      "seconds": 0,
      "title": "Введение и постановка темы",
      "summary": "Кратко о чем говорится в этом блоке"
    },
    {
      "time": "01:30",
      "seconds": 90,
      "title": "Основная часть...",
      "summary": "..."
    }
  ],
  "action_items": [
    "Конкретные шаги, выводы или задачи, которые упоминаются"
  ],
  "transcript": "Полная или максимально точная текстовая расшифровка (если доступна)"
}

Правила:
- Пиши грамотно, без лишней «воды», выделяй конкретику, факты, цифры и термины.
- Таймкоды должны быть правдоподобными и соответствовать таймингу записи.
- Не выдумывай тему: опирайся только на это аудио. Если речь неразборчива — так и напиши.`;

function htmlErrorMessage(status, text) {
  const plain = String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (status === 413 || /too large|request entity/i.test(text)) {
    return `Слишком большой запрос к Gemini (HTTP ${status}).`;
  }
  if (status === 502 || status === 503 || status === 504 || /Bad Gateway|Gateway Time|504/i.test(text)) {
    return `Шлюз вернул HTML ${status || ''} вместо JSON (таймаут nginx/прокси или Google недоступен).`.replace('  ', ' ');
  }
  return `Ответ не JSON (HTTP ${status || '?'}): ${plain || 'HTML-страница'}`;
}

async function readJsonResponse(res, label) {
  const raw = await res.text();
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    if (!res.ok) throw new Error(`${label}: пустой ответ HTTP ${res.status}`);
    return {};
  }
  if (trimmed.startsWith('<') || /^<!doctype html/i.test(trimmed)) {
    throw new Error(htmlErrorMessage(res.status, trimmed));
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`${label}: ${htmlErrorMessage(res.status, trimmed)} (${err.message})`);
  }
}

function parseJsonLoose(text) {
  if (!text) throw new Error('Пустой ответ модели');
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Не удалось разобрать JSON суммаризации');
  }
}

function mimeFromPath(file) {
  if (file.endsWith('.mp3')) return 'audio/mp3';
  if (file.endsWith('.m4a')) return 'audio/mp4';
  if (file.endsWith('.ogg') || file.endsWith('.opus')) return 'audio/ogg';
  return 'audio/wav';
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function isGeminiLocationError(text) {
  return /location is not supported|FAILED_PRECONDITION/i.test(String(text || ''));
}

function geminiLocationMessage() {
  return (
    'Gemini API недоступен с IP этого сервера (Google: User location is not supported). ' +
    'Нужен прокси из поддерживаемой страны: GEMINI_HTTPS_PROXY=http://user:pass@host:port в .env, ' +
    'либо OPENAI_API_KEY для запасной суммаризации через Whisper.'
  );
}

let proxyDispatcher = null;
function getGeminiDispatcher() {
  if (!config.geminiHttpsProxy) return undefined;
  if (!proxyDispatcher) {
    const { ProxyAgent } = require('undici');
    proxyDispatcher = new ProxyAgent(config.geminiHttpsProxy);
  }
  return proxyDispatcher;
}

function geminiUrl(pathname) {
  const pathPart = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${config.geminiApiBase}${pathPart}`;
}

function geminiFetch(url, options = {}) {
  const dispatcher = getGeminiDispatcher();
  return fetch(url, dispatcher ? { ...options, dispatcher } : options);
}

function throwIfGeminiLocation(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  if (isGeminiLocationError(raw)) {
    throw new Error(geminiLocationMessage());
  }
}

async function compressForGemini(audioPath, report) {
  const dest = path.join(path.dirname(audioPath), 'audio.gemini.mp3');
  try {
    if (
      fs.existsSync(dest) &&
      fs.statSync(dest).mtimeMs >= fs.statSync(audioPath).mtimeMs &&
      fs.statSync(dest).size > 1024
    ) {
      return dest;
    }
  } catch (_) {
    // recode
  }

  const { ffmpeg } = requireBins({ needYtdlp: false });
  report({
    detail: `Сжимаем ${path.basename(audioPath)} в mp3 48 kbps для Gemini…`,
  });
  await run(
    ffmpeg,
    ['-y', '-i', audioPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', dest],
    { timeoutMs: config.summarizeTimeoutMs }
  );
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 256) {
    throw new Error('Не удалось сжать аудио для Gemini');
  }
  return dest;
}

async function uploadGeminiFile(apiKey, filePath, mimeType, report) {
  const size = fs.statSync(filePath).size;
  report({
    detail: `Загружаем ${path.basename(filePath)} (${formatMb(size)} МБ) в Gemini Files API…`,
  });
  const start = await geminiFetch(
    geminiUrl(`/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`),
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { displayName: path.basename(filePath) } }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!start.ok) {
    const text = await start.text();
    throwIfGeminiLocation(text);
    throw new Error(`Gemini upload start HTTP ${start.status}: ${text.slice(0, 240)}`);
  }
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini не вернул URL загрузки файла');

  const body = fs.readFileSync(filePath);
  const put = await geminiFetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body,
    signal: AbortSignal.timeout(config.summarizeTimeoutMs),
  });
  const data = await readJsonResponse(put, 'Gemini upload');
  if (!put.ok) {
    throw new Error(data.error?.message || `Gemini upload HTTP ${put.status}`);
  }
  return data.file || data;
}

async function waitFileActive(apiKey, file, report) {
  let info = file;
  for (let i = 0; i < 40; i++) {
    const state = info.state;
    if (state === 'FAILED') {
      throw new Error(info.error?.message || 'Gemini отклонил загруженный аудиофайл');
    }
    if (state === 'ACTIVE' || (info.uri && !state)) return info;
    report({
      detail: `Gemini готовит файл к распознаванию (${state || 'загрузка'})…`,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const name = String(info.name || '');
    if (!name) {
      if (info.uri) return info;
      throw new Error('Gemini upload: нет имени файла');
    }
    const url = name.startsWith('files/')
      ? geminiUrl(`/v1beta/${name}?key=${encodeURIComponent(apiKey)}`)
      : geminiUrl(`/v1beta/files/${encodeURIComponent(name)}?key=${encodeURIComponent(apiKey)}`);
    const res = await geminiFetch(url, { signal: AbortSignal.timeout(15000) });
    info = await readJsonResponse(res, 'Gemini file status');
    if (!res.ok) {
      throw new Error(info.error?.message || `Gemini file status HTTP ${res.status}`);
    }
  }
  throw new Error('Gemini слишком долго обрабатывает загруженный файл');
}

async function prepareAudioPart(audioPath, report) {
  let sendPath = audioPath;
  let mime = mimeFromPath(audioPath);
  const rawSize = fs.statSync(audioPath).size;
  if (rawSize > INLINE_LIMIT || mime === 'audio/wav') {
    try {
      sendPath = await compressForGemini(audioPath, report);
      mime = 'audio/mp3';
    } catch (err) {
      if (rawSize > INLINE_LIMIT) throw err;
      report({
        detail: `Сжатие не удалось (${err.message}). Отправляем исходный файл ${formatMb(rawSize)} МБ.`,
      });
    }
  }
  const size = fs.statSync(sendPath).size;
  report({
    detail: `Аудио ${path.basename(sendPath)} (${formatMb(size)} МБ) отправим через Gemini Files API, без огромного JSON.`,
  });
  const file = await uploadGeminiFile(config.geminiApiKey, sendPath, mime, report);
  const ready = await waitFileActive(config.geminiApiKey, file, report);
  const fileUri = ready.uri || ready.name;
  if (!fileUri) throw new Error('Gemini upload: нет file.uri');
  return {
    fileData: {
      mimeType: mime,
      fileUri,
    },
  };
}

async function summarizeWithGemini(options = {}) {
  const { audioPath, audioMime = 'audio/wav', transcriptText = '', onProgress } = options;
  const report = (patch) => {
    if (typeof onProgress === 'function') onProgress(patch);
  };

  if (!config.geminiApiKey && config.openaiApiKey) {
    return summarizeWithOpenAI({ audioPath, transcriptText, report });
  }

  if (!config.geminiApiKey) {
    if (config.summarizeMock) {
      report({ detail: 'SUMMARIZE_MOCK=1 и нет ключа — демонстрационный ответ.' });
      return {
        provider: 'mock',
        model: 'mock',
        summary: createMockSummary(transcriptText || 'Аудиозапись'),
      };
    }
    throw new Error('GEMINI_API_KEY не задан на сервере. Суммаризация не запускалась.');
  }

  if (!audioPath || !fs.existsSync(audioPath)) {
    if (transcriptText) {
      try {
        return await requestGemini(
          [{ text: SUMMARIZE_PROMPT }, { text: `Расшифровка:\n\n${transcriptText}` }],
          report
        );
      } catch (err) {
        if (config.openaiApiKey && /недоступен с IP|location is not supported/i.test(err.message)) {
          return summarizeWithOpenAI({ audioPath, transcriptText, report });
        }
        throw err;
      }
    }
    throw new Error('Нет audio.wav для суммаризации — Gemini не вызывался.');
  }

  try {
    const audioPart = await prepareAudioPart(audioPath, report);
    return await requestGemini([{ text: SUMMARIZE_PROMPT }, audioPart], report);
  } catch (err) {
    if (config.openaiApiKey && /недоступен с IP|location is not supported/i.test(err.message)) {
      report({ detail: err.message + ' Переключаемся на OpenAI.' });
      return summarizeWithOpenAI({ audioPath, transcriptText, report });
    }
    if (/недоступен с IP|location is not supported/i.test(err.message)) {
      throw new Error(geminiLocationMessage());
    }
    throw err;
  }
}

async function requestGemini(parts, report) {
  const models = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];
  let lastErr;
  for (const model of models) {
    try {
      report({
        detail: `Отправляем аудио в ${model} и ждём JSON с расшифровкой. Это может занять минуты, не секунды.`,
        command: [
          `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          '  Content-Type: application/json',
          '  parts: prompt + audio (inline или Files API)',
        ].join('\n'),
      });
      const url =
        geminiUrl(`/v1beta/models/${model}:generateContent`) +
        `?key=${encodeURIComponent(config.geminiApiKey)}`;

      const res = await geminiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(config.summarizeTimeoutMs),
      });

      const data = await readJsonResponse(res, model);
      throwIfGeminiLocation(data);
      if (!res.ok) {
        throwIfGeminiLocation(data.error?.message);
        throw new Error(`[${model}] ` + (data.error?.message || `HTTP ${res.status}`));
      }

      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const parsed = parseJsonLoose(text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(`[${model}] ответ без JSON`);
      }
      return {
        provider: 'gemini',
        model,
        summary: parsed,
      };
    } catch (err) {
      lastErr = err;
      report({
        detail: `${model} не сработал: ${err.message}. Пробуем следующую модель…`,
      });
      if (/недоступен с IP|location is not supported/i.test(err.message)) break;
    }
  }

  throw new Error(
    lastErr?.message
      ? `Gemini не суммаризировал аудио: ${lastErr.message}`
      : 'Gemini не суммаризировал аудио'
  );
}

async function summarizeWithOpenAI({ audioPath, transcriptText = '', report }) {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY не задан');
  }
  let transcript = transcriptText;
  if ((!transcript || transcript.length < 20) && audioPath && fs.existsSync(audioPath)) {
    let sendPath = audioPath;
    const mime = mimeFromPath(audioPath);
    if (mime === 'audio/wav' || fs.statSync(audioPath).size > INLINE_LIMIT) {
      sendPath = await compressForGemini(audioPath, report);
    }
    report({
      detail: `Gemini с этого IP недоступен. Отправляем ${path.basename(sendPath)} в OpenAI Whisper…`,
    });
    const fileName = path.basename(sendPath);
    const file = new File([buf], fileName, { type: mimeFromPath(sendPath) });
    const form = new FormData();
    form.append('file', file);
    form.append('model', 'whisper-1');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
      signal: AbortSignal.timeout(config.summarizeTimeoutMs),
    });
    const data = await readJsonResponse(res, 'OpenAI Whisper');
    if (!res.ok) {
      throw new Error(data.error?.message || `Whisper HTTP ${res.status}`);
    }
    transcript = data.text || '';
    if (!transcript) throw new Error('Whisper вернул пустую расшифровку');
  }
  if (!transcript) {
    throw new Error('Нет текста для суммаризации через OpenAI');
  }
  report({ detail: 'Суммаризируем расшифровку через OpenAI…' });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SUMMARIZE_PROMPT },
        { role: 'user', content: `Расшифровка записи:\n\n${transcript}` },
      ],
    }),
    signal: AbortSignal.timeout(config.summarizeTimeoutMs),
  });
  const data = await readJsonResponse(res, 'OpenAI chat');
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || '');
  return {
    provider: 'openai',
    model: 'whisper-1 + gpt-4o-mini',
    summary: parsed,
  };
}

function createMockSummary(context = '') {
  return {
    title: 'Суммаризация аудиозаписи',
    tldr: 'В записи рассматриваются ключевые идеи проекта, архитектурные решения и дальнейшие шаги реализации.',
    language: 'ru',
    key_points: [
      'Анализ аудиопотока и выделение основных смысловых блоков',
      'Локальная и серверная обработка для обеспечения гибкости и скорости',
      'Интеграция с моделями суммаризации и распознавания речи',
      'Генерация структурированных таймкодов и списка действий (Action Items)',
    ],
    timeline: [
      {
        time: '00:00',
        seconds: 0,
        title: 'Введение и обзор темы',
        summary: 'Начало записи, постановка цели и формулировка задач.',
      },
      {
        time: '00:45',
        seconds: 45,
        title: 'Техническая реализация',
        summary: 'Обсуждение извлечения звука и вариантов транскрибации.',
      },
      {
        time: '01:30',
        seconds: 90,
        title: 'Итоги и следующие шаги',
        summary: 'Формирование плана действий и заключительные рекомендации.',
      },
    ],
    action_items: [
      'Проверить извлечение аудиодорожки из исходного видео',
      'Сохранить структурированную выжимку в Markdown или TXT',
      'Применить таймкоды для быстрой навигации по ключевым моментам',
    ],
    transcript: context || 'Пример транскрипции аудиозаписи...',
  };
}

module.exports = {
  summarizeWithGemini,
  createMockSummary,
};
