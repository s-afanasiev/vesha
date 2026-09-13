/**
 * Vesha LLM picker — reusable provider block for experiments.
 * Markup: <div data-vesha-llm-picker></div>
 * Scripts: /llm-picker.css + /llm-picker.js
 * API: window.VeshaLlm.getPayload(), isReady(), onChange(), refreshStatus(), ready()
 * API keys live only in page memory: they are not persisted and never enter change events.
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
    defaultProvider: 'gemini',
    gemini: { configured: false, model: 'gemini-2.5-flash' },
    yandex: {
      configured: false,
      hasCredential: false,
      hasFolder: false,
      model: 'yandexgpt-lite/latest',
    },
    openai: {
      configured: false,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      customEndpointsEnabled: false,
      privateEndpointsEnabled: false,
    },
  };
  let hadStoredState = false;
  let state = loadState();
  const secrets = { gemini: '', yandex: '', openai: '' };
  const listeners = [];
  let pickerCounter = 0;
  let statusLoaded = false;
  let statusPromise = null;
  let initPromise = null;

  function loadState() {
    const defaults = {
      provider: 'gemini',
      yandex: { folderId: '' },
      openai: {
        baseUrl: '',
        model: '',
        temperature: 0.2,
        maxTokens: 8192,
      },
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      hadStoredState = true;
      const parsed = JSON.parse(raw);
      const provider = PROVIDERS.some((item) => item.id === parsed.provider)
        ? parsed.provider
        : defaults.provider;
      return {
        provider,
        yandex: {
          folderId: String(parsed.yandex?.folderId || ''),
        },
        openai: {
          baseUrl: String(parsed.openai?.baseUrl || parsed.baseUrl || ''),
          model: String(parsed.openai?.model || parsed.model || ''),
          temperature: Number(parsed.openai?.temperature ?? parsed.temperature ?? 0.2),
          maxTokens: Number(parsed.openai?.maxTokens ?? parsed.maxTokens ?? 8192),
        },
      };
    } catch {
      return defaults;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          provider: state.provider,
          yandex: { folderId: state.yandex.folderId },
          openai: { ...state.openai },
        })
      );
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
    const detail = {
      provider: state.provider,
      ready: isReady(),
      statusLabel: statusLabel(),
    };
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
    const provider = state.provider;
    if (provider === 'gemini') {
      return { provider, apiKey: secrets.gemini.trim() };
    }
    if (provider === 'yandex') {
      return {
        provider,
        apiKey: secrets.yandex.trim(),
        folderId: String(state.yandex.folderId || '').trim(),
      };
    }
    return {
      provider,
      apiKey: secrets.openai.trim(),
      baseUrl: String(state.openai.baseUrl || status.openai.baseUrl || '').trim(),
      model: String(state.openai.model || status.openai.model || '').trim(),
      temperature: Number.isFinite(Number(state.openai.temperature))
        ? Number(state.openai.temperature)
        : 0.2,
      maxTokens: Number(state.openai.maxTokens) || 8192,
    };
  }

  function providerReady(id) {
    const hasUserKey = Boolean(secrets[id]);
    if (id === 'gemini') return Boolean(status.gemini.configured || hasUserKey);
    if (id === 'yandex') {
      if (!hasUserKey) return Boolean(status.yandex.configured);
      return Boolean(state.yandex.folderId || status.yandex.hasFolder);
    }
    if (!hasUserKey) return Boolean(status.openai.configured);
    const payload = getPayload();
    let customEndpoint = false;
    try {
      const requested = new URL(payload.baseUrl);
      const preset = new URL(status.openai.baseUrl);
      const requestPath = requested.pathname.replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
      const presetPath = preset.pathname.replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
      customEndpoint =
        requested.origin !== preset.origin ||
        requestPath !== presetPath;
    } catch {
      return false;
    }
    if (customEndpoint && !status.openai.customEndpointsEnabled) return false;
    return Boolean(payload.baseUrl && payload.model);
  }

  function isReady() {
    return providerReady(state.provider);
  }

  function statusLabel() {
    const id = state.provider;
    if (id === 'gemini') {
      if (secrets.gemini) return 'Gemini: свой ключ (до закрытия страницы)';
      if (status.gemini.configured) return 'Gemini: ключ сервера';
      return 'Gemini: нужен API ключ';
    }
    if (id === 'yandex') {
      if (secrets.yandex && !state.yandex.folderId && !status.yandex.hasFolder) {
        return 'YandexGPT: нужен Folder ID';
      }
      if (secrets.yandex) return 'YandexGPT: свой ключ (до закрытия страницы)';
      if (status.yandex.configured) return 'YandexGPT: профиль сервера';
      if (!status.yandex.hasFolder) return 'YandexGPT: нужны ключ и Folder ID';
      return 'YandexGPT: нужен API ключ';
    }
    if (secrets.openai) {
      if (!providerReady('openai')) return 'OpenAI-compat: проверьте URL и модель';
      return 'OpenAI-compat: свой профиль · ' + (state.openai.model || status.openai.model);
    }
    if (status.openai.configured) return 'OpenAI-compat: server preset · ' + status.openai.model;
    return 'OpenAI-compat: нужен API ключ';
  }

  function hintFor(id) {
    if (id === 'gemini') {
      return (
        'Endpoint и модель заданы на сервере (' +
        (status.gemini.model || 'gemini-2.5-flash') +
        '). Свой ключ хранится только до закрытия страницы.'
      );
    }
    if (id === 'yandex') {
      return (
        'Модель задана на сервере. Для ключа из другого Yandex Cloud укажите его Folder ID. ' +
        'Секрет не сохраняется в браузере.'
      );
    }
    const customHint = status.openai.customEndpointsEnabled
      ? 'Публичный HTTPS endpoint можно задать со своим ключом.'
      : 'Пользовательские URL на этом сервере отключены.';
    return (
      'Без своего ключа используется неизменяемый server preset. ' +
      customHint +
      (status.openai.privateEndpointsEnabled
        ? ' Локальные адреса явно разрешены конфигурацией сервера.'
        : '')
    );
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bind(root) {
    root.querySelectorAll('input[type="radio"][data-llm-provider]').forEach((el) => {
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
        if (field === 'apiKey') {
          secrets[state.provider] = el.value;
        } else if (field === 'folderId') {
          state.yandex.folderId = el.value;
        } else if (field === 'temperature' || field === 'maxTokens') {
          state.openai[field] = Number(el.value);
        } else {
          state.openai[field] = el.value;
        }
        const tempOut = root.querySelector('[data-llm-temp-out]');
        if (field === 'temperature' && tempOut) {
          tempOut.textContent = Number(state.openai.temperature).toFixed(1);
        }
        emit();
      });
    });
  }

  function render(root) {
    root.classList.add('llm-picker');
    if (!root.dataset.llmPickerId) {
      pickerCounter += 1;
      root.dataset.llmPickerId = String(pickerCounter);
    }
    const radioName = `vesha-llm-provider-${root.dataset.llmPickerId}`;
    const ready = isReady();
    const openaiUrl = state.openai.baseUrl || status.openai.baseUrl || '';
    const openaiModel = state.openai.model || status.openai.model || '';
    const serverCredential = Boolean(status[state.provider] && status[state.provider].configured);
    root.innerHTML = `
      <div class="llm-picker__head">
        <h2>Нейросеть</h2>
        <span class="llm-picker__status ${ready ? 'is-ok' : 'is-bad'}">${escapeHtml(statusLabel())}</span>
      </div>
      <div class="llm-picker__providers" role="radiogroup" aria-label="Провайдер LLM">
        ${PROVIDERS.map(
          (p) => `
            <label class="llm-picker__opt">
              <input type="radio" data-llm-provider name="${radioName}" value="${p.id}" ${
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
        ${
          state.provider === 'yandex'
            ? `
              <label class="llm-picker__field">
                <span>Folder ID для своего ключа</span>
                <input type="text" data-llm-field="folderId" spellcheck="false" autocomplete="off" value="${escapeHtml(
                  state.yandex.folderId
                )}" placeholder="${status.yandex.hasFolder ? 'пусто — каталог с сервера' : 'b1g…'}" />
              </label>
            `
            : ''
        }
        <label class="llm-picker__field">
          <span>API ключ ${serverCredential ? '(пусто — server preset)' : ''}</span>
          <input type="password" data-llm-field="apiKey" autocomplete="new-password" value="${escapeHtml(
            secrets[state.provider]
          )}" placeholder="не сохраняется в браузере" />
        </label>
        ${
          state.provider === 'openai'
            ? `
              <div class="llm-picker__row">
                <label class="llm-picker__field">
                  <span class="llm-picker__temp">Температура <output data-llm-temp-out>${Number(
                    state.openai.temperature
                  ).toFixed(1)}</output></span>
                  <input type="range" data-llm-field="temperature" min="0" max="2" step="0.1" value="${escapeHtml(
                    state.openai.temperature
                  )}" />
                </label>
                <label class="llm-picker__field">
                  <span>Max tokens</span>
                  <input type="number" data-llm-field="maxTokens" min="256" max="32768" step="256" value="${escapeHtml(
                    state.openai.maxTokens
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

  async function refreshStatus(force) {
    if (statusLoaded && !force) return status;
    if (statusPromise) return statusPromise;
    statusPromise = (async () => {
      try {
        const res = await fetch('/api/llm/status', { credentials: 'same-origin' });
        const data = await res.json();
        if (res.ok && data) {
          status = {
            defaultProvider: data.defaultProvider || status.defaultProvider,
            gemini: { ...status.gemini, ...(data.gemini || {}) },
            yandex: { ...status.yandex, ...(data.yandex || {}) },
            openai: { ...status.openai, ...(data.openai || {}) },
          };
          if (!hadStoredState && PROVIDERS.some((item) => item.id === status.defaultProvider)) {
            state.provider = status.defaultProvider;
          }
          if (!state.openai.baseUrl && status.openai.baseUrl) {
            state.openai.baseUrl = status.openai.baseUrl;
          }
          if (!state.openai.model && status.openai.model) {
            state.openai.model = status.openai.model;
          }
          statusLoaded = true;
        }
      } catch (_) {
        /* keep defaults */
      } finally {
        statusPromise = null;
      }
      emit({ rerender: true });
      return status;
    })();
    return statusPromise;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  async function init() {
    saveState();
    renderAll();
    await refreshStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPromise = init();
    });
  } else {
    initPromise = init();
  }

  global.VeshaLlm = {
    getPayload,
    isReady,
    statusLabel,
    refreshStatus,
    ready: () => initPromise || statusPromise || Promise.resolve(status),
    onChange,
    renderAll,
  };
})(typeof window !== 'undefined' ? window : this);
