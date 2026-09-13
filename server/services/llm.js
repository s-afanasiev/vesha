const config = require('../config');

const PROVIDERS = new Set(['gemini', 'yandex', 'openai']);
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
];

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function envKey(userKey, serverKey) {
  return String(userKey || '').trim() || String(serverKey || '').trim();
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function publicStatus() {
  return {
    gemini: {
      configured: Boolean(config.geminiApiKey),
      model: config.geminiModel,
    },
    yandex: {
      configured: Boolean(config.yandexApiKey && config.yandexFolderId),
      hasKey: Boolean(config.yandexApiKey),
      hasFolder: Boolean(config.yandexFolderId),
      model: config.yandexModel,
    },
    openai: {
      configured: Boolean(config.openaiApiKey),
      baseUrl: config.openaiBaseUrl,
      model: config.openaiModel,
    },
  };
}

function parseClientOptions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const provider = PROVIDERS.has(src.provider) ? src.provider : 'gemini';
  return {
    provider,
    apiKey: String(src.apiKey || '').trim(),
    baseUrl: String(src.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(src.model || '').trim(),
    temperature: clamp(src.temperature, 0, 2, 0.2),
    maxTokens: Math.round(clamp(src.maxTokens, 256, 128000, 8192)),
  };
}

function messageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

async function readJson(res, label) {
  const raw = await res.text();
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    if (!res.ok) throw bad(`${label}: пустой ответ HTTP ${res.status}`, 502);
    return {};
  }
  if (trimmed.startsWith('<') || /^<!doctype html/i.test(trimmed)) {
    throw bad(`${label}: HTML вместо JSON (HTTP ${res.status})`, 502);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw bad(`${label}: не JSON (HTTP ${res.status}): ${trimmed.slice(0, 160)}`, 502);
  }
}

let proxyDispatcher = null;
function geminiFetch(url, options = {}) {
  if (!config.geminiHttpsProxy) return fetch(url, options);
  if (!proxyDispatcher) {
    const { ProxyAgent } = require('undici');
    proxyDispatcher = new ProxyAgent(config.geminiHttpsProxy);
  }
  return fetch(url, { ...options, dispatcher: proxyDispatcher });
}

function geminiUrl(pathname) {
  const pathPart = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${config.geminiApiBase}${pathPart}`;
}

function isGeminiLocationError(text) {
  return /location is not supported|FAILED_PRECONDITION/i.test(String(text || ''));
}

async function completeGemini({ apiKey, model, temperature, maxTokens, messages, timeoutMs }) {
  const key = envKey(apiKey, config.geminiApiKey);
  if (!key) {
    throw bad('Нет ключа Gemini: задайте GEMINI_API_KEY в .env или вставьте свой в блоке LLM', 500);
  }
  const preferred = model || config.geminiModel;
  const models = [preferred, ...GEMINI_MODELS.filter((name) => name !== preferred)];
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  if (!contents.length) throw bad('Пустой запрос к Gemini');

  let lastErr;
  for (const name of models) {
    try {
      const url =
        geminiUrl(`/v1beta/models/${encodeURIComponent(name)}:generateContent`) +
        `?key=${encodeURIComponent(key)}`;
      const body = {
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const res = await geminiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await readJson(res, name);
      const blob = JSON.stringify(data);
      if (isGeminiLocationError(blob) || isGeminiLocationError(data.error?.message)) {
        throw bad(
          'Gemini недоступен с IP сервера (User location is not supported). Задайте GEMINI_HTTPS_PROXY или свой ключ/другую модель.',
          502
        );
      }
      if (!res.ok) {
        throw bad(data.error?.message || `Gemini HTTP ${res.status}`, 502);
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!String(text).trim()) throw bad('Gemini вернул пустой ответ', 502);
      return { provider: 'gemini', model: name, text: String(text).trim() };
    } catch (err) {
      lastErr = err;
      if (err.status && err.status < 500) throw err;
      if (/location is not supported|недоступен с IP/i.test(err.message || '')) throw err;
    }
  }
  throw lastErr || bad('Gemini не ответил', 502);
}

function yandexModelUri(model, folderId) {
  const value = String(model || config.yandexModel || 'yandexgpt-lite/latest').trim();
  if (/^(gpt|emb):\/\//i.test(value)) return value;
  if (!folderId) throw bad('Для YandexGPT задайте YANDEX_FOLDER_ID в .env', 500);
  const name = value.replace(/^\/+/, '');
  return `gpt://${folderId}/${name}`;
}

