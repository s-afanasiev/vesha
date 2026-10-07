(function () {
  'use strict';

  const API = '/api/chat-engine';
  const POLL_MS = 3000;

  // доска — компонент kanban@1 <v-kanban> (/c/kanban.js): колонки, карточки,
  // drag&drop и перенос через POST /c/leads/move живут в рендерере; он сам
  // опрашивает /cards каждые 3 с. Дашборду остаётся чат и события.
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
  let selectedId = null;
  let selectedDialogue = null;
  let messages = [];
  // авто-черновик: одно предложение на каждое входящее, без повторов при сбое
  let autoSuggestedFor = null;

  const esc = window.VeshaUI.escapeHtml;

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

  // этапы для селекта чата — из меты компонента канбана (те же колонки)
  (async () => {
    try {
      // мета — контрактный конверт {ok, ...} без обёртки result, читаем getJson
      const meta = await window.VeshaUI.getJson(`${API}/c/leads/meta`);
      stages = meta.columns.map((c) => ({ id: c.id, title: c.name }));
      if (selectedDialogue) renderChat();
    } catch { /* селект наполнится после первого открытия чата */ }
  })();

  function refreshBoard() {
    if (boardEl.refresh) boardEl.refresh();
  }

  boardEl.addEventListener('v-card-click', (e) => {
    openChat(e.detail.id);
  });

  // --- чат -------------------------------------------------------------------

  function stageOptions(selected) {
    return stages
      .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.title)}</option>`)
      .join('');
  }

  async function openChat(id) {
    selectedId = id;
    boardEl.selectedId = id; // подсветка карточки в рендерере
    autoSuggestedFor = null;
    chatEl.hidden = false;
    noteEl.textContent = '';
    await refreshChat();
    refreshBoard();
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
      refreshBoard();
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
          refreshBoard();
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
      refreshBoard();
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
      refreshBoard();
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
    boardEl.selectedId = null;
    chatEl.hidden = true;
    refreshBoard();
  });

  stageEl.addEventListener('change', async () => {
    try {
      await api(`/dialogues/${selectedId}/stage`, {
        method: 'POST',
        body: { stage: stageEl.value },
      });
      refreshBoard();
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
      refreshBoard();
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
  // рекурсивный setTimeout, не setInterval (правило таймеров). Доска опрашивает
  // себя сама (v-kanban data-poll); здесь живёт только открытый чат — visitor
  // может ответить, а черновик приехать без действий менеджера.
  function tick() {
    setTimeout(async () => {
      if (!document.hidden && selectedId) {
        try {
          await refreshChat();
        } catch (err) {
          // тихий такт: чат просто не обновится до следующего тика
        }
      }
      tick();
    }, POLL_MS);
  }
  tick();
  refreshBoard();
})();
