// Публичная страница по адресу, пришедшему извне (сайт из карточки места):
// только http(s) и только публичные адреса (netGuard), таймаут и потолок байт
// (http.js), браузерные заголовки, без исполнения JS. Ответ с кодом ошибки — тоже
// факт («сайт отвечает 404»), а не исключение: его записывает вызывающий.
// Остаточный риск: редирект проверяется только по исходному адресу.
//
// Контракт: page(url, { signal }) → { finalUrl, status, text } | { error, code, status? }
// code — код SourceHttpError (timeout, network, too_large, http_<n>) или blocked_address.

const { fetchText, SourceHttpError } = require('./http');
const { assertPublicHost } = require('./netGuard');
const { BROWSER_HEADERS } = require('./twogis');
const { abortError } = require('./patience');

class WebPage {
  constructor({ timeoutMs = 12000, maxBytes = 2 * 1024 * 1024, lookup } = {}) {
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.lookup = lookup;
    this.methods = ['page'];
  }

  async page(url, { signal } = {}) {
    try {
      await assertPublicHost(url, this.lookup ? { lookup: this.lookup } : {});
      const { text, finalUrl, status } = await fetchText(url, {
        signal,
        timeoutMs: this.timeoutMs,
        maxBytes: this.maxBytes,
        headers: BROWSER_HEADERS,
      });
      return { finalUrl, status, text };
    } catch (err) {
      if (signal && signal.aborted) throw abortError();
      if (err instanceof SourceHttpError && err.status) return { error: `HTTP ${err.status}`, code: err.code, status: err.status };
      return { error: String(err.message || err).slice(0, 120), code: err.code || null };
    }
  }
}

module.exports = { WebPage };