function yandexAuthHeader(key) {
  if (/^t1\./.test(key)) return `Bearer ${key}`;
  return `Api-Key ${key}`;
}

async function completeYandex({ apiKey, model, temperature, maxTokens, messages, timeoutMs }) {
  const key = envKey(apiKey, config.yandexApiKey);
  if (!key) {
    throw bad('Нет ключа YandexGPT: задайте YANDEX_API_KEY в .env или вставьте свой в блоке LLM', 500);
  }
  const folderId = config.yandexFolderId;
  if (!folderId) {
    throw bad('Для YandexGPT на сервере нужен YANDEX_FOLDER_ID (каталог облака)', 500);
  }
  const url = `${config.yandexBaseUrl}/foundationModels/v1/completion`;
  const yandexMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    text: m.content,
  }));
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: yandexAuthHeader(key),
        'Content-Type': 'application/json',
        'x-folder-id': folderId,
      },
      body: JSON.stringify({
        modelUri: yandexModelUri(model, folderId),
        completionOptions: {
          stream: false,
          temperature: Math.min(1, temperature),
          maxTokens: String(maxTokens),
        },
        messages: yandexMessages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к YandexGPT', 504);
    }
    throw bad(`YandexGPT: ${err.message}`, 502);
  }
  const data = await readJson(res, 'YandexGPT');
  if (!res.ok) {
    throw bad(data.message || data.error?.message || `YandexGPT HTTP ${res.status}`, 502);
  }
  const text = data.result?.alternatives?.[0]?.message?.text || '';
  if (!String(text).trim()) throw bad('YandexGPT вернул пустой ответ', 502);
  return {
    provider: 'yandex',
    model: yandexModelUri(model, folderId),
    text: String(text).trim(),
  };
}

function openaiChatUrl(baseUrl) {
  let base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw bad('Не задан URL OpenAI-совместимого API', 400);
  if (!/^https?:\/\//i.test(base)) {
    throw bad('URL должен начинаться с http:// или https://', 400);
  }
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

async function completeOpenai({
  apiKey,
  baseUrl,
  model,
  temperature,
  maxTokens,
  messages,
  timeoutMs,
}) {
  const key = envKey(apiKey, config.openaiApiKey);
  const url = openaiChatUrl(baseUrl || config.openaiBaseUrl);
  const modelName = model || config.openaiModel;
  if (!key && !/localhost|127\.0\.0\.1/i.test(url)) {
    throw bad(
      'Нет ключа OpenAI-совместимого API: задайте OPENAI_API_KEY в .env или вставьте свой в блоке LLM',
      500
    );
  }
  if (!modelName) throw bad('Не задано имя модели OpenAI-совместимого API', 400);

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к LLM', 504);
    }
    throw bad(`Не удалось обратиться к ${url}: ${err.message}`, 502);
  }
  const data = await readJson(res, 'OpenAI');
  if (!res.ok) {
    throw bad(data.error?.message || `LLM HTTP ${res.status}`, 502);
  }
  const text = messageContent(data.choices?.[0]?.message?.content);
  if (!text.trim()) throw bad('Модель вернула пустой ответ', 502);
  return {
    provider: 'openai',
    model: data.model || modelName,
    text: text.trim(),
  };
}

async function completeChat(options = {}) {
  const parsed = parseClientOptions(options);
  const messages = Array.isArray(options.messages) ? options.messages : [];
  if (!messages.length) throw bad('Пустой список сообщений для LLM');
  const timeoutMs = options.timeoutMs || config.notesExportLlmTimeoutMs || 180000;
  const payload = { ...parsed, messages, timeoutMs };
  if (parsed.provider === 'yandex') return completeYandex(payload);
  if (parsed.provider === 'openai') return completeOpenai(payload);
  return completeGemini(payload);
}

module.exports = {
  publicStatus,
  parseClientOptions,
  completeChat,
};
