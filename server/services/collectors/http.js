// Запрос к чужой ленте: таймаут, потолок размера, кодировка из заголовка или XML-пролога.
const USER_AGENT = 'Mozilla/5.0 (compatible; VeshaIdeaRadar/0.1; research prototype)';

class SourceHttpError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'SourceHttpError';
    this.code = code;
    this.status = status;
  }
}

function pickCharset(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromProlog = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  if (fromProlog) return fromProlog[1].toLowerCase();
  return 'utf-8';
}

function decode(buffer, charset) {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SourceHttpError('too_large', `Ответ больше ${maxBytes} байт`);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SourceHttpError('too_large', `Ответ больше ${maxBytes} байт`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Общий запрос чужого источника: таймаут, потолок байт, ошибки с кодами.
async function request(url, { signal, timeoutMs, maxBytes, accept } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept || '*/*' },
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || deadline.aborted) {
      throw new SourceHttpError('timeout', `Нет ответа за ${Math.round(timeoutMs / 1000)} с`);
    }
    if (err.name === 'AbortError') throw new SourceHttpError('aborted', 'Опрос отменён');
    throw new SourceHttpError('network', `Сеть: ${err.cause ? err.cause.code || err.cause.message : err.message}`);
  }
  if (!res.ok) {
    throw new SourceHttpError(`http_${res.status}`, `Источник ответил ${res.status}`, res.status);
  }
  const buffer = await readLimited(res, maxBytes);
  return { buffer, contentType: res.headers.get('content-type') || '' };
}

async function fetchText(url, options = {}) {
  const { buffer, contentType } = await request(url, options);
  const head = buffer.subarray(0, 200).toString('latin1');
  return { text: decode(buffer, pickCharset(contentType, head)), contentType };
}

// Бинарный ответ (например, PDF госакта) — без декодирования.
async function fetchBuffer(url, options = {}) {
  const { buffer, contentType } = await request(url, options);
  return { buffer, contentType };
}

async function fetchJson(url, options) {
  const { text } = await fetchText(url, { ...options, accept: 'application/json' });
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceHttpError('bad_json', 'Источник вернул не JSON');
  }
}

module.exports = {
  fetchText,
  fetchJson,
  fetchBuffer,
  SourceHttpError,
};
