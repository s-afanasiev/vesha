// Общие UI-утилиты Vesha (docs/ui-components.md §3) — то, что копировалось
// между песочницами: escapeHtml, разбиение тысяч, JSON-фетчи с ошибкой из
// тела ответа, debounce, toast@1, обвязка modal@1. Vanilla, без зависимостей.
(() => {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  async function getJson(url) {
    const res = await fetch(url);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // toast@1 — честные состояния: текст, род ok|err, опциональное действие.
  // Контейнер #vui-toasts создаётся по месту; авто-скрытие одиночным setTimeout.
  function toast(text, opts = {}) {
    let box = document.getElementById('vui-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'vui-toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'vui-toast' + (opts.kind ? ' vui-toast--' + opts.kind : '');
    el.setAttribute('role', opts.kind === 'err' ? 'alert' : 'status');
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (opts.action && opts.action.label) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', () => { opts.action.fn(); el.remove(); });
      el.appendChild(btn);
    }
    box.appendChild(el);
    setTimeout(() => el.remove(), opts.timeout || 4200);
    return el;
  }

  // modal@1, обвязка: нативный <dialog> закрывается по клику на подложку
  // (Esc и фокус-ловушка — из коробки). Стили диалога остаются у страницы.
  function dialogWiring(dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  window.VeshaUI = { escapeHtml, fmtInt, getJson, postJson, debounce, toast, dialogWiring };
})();
