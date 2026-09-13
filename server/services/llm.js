const dns = require('dns').promises;
const net = require('net');
const config = require('../config');

const PROVIDERS = new Set(['gemini', 'yandex', 'openai']);

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
  const candidate = Number.isFinite(n) ? n : Number(fallback);
  return Math.min(max, Math.max(min, Number.isFinite(candidate) ? candidate : min));
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
}

function serverOpenaiConfigured() {
  return Boolean(config.openaiApiKey || config.openaiAllowKeyless);
}

function publicStatus() {
  const defaultProvider = PROVIDERS.has(config.llmDefaultProvider)
    ? config.llmDefaultProvider
    : 'gemini';
  const customEndpointsEnabled =
    config.llmEnableCustomEndpoints &&
    (!config.isProduction || config.llmAllowedOpenaiHosts.length > 0);
  return {
    defaultProvider,
    gemini: {
      configured: Boolean(config.geminiApiKey),
      model: config.geminiModel,
    },
    yandex: {
      configured: Boolean(
        (config.yandexApiKey || config.yandexIamToken) && config.yandexFolderId
      ),
      hasCredential: Boolean(config.yandexApiKey || config.yandexIamToken),
      hasFolder: Boolean(config.yandexFolderId),
      model: config.yandexModel,
    },
    openai: {
      configured: serverOpenaiConfigured(),
      baseUrl: config.openaiBaseUrl,
      model: config.openaiModel,
      customEndpointsEnabled,
      privateEndpointsEnabled: customEndpointsEnabled && config.llmAllowPrivateEndpoints,
    },
  };
}

function parseClientOptions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const provider = String(src.provider || config.llmDefaultProvider || 'gemini').toLowerCase();
  if (!PROVIDERS.has(provider)) throw bad(`Неизвестный LLM-провайдер: ${provider}`);

  if (provider === 'gemini') {
    return {
      provider,
      apiKey: String(src.apiKey || '').trim(),
    };
  }
  if (provider === 'yandex') {
    return {
      provider,
      apiKey: String(src.apiKey || '').trim(),
      folderId: String(src.folderId || '').trim(),
    };
  }
  return {
    provider,
    apiKey: String(src.apiKey || '').trim(),
    baseUrl: String(src.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(src.model || '').trim(),
    temperature: clamp(src.temperature, 0, 2, 0.2),
    maxTokens: Math.round(clamp(src.maxTokens, 256, config.llmMaxTokens, 8192)),
  };
}

function normalizeMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('Пустой список сообщений для LLM');
  let totalChars = 0;
  const messages = raw.map((message) => {
    const role = String(message && message.role ? message.role : '').toLowerCase();
    if (!['system', 'user', 'assistant'].includes(role)) {
      throw bad(`Недопустимая роль сообщения: ${role || '(пусто)'}`);
    }
    const content = String(message && message.content != null ? message.content : '');
    totalChars += content.length;
    return { role, content };
  });
  if (!messages.some((message) => message.role === 'user' && message.content.trim())) {
    throw bad('В запросе к LLM нет пользовательского сообщения');
  }
  if (totalChars > config.llmMaxInputChars) {
    throw bad(
      `Запрос к LLM слишком большой (${totalChars} символов, лимит ${config.llmMaxInputChars})`,
      413
    );
  }
  return messages;
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
  let raw = '';
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > config.llmMaxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw bad(`${label}: ответ превышает лимит ${config.llmMaxResponseBytes} байт`, 502);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } else {
    raw = await res.text();
  }
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

