(function () {
  'use strict';

  const API = '/api/chat-engine';
  const POLL_MS = 2500;

  const messagesEl = document.getElementById('cw-messages');
  const formEl = document.getElementById('cw-form');
  const inputEl = document.getElementById('cw-input');
  const nameEl = document.getElementById('cw-name');

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function externalId() {
    return (crypto.randomUUID && crypto.randomUUID()) || `w-${Date.now()}-${Math.random()}`;
  }

  async function api(path, options) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data.result;
  }

  function render(messages) {
    if (!messages.length) {
      messagesEl.innerHTML =
        '<div style="text-align:center;color:#8a97a8;font-size:12px;margin-top:30px">Напишите нам — ответим здесь же</div>';
      return;
    }
    messagesEl.innerHTML = messages
      .map((m) => {
        const mine = m.role === 'visitor';
        return `<div class="cw-bubble ${mine ? 'cw-bubble--me' : 'cw-bubble--them'}">${esc(m.text)}<time>${esc(fmtTime(m.created_at))}</time></div>`;
      })
      .join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function refresh() {
    try {
      const result = await api('/widget/messages');
      render(result.messages);
    } catch (err) {
      // тихий такт
    }
  }

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    const sendBtn = formEl.querySelector('button');
    sendBtn.disabled = true;
    try {
      await api('/widget/messages', {
        method: 'POST',
        body: { text, name: nameEl.value.trim(), externalId: externalId() },
      });
      inputEl.value = '';
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  refresh();
  setInterval(refresh, POLL_MS);
})();
