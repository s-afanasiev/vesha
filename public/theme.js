/**
 * Vesha color themes: light gray ("light") and violet-sand ("sand").
 * html[data-theme] is set by the inline boot snippet in <head> to avoid a flash.
 */
(function (global) {
  const STORAGE_KEY = 'vesha.theme';
  const THEMES = [
    { id: 'light', label: 'Серый' },
    { id: 'sand', label: 'Песок' },
  ];

  function normalize(id) {
    return id === 'sand' ? 'sand' : 'light';
  }

  function currentTheme() {
    return normalize(document.documentElement.dataset.theme);
  }

  function setTheme(id) {
    const theme = normalize(id);
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_err) {
      /* ignore quota / private mode */
    }
    renderAll();
  }

  function renderSwitcher(el) {
    const active = currentTheme();
    el.classList.add('vesha-theme-switch');
    el.setAttribute('role', 'radiogroup');
    el.setAttribute('aria-label', 'Цветовая схема');
    el.innerHTML = THEMES.map((t) => {
      const on = t.id === active;
      return (
        '<button type="button" class="vesha-theme-switch__btn' +
        (on ? ' is-active' : '') +
        '" role="radio" aria-checked="' +
        on +
        '" data-theme-id="' +
        t.id +
        '">' +
        t.label +
        '</button>'
      );
    }).join('');
    el.querySelectorAll('[data-theme-id]').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(btn.dataset.themeId));
    });
  }

  function renderAll() {
    document.querySelectorAll('[data-vesha-theme-switcher]').forEach(renderSwitcher);
  }

  function init() {
    if (!document.documentElement.dataset.theme) {
      let stored = 'light';
      try {
        stored = localStorage.getItem(STORAGE_KEY) || 'light';
      } catch (_err) {
        stored = 'light';
      }
      document.documentElement.dataset.theme = normalize(stored);
    }
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.VeshaTheme = { set: setTheme, current: currentTheme };
})(window);