function upstreamError(provider, res, data) {
  const message =
    data?.error?.message ||
    data?.message ||
    data?.error?.details?.[0]?.message ||
    `${provider} HTTP ${res.status}`;
  const err = bad(message, res.status === 429 ? 429 : res.status === 401 || res.status === 403 ? 401 : 502);
  err.code =
    res.status === 429
      ? 'rate_limit'
      : res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 404
          ? 'model_not_found'
          : 'upstream';
  return err;
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
  const modelName = model || config.geminiModel;
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

  const url = geminiUrl(`/v1beta/models/${encodeURIComponent(modelName)}:generateContent`);
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  let res;
  try {
    res = await geminiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к Gemini', 504);
    }
    throw bad(`Gemini: ${err.message}`, 502);
  }
  if (res.status >= 300 && res.status < 400) {
    throw bad('Редиректы Gemini API запрещены', 502);
  }
  const data = await readJson(res, modelName);
  const blob = JSON.stringify(data);
  if (isGeminiLocationError(blob) || isGeminiLocationError(data.error?.message)) {
    throw bad(
      'Gemini недоступен с IP сервера (User location is not supported). Другой API-ключ не изменит IP сервера: задайте GEMINI_HTTPS_PROXY или выберите другого провайдера.',
      502
    );
  }
  if (!res.ok) throw upstreamError('Gemini', res, data);
  const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
  if (!String(text).trim()) throw bad('Gemini вернул пустой ответ', 502);
  return {
    provider: 'gemini',
    model: modelName,
    text: String(text).trim(),
    finishReason: data.candidates?.[0]?.finishReason || null,
    usage: data.usageMetadata || null,
  };
}

function yandexModelUri(model, folderId) {
  const value = String(model || config.yandexModel || 'yandexgpt-lite/latest').trim();
  if (/^(gpt|emb):\/\//i.test(value)) return value;
  if (!folderId) throw bad('Для YandexGPT задайте YANDEX_FOLDER_ID в .env', 500);
  const name = value.replace(/^\/+/, '');
  return `gpt://${folderId}/${name}`;
}

async function completeYandex({
  apiKey,
  folderId: userFolderId,
  model,
  temperature,
  maxTokens,
  messages,
  timeoutMs,
}) {
  const userKey = String(apiKey || '').trim();
  const serverApiKey = String(config.yandexApiKey || '').trim();
  const serverIamToken = String(config.yandexIamToken || '').trim();
  const credential = userKey || serverApiKey || serverIamToken;
  if (!credential) {
    throw bad('Нет ключа YandexGPT: задайте YANDEX_API_KEY в .env или вставьте свой в блоке LLM', 500);
  }
  const folderId = userKey
    ? String(userFolderId || config.yandexFolderId || '').trim()
    : String(config.yandexFolderId || '').trim();
  if (!folderId) {
    throw bad(
      userKey
        ? 'Для своего ключа YandexGPT укажите Folder ID'
        : 'Для YandexGPT на сервере нужен YANDEX_FOLDER_ID',
      400
    );
  }
  const url = `${config.yandexBaseUrl}/foundationModels/v1/completion`;
  const yandexMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    text: m.content,
  }));
  let res;
  try {
    const authorization = userKey || serverApiKey
      ? `Api-Key ${userKey || serverApiKey}`
      : `Bearer ${serverIamToken}`;
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        ...(serverIamToken && !userKey && !serverApiKey ? { 'x-folder-id': folderId } : {}),
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
      redirect: 'manual',
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к YandexGPT', 504);
    }
    throw bad(`YandexGPT: ${err.message}`, 502);
  }
  if (res.status >= 300 && res.status < 400) {
    throw bad('Редиректы YandexGPT API запрещены', 502);
  }
  const data = await readJson(res, 'YandexGPT');
  if (!res.ok) throw upstreamError('YandexGPT', res, data);
  const text = data.result?.alternatives?.[0]?.message?.text || '';
  if (!String(text).trim()) throw bad('YandexGPT вернул пустой ответ', 502);
  return {
    provider: 'yandex',
    model: yandexModelUri(model, folderId),
    text: String(text).trim(),
    finishReason: data.result?.alternatives?.[0]?.status || null,
    usage: data.result?.usage || null,
  };
}

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isBlockedIp(address) {
  const value = String(address || '').toLowerCase();
  const version = net.isIP(value);
  if (version === 4) return isBlockedIpv4(value);
  if (version !== 6) return true;
  if (value.startsWith('::ffff:')) return isBlockedIpv4(value.slice(7));
  const firstGroup = Number.parseInt(value.split(':')[0], 16);
  return !Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff;
}

function openaiChatUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw bad('Не задан URL OpenAI-совместимого API');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw bad('Некорректный URL OpenAI-совместимого API');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw bad('URL должен начинаться с http:// или https://');
  }
  if (url.username || url.password) {
    throw bad('Логин и пароль нельзя передавать внутри URL');
  }
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  }
  return url;
}

