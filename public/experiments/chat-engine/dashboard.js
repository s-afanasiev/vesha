(function () {
  'use strict';

  const API = '/api/chat-engine';
  const POLL_MS = 3000;

  const boardEl = document.getElementById('ce-board');
  const chatEl = document.getElementById('ce-chat');
  const messagesEl = document.getElementById('ce-chat-messages');
  const nameEl = document.getElementById('ce-chat-name');
  const notesEl = document.getElementById('ce-chat-notes');
  const stageEl = document.getElementById('ce-chat-stage');
  const inputEl = document.getElementById('ce-input');
  const noteEl = document.getElementById('ce-chat-note');
  const suggestBtn = document.getElementById('ce-suggest');
  const sendBtn = document.getElementById('ce-send');
  const closeBtn = document.getElementById('ce-chat-close');
  const personaBtn = document.getElementById('ce-persona-btn');
  const personaModal = document.getElementById('ce-persona-modal');
  const personaText = document.getElementById('ce-persona-text');
  const personaSave = document.getElementById('ce-persona-save');
  const personaCancel = document.getElementById('ce-persona-cancel');

  let stages = [];
  let dialogues = [];
  let selectedId = null;
  let selectedDialogue = null;
  let messages = [];
  // авто-черновик: одно предложение на каждое входящее, без повторов при сбое
  let autoSuggestedFor = null;
  let boardTimer = null;

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
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

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  // --- доска -----------------------------------------------------------------

  async function refreshState() {
    const result = await api('/state');
    stages = result.stages;
    dialogues = result.dialogues;
    renderBoard();
  }

  function renderBoard() {
    const selected = selectedId;
    boardEl.innerHTML = stages
      .map((stage) => {
        const cards = dialogues.filter((d) => d.stage === stage.id);
        const cardsHtml = cards
          .map((d) => {
            const badges = [];
            if (Number(d.open_drafts) > 0) {
              badges.push(`<span class="ce-badge ce-badge--draft">черновик ×${d.open_drafts}</span>`);
            }
            if (d.last_role === 'visitor') {
              badges.push('<span class="ce-badge ce-badge--waiting">ждёт ответа</span>');
            }
            return `
              <div class="ce-card ${d.id === selected ? 'ce-card--selected' : ''}" data-id="${d.id}">
                <div class="ce-card__name">${esc(d.visitor_name)}</div>
                <div class="ce-card__snippet">${esc(d.last_text || '—')}</div>
                <div class="ce-card__meta">
                  <span>${esc(fmtTime(d.last_incoming_at || d.created_at))}</span>
                  ${badges.join('')}
                </div>
              </div>`;
          })
          .join('');
        const tint = stage.color || '';
        const colStyle = tint
          ? ` style="border-color:${tint};background:${tint}14"`
          : '';
        const titleStyle = tint ? ` style="color:${tint}"` : '';
        return `
          <div class="ce-col"${colStyle}>
            <div class="ce-col__title"${titleStyle}>${esc(stage.title)}
              <span class="ce-col__count">${cards.length}</span>
            </div>
            ${cardsHtml || ''}
          </div>`;
      })
      .join('');
  }

  boardEl.addEventListener('click', (e) => {
    const card = e.target.closest('.ce-card');
    if (!card) return;
    openChat(card.dataset.id);
  });

  // --- чат -------------------------------------------------------------------

  function stageOptions(selected) {
    return stages
      .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.title)}</option>`)
      .join('');
  }

  async function openChat(id) {
    selectedId = id;
    autoSuggestedFor = null;
    chatEl.hidden = false;
    noteEl.textContent = '';
    await refreshChat();
    refreshState();
  }

  async function refreshChat() {
    if (!selectedId) return;
    const result = await api(`/dialogues/${selectedId}/messages`);
    selectedDialogue = result.dialogue;
    messages = result.messages;
    renderChat();
    maybeAutoSuggest();
  }

  function bubble(message) {
    if (message.role === 'visitor') {
      return `<div class="ce-bubble ce-bubble--visitor">${esc(message.text)}<time>${esc(fmtTime(message.created_at))}</time></div>`;
    }
    if (message.role === 'manager') {
      return `<div class="ce-bubble ce-bubble--manager">${esc(message.text)}<time>${esc(fmtTime(message.created_at))}</time></div>`;
    }
    // draft
    if (message.state === 'open') {
      return `
        <div class="ce-bubble ce-bubble--draft" data-draft="${message.id}">
          <div class="ce-draft__label">Черновик ассистента</div>
          ${esc(message.text)}
          <div class="ce-draft__actions">
            <button class="ce-btn-mini" data-action="approve" data-id="${message.id}">Отправить</button>
            <button class="ce-btn-mini" data-action="edit" data-id="${message.id}">Править</button>
            <button class="ce-btn-mini" data-action="reject" data-id="${message.id}">Отклонить</button>
          </div>
        </div>`;
    }
    if (message.state === 'approved' || message.state === 'edited') {
      const mark = message.state === 'edited' ? ' · правка менеджера' : ' · как предложено';
      return `<div class="ce-bubble ce-bubble--manager">${esc(message.text)}<time>${esc(fmtTime(message.created_at))}${mark}</time></div>`;
    }
    return ''; // rejected / superseded не показываем
  }

  function renderChat() {
    if (!selectedDialogue) return;
    nameEl.value = selectedDialogue.visitor_name;
    notesEl.value = selectedDialogue.notes || '';
    stageEl.innerHTML = stageOptions(selectedDialogue.stage);
    const visible = messages.map(bubble).filter(Boolean);
    messagesEl.innerHTML = visible.length
      ? visible.join('')
      : '<div class="ce-empty">Сообщений пока нет</div>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  messagesEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const draftBox = e.target.closest('.ce-bubble--draft');

    const id = btn.dataset.id;
    try {
      if (btn.dataset.action === 'approve') {
        await api(`/drafts/${id}/approve`, { method: 'POST', body: {} });
      } else if (btn.dataset.action === 'reject') {
        await api(`/drafts/${id}/reject`, { method: 'POST', body: {} });
      } else if (btn.dataset.action === 'edit') {
        toggleDraftEdit(draftBox, id);
        return;
      }
      await refreshChat();
      refreshState();
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });

  function toggleDraftEdit(draftBox, id) {
    const existing = draftBox.querySelector('.ce-draft__edit');
    if (existing) {
      existing.remove();
      return;
    }
    const draft = messages.find((m) => m.id === id);
    const row = document.createElement('div');
    row.className = 'ce-draft__edit';
    row.innerHTML = `
      <textarea rows="3">${esc(draft ? draft.text : '')}</textarea>
      <div class="ce-draft__actions">
        <button class="ce-btn-mini" data-action="save-edit" data-id="${id}">Отправить правку</button>
        <button class="ce-btn-mini" data-action="cancel-edit">Отмена</button>
      </div>`;
    draftBox.appendChild(row);
    row.querySelector('textarea').focus();
    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'cancel-edit') {
        row.remove();
        return;
      }
      if (btn.dataset.action === 'save-edit') {
        try {
          await api(`/drafts/${id}/approve`, {
            method: 'POST',
            body: { text: row.querySelector('textarea').value },
          });
          await refreshChat();
          refreshState();
        } catch (err) {
          noteEl.textContent = err.message;
        }
      }
    });
  }

  // --- действия --------------------------------------------------------------

  async function suggest() {
    if (!selectedId) return;
    if (window.VeshaLlm && !window.VeshaLlm.isReady()) {
      noteEl.textContent = 'Модель не выбрана: заполните блок выбора модели выше.';
      return;
    }
    suggestBtn.disabled = true;
    noteEl.textContent = 'Спрашиваю ассистента…';
    try {
      const result = await api(`/dialogues/${selectedId}/draft`, {
        method: 'POST',
        body: { llm: window.VeshaLlm ? window.VeshaLlm.getPayload() : null },
      });
      if (result.ok) {
        noteEl.textContent = '';
      } else {
        // честный сбой: менеджер видит причину, конвейер не падает
        noteEl.textContent = `Ассистент не смог: ${result.message}`;
      }
    } catch (err) {
      noteEl.textContent = err.message;
    } finally {
      suggestBtn.disabled = false;
      await refreshChat();
      refreshState();
    }
  }

  async function maybeAutoSuggest() {
    if (!selectedDialogue || !messages.length) return;
    const last = messages[messages.length - 1];
    const hasOpenDraft = messages.some((m) => m.role === 'draft' && m.state === 'open');
    if (last.role !== 'visitor' || hasOpenDraft) return;
    if (autoSuggestedFor === last.id) return;
    if (!(window.VeshaLlm && window.VeshaLlm.isReady())) return;
    autoSuggestedFor = last.id;
    await suggest();
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || !selectedId) return;
    try {
      await api(`/dialogues/${selectedId}/replies`, { method: 'POST', body: { text } });
      inputEl.value = '';
      noteEl.textContent = '';
      await refreshChat();
      refreshState();
    } catch (err) {
      noteEl.textContent = err.message;
    }
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  suggestBtn.addEventListener('click', suggest);
  closeBtn.addEventListener('click', () => {
    selectedId = null;
    chatEl.hidden = true;
    refreshState();
  });

  stageEl.addEventListener('change', async () => {
    try {
      await api(`/dialogues/${selectedId}/stage`, {
        method: 'POST',
        body: { stage: stageEl.value },
      });
      refreshState();
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });

  notesEl.addEventListener('change', async () => {
    try {
      await api(`/dialogues/${selectedId}/card`, {
        method: 'POST',
        body: { notes: notesEl.value },
      });
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });

  nameEl.addEventListener('change', async () => {
    try {
      await api(`/dialogues/${selectedId}/card`, {
        method: 'POST',
        body: { visitorName: nameEl.value },
      });
      refreshState();
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });

  // --- персона ----------------------------------------------------------------

  personaBtn.addEventListener('click', async () => {
    try {
      const result = await api('/persona');
      personaText.value = result.value;
      personaModal.hidden = false;
    } catch (err) {
      noteEl.textContent = err.message;
    }
  });

  personaCancel.addEventListener('click', () => {
    personaModal.hidden = true;
  });

  personaSave.addEventListener('click', async () => {
    try {
      await api('/persona', { method: 'PUT', body: { value: personaText.value } });
      personaModal.hidden = true;
    } catch (err) {
      alert(err.message);
    }
  });

  // --- цикл -------------------------------------------------------------------

  refreshState();
  boardTimer = setInterval(async () => {
    try {
      await refreshState();
      if (selectedId) await refreshChat();
    } catch (err) {
      // тихий такт: доска просто не обновится до следующего тика
    }
  }, POLL_MS);
})();
