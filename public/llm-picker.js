/**
 * Vesha LLM picker — reusable provider block for experiments.
 * Markup: <div data-vesha-llm-picker></div>
 * Scripts: /llm-picker.css + /llm-picker.js
 * API: window.VeshaLlm.getPayload(), isReady(), onChange(), refreshStatus()
 */
(function (global) {
  const STORAGE_KEY = 'vesha.llm-picker';
  const PROVIDERS = [
    {
      id: 'gemini',
      title: 'Gemini',
      caption: 'Ключ опционален',
    },
    {
      id: 'yandex',
      title: 'YandexGPT',
      caption: 'Ключ опционален',
    },
    {
      id: 'openai',
      title: 'OpenAI-совместимый',
      caption: 'URL, модель, ключ',
    },
  ];

  let status = {
    gemini: { configured: false, model: 'gemini-2.5-flash' },
    yandex: { configured: false, hasKey: false, hasFolder: false, model: 'yandexgpt-lite/latest' },
    openai: { configured: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  };
  let state = loadState();
  const listeners = [];

  function loadState() {
    const defaults = {
      provider: 'gemini',
      apiKey: '',
      baseUrl: '',
      model: '',
      temperature: 0.2,
      maxTokens: 8192,
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* ignore quota */
    }
  }

  function patchStatus() {
    document.querySelectorAll('[data-vesha-llm-picker]').forEach((root) => {
      const el = root.querySelector('.llm-picker__status');
      if (!el) return;
      const ready = isReady();
      el.textContent = statusLabel();
      el.classList.toggle('is-ok', ready);
      el.classList.toggle('is-bad', !ready);
    });
  }

  function emit(options) {
    saveState();
    const detail = { payload: getPayload(), ready: isReady(), statusLabel: statusLabel() };
    listeners.forEach((fn) => {
      try {
        fn(detail);
      } catch (_) {
        /* listener errors must not break the picker */
      }
    });
    document.dispatchEvent(new CustomEvent('llm:change', { detail }));
    if (options && options.rerender) renderAll();
    else patchStatus();
  }

  function getPayload() {
    return {
      provider: state.provider,
      apiKey: String(state.apiKey || '').trim(),
      baseUrl: String(state.baseUrl || '').trim(),
      model: String(state.model || '').trim(),
      temperature: Number(state.temperature) || 0,
      maxTokens: Number(state.maxTokens) || 8192,
    };
  }

  function providerReady(id) {
    const payload = getPayload();
    const hasUserKey = Boolean(payload.apiKey);
    if (id === 'gemini') return Boolean(status.gemini.configured || hasUserKey);
    if (id === 'yandex') {
      return Boolean(status.yandex.hasFolder && (status.yandex.hasKey || hasUserKey));
    }
    const url = payload.baseUrl || status.openai.baseUrl;
    const model = payload.model || status.openai.model;
    const key = hasUserKey || status.openai.configured;
    const local = /localhost|127\.0\.0\.1/i.test(url);
    return Boolean(url && model && (key || local));
  }

  function isReady() {
    return providerReady(state.provider);
  }

  function statusLabel() {
    const id = state.provider;
    if (id === 'gemini') {
      if (state.apiKey) return 'Gemini: свой ключ';
      if (status.gemini.configured) return 'Gemini: ключ сервера';
      return 'Gemini: нужен API ключ';
    }
    if (id === 'yandex') {
      if (!status.yandex.hasFolder) return 'YandexGPT: задайте YANDEX_FOLDER_ID в .env';
      if (state.apiKey) return 'YandexGPT: свой ключ';
      if (status.yandex.hasKey) return 'YandexGPT: ключ сервера';
      return 'YandexGPT: нужен API ключ';
    }
    if (providerReady('openai')) {
      const model = state.model || status.openai.model;
      return 'OpenAI-compat: ' + model;
    }
    return 'OpenAI-compat: укажите URL, модель и ключ';
  }

  function hintFor(id) {
    if (id === 'gemini') {
      return (
        'Endpoint и модель заданы на сервере (' +
        (status.gemini.model || 'gemini-2.5-flash') +
        '). Свой ключ — если серверный исчерпан или недоступен.'
      );
    }
    if (id === 'yandex') {
      return (
        'Модель и каталог облака заданы на сервере. Свой API-ключ — если серверный закончился. ' +
        (status.yandex.hasFolder ? '' : 'На сервере пока нет YANDEX_FOLDER_ID.')
      );
    }
    return 'Подойдёт OpenAI, OpenRouter, Groq, Ollama /v1, vLLM и любой совместимый chat/completions.';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bind(root) {
    root.querySelectorAll('input[name="vesha-llm-provider"]').forEach((el) => {
      el.addEventListener('change', () => {
        if (el.checked) {
          state.provider = el.value;
          emit({ rerender: true });
        }
      });
    });
    root.querySelectorAll('[data-llm-field]').forEach((el) => {
      const field = el.getAttribute('data-llm-field');
      el.addEventListener('input', () => {
        if (field === 'temperature' || field === 'maxTokens') {
          state[field] = Number(el.value);
        } else {
          state[field] = el.value;
        }
        const tempOut = root.querySelector('[data-llm-temp-out]');
        if (field === 'temperature' && tempOut) {
          tempOut.textContent = Number(state.temperature).toFixed(1);
        }
        emit();
      });
    });
  }

  function render(root) {
    const ready = isReady();
    const openaiUrl = state.baseUrl || status.openai.baseUrl || '';
    const openaiModel = state.model || status.openai.model || '';
    root.innerHTML = `
      <div class="llm-picker__head">
        <h2>Нейросеть</h2>
        <span class="llm-picker__status ${ready ? 'is-ok' : 'is-bad'}">${escapeHtml(statusLabel())}</span>
      </div>
      <div class="llm-picker__providers" role="radiogroup" aria-label="Провайдер LLM">
        ${PROVIDERS.map(
          (p) => `
            <label class="llm-picker__opt">
              <input type="radio" name="vesha-llm-provider" value="${p.id}" ${
                state.provider === p.id ? 'checked' : ''
              } />
              <span class="llm-picker__card">
                <strong>${escapeHtml(p.title)}</strong>
                <small>${escapeHtml(p.caption)}</small>
              </span>
            </label>
          `
        ).join('')}
      </div>
      <p class="llm-picker__hint">${escapeHtml(hintFor(state.provider))}</p>
      <div class="llm-picker__fields">
        ${
          state.provider === 'openai'
            ? `
              <label class="llm-picker__field">
                <span>Base URL</span>
                <input type="text" data-llm-field="baseUrl" spellcheck="false" autocomplete="off" value="${escapeHtml(
                  openaiUrl
                )}" placeholder="https://api.openai.com/v1" />
              </label>
              <label class="llm-picker__field">
                <span>Модель</span>
                <input type="text" data-llm-field="model" spellcheck="false" autocomplete="off" value="${escapeHtml(
                  openaiModel
                )}" placeholder="gpt-4o-mini" />
              </label>
            `
            : ''
        }
        <label class="llm-picker__field">
          <span>API ключ ${status[state.provider] && (status[state.provider].configured || status[state.provider].hasKey) ? '(если пусто — ключ с сервера)' : ''}</span>
          <input type="password" data-llm-field="apiKey" autocomplete="off" value="${escapeHtml(
            state.apiKey
          )}" placeholder="необязательно, если ключ задан в .env" />
        </label>
        ${
          state.provider === 'openai'
            ? `
              <div class="llm-picker__row">
                <label class="llm-picker__field">
                  <span class="llm-picker__temp">Температура <output data-llm-temp-out>${Number(
                    state.temperature
                  ).toFixed(1)}</output></span>
                  <input type="range" data-llm-field="temperature" min="0" max="2" step="0.1" value="${escapeHtml(
                    state.temperature
                  )}" />
                </label>
                <label class="llm-picker__field">
                  <span>Max tokens</span>
                  <input type="number" data-llm-field="maxTokens" min="256" max="128000" step="256" value="${escapeHtml(
                    state.maxTokens
                  )}" />
                </label>
              </div>
            `
            : ''
        }
      </div>
    `;
    bind(root);
  }

  function renderAll() {
    document.querySelectorAll('[data-vesha-llm-picker]').forEach((el) => render(el));
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/llm/status');
      const data = await res.json();
      if (res.ok && data) {
        status = {
          gemini: { ...status.gemini, ...(data.gemini || {}) },
          yandex: { ...status.yandex, ...(data.yandex || {}) },
          openai: { ...status.openai, ...(data.openai || {}) },
        };
        if (!state.baseUrl && status.openai.baseUrl) state.baseUrl = status.openai.baseUrl;
        if (!state.model && status.openai.model) state.model = status.openai.model;
      }
    } catch (_) {
      /* keep defaults */
    }
    emit({ rerender: true });
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  async function init() {
    renderAll();
    await refreshStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.VeshaLlm = {
    getPayload,
    isReady,
    statusLabel,
    refreshStatus,
    onChange,
    renderAll,
  };
})(typeof window !== 'undefined' ? window : this);