async function assertCustomEndpointAllowed(url) {
  if (!config.llmEnableCustomEndpoints) {
    throw bad(
      'Пользовательские LLM URL отключены на сервере. Используйте server preset или настройте LLM_ENABLE_CUSTOM_ENDPOINTS.',
      403
    );
  }
  if (config.isProduction && !config.llmAllowedOpenaiHosts.length) {
    throw bad(
      'В production пользовательские LLM URL требуют LLM_ALLOWED_OPENAI_HOSTS.',
      403
    );
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    config.llmAllowedOpenaiHosts.length &&
    !config.llmAllowedOpenaiHosts.includes(hostname)
  ) {
    throw bad(`LLM-хост ${hostname} не входит в разрешённый список`, 403);
  }
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch (err) {
      throw bad(`Не удалось определить адрес LLM-хоста ${hostname}: ${err.message}`, 400);
    }
  }
  if (!addresses.length) throw bad('LLM-хост не вернул IP-адресов', 400);
  const containsPrivateAddress = addresses.some(({ address }) => isBlockedIp(address));
  if (containsPrivateAddress && !config.llmAllowPrivateEndpoints) {
    throw bad('LLM URL указывает на локальную или внутреннюю сеть сервера', 403);
  }
  if (!containsPrivateAddress && url.protocol !== 'https:') {
    throw bad('Публичный пользовательский LLM URL должен использовать HTTPS', 403);
  }
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
  const userKey = String(apiKey || '').trim();
  const usesUserProfile = Boolean(userKey);
  const key = usesUserProfile ? userKey : String(config.openaiApiKey || '').trim();
  const serverUrl = openaiChatUrl(config.openaiBaseUrl);
  const url = openaiChatUrl(
    usesUserProfile ? baseUrl || config.openaiBaseUrl : config.openaiBaseUrl
  );
  const modelName = usesUserProfile ? model || config.openaiModel : config.openaiModel;
  if (usesUserProfile && url.href !== serverUrl.href) await assertCustomEndpointAllowed(url);
  if (!key && !config.openaiAllowKeyless) {
    throw bad('На сервере не настроен OpenAI-совместимый профиль', 500);
  }
  if (
    !usesUserProfile &&
    key &&
    url.protocol !== 'https:' &&
    !isLoopbackHostname(url.hostname) &&
    !config.llmAllowPrivateEndpoints
  ) {
    throw bad('Server preset с API-ключом должен использовать HTTPS', 500);
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
      redirect: 'manual',
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к LLM', 504);
    }
    throw bad(`Не удалось обратиться к LLM-хосту ${url.hostname}: ${err.message}`, 502);
  }
  if (res.status >= 300 && res.status < 400) {
    throw bad('Редиректы от пользовательского LLM endpoint запрещены', 502);
  }
  const data = await readJson(res, 'OpenAI');
  if (!res.ok) throw upstreamError('OpenAI', res, data);
  const text = messageContent(data.choices?.[0]?.message?.content);
  if (!text.trim()) throw bad('Модель вернула пустой ответ', 502);
  return {
    provider: 'openai',
    model: data.model || modelName,
    text: text.trim(),
    finishReason: data.choices?.[0]?.finish_reason || null,
    usage: data.usage || null,
  };
}

async function completeChat(options = {}) {
  const parsed = parseClientOptions(options.selection || options);
  const messages = normalizeMessages(options.messages);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || config.llmTimeoutMs);
  const temperature = clamp(
    options.temperature,
    0,
    2,
    parsed.temperature == null ? 0.2 : parsed.temperature
  );
  const tokenLimit = parsed.apiKey ? config.llmMaxTokens : config.llmServerMaxTokens;
  const maxTokens = Math.round(
    clamp(
      options.maxTokens,
      256,
      tokenLimit,
      parsed.maxTokens == null ? 8192 : parsed.maxTokens
    )
  );
  const payload = {
    ...parsed,
    messages,
    timeoutMs,
    temperature,
    maxTokens,
    model:
      parsed.provider === 'gemini'
        ? config.geminiModel
        : parsed.provider === 'yandex'
          ? config.yandexModel
          : parsed.model,
  };
  if (parsed.provider === 'yandex') return completeYandex(payload);
  if (parsed.provider === 'openai') return completeOpenai(payload);
  return completeGemini(payload);
}

module.exports = {
  publicStatus,
  parseClientOptions,
  completeChat,
  __test: {
    isBlockedIp,
    openaiChatUrl,
    assertCustomEndpointAllowed,
  },
};
