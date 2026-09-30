// Клиентская логика для Суперсправочника (super-notes.js)

const state = {
  notes: [],
  tags: [],
  activeTag: null,
  navFilter: 'all',
  searchQuery: '',
  isSemantic: false,
  editingNoteId: null,
};

// Элементы DOM
const searchInput = document.getElementById('sn-search-input');
const searchClearBtn = document.getElementById('sn-search-clear');
const semanticToggle = document.getElementById('sn-semantic-toggle');
const activeFiltersWrap = document.getElementById('sn-active-filters');
const activeFilterText = document.getElementById('sn-active-filter-text');
const activeFilterRemove = document.getElementById('sn-active-filter-remove');
const tagCloudEl = document.getElementById('sn-tag-cloud');
const notesGridEl = document.getElementById('sn-notes-grid');
const statusMsgEl = document.getElementById('sn-status-message');

const createCardEl = document.getElementById('sn-create-card');
const formTitleEl = document.getElementById('sn-form-title');
const noteFormEl = document.getElementById('sn-note-form');
const noteIdInput = document.getElementById('note-id');
const noteTitleInput = document.getElementById('note-title');
const noteTagsInput = document.getElementById('note-tags');
const noteContentInput = document.getElementById('note-content');
const notePinnedInput = document.getElementById('note-pinned');

const btnOpenCreate = document.getElementById('btn-open-create');
const btnCloseForm = document.getElementById('btn-close-form');
const btnCancelForm = document.getElementById('btn-cancel-form');
const btnSeedLinux = document.getElementById('btn-seed-linux');

const countAllEl = document.getElementById('count-all');
const countPinnedEl = document.getElementById('count-pinned');
const countTreesEl = document.getElementById('count-trees');
const tagsTotalCountEl = document.getElementById('tags-total-count');

// Вспомогательные функции
function showStatus(text, type = 'success') {
  statusMsgEl.textContent = text;
  statusMsgEl.className = `sn-status ${type}`;
  statusMsgEl.hidden = false;
  setTimeout(() => {
    statusMsgEl.hidden = true;
  }, 4000);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Загрузка списка заметок с сервера
 */
async function loadNotes() {
  try {
    let url = '/api/super-notes?limit=100';

    if (state.isSemantic && state.searchQuery) {
      url = `/api/super-notes/search/semantic?q=${encodeURIComponent(state.searchQuery)}&limit=30`;
    } else {
      if (state.searchQuery) url += `&q=${encodeURIComponent(state.searchQuery)}`;
      if (state.activeTag) url += `&tag=${encodeURIComponent(state.activeTag)}`;
      if (state.navFilter === 'pinned') url += `&pinned=true`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Ошибка загрузки заметок');
    const data = await res.json();
    state.notes = data.notes || [];

    // Клиентский пост-фильтр для режима деревьев
    if (state.navFilter === 'trees' && !state.isSemantic) {
      state.notes = state.notes.filter(n => Array.isArray(n.items_json) && n.items_json.length > 0);
    }

    updateCounts();
    renderNotes();
  } catch (err) {
    notesGridEl.innerHTML = `<p class="sn-status error">Не удалось загрузить заметки: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Загрузка облака тегов
 */
async function loadTags() {
  try {
    const res = await fetch('/api/super-notes/tags');
    if (!res.ok) return;
    const data = await res.json();
    state.tags = data.tags || [];
    renderTags();
  } catch (err) {
    console.warn('Не удалось загрузить теги:', err);
  }
}

/**
 * Подсчет счетчиков в сайдбаре
 */
function updateCounts() {
  const allCount = state.notes.length;
  const pinnedCount = state.notes.filter(n => n.is_pinned).length;
  const treesCount = state.notes.filter(n => Array.isArray(n.items_json) && n.items_json.length > 0).length;

  if (countAllEl) countAllEl.textContent = allCount;
  if (countPinnedEl) countPinnedEl.textContent = pinnedCount;
  if (countTreesEl) countTreesEl.textContent = treesCount;
  if (tagsTotalCountEl) tagsTotalCountEl.textContent = state.tags.length;
}

/**
 * Отрисовка облака тегов
 */
function renderTags() {
  if (!tagCloudEl) return;
  if (state.tags.length === 0) {
    tagCloudEl.innerHTML = '<p class="sn-empty-hint">Тегов пока нет</p>';
    return;
  }

  tagCloudEl.innerHTML = state.tags.map(t => {
    const isActive = state.activeTag === t.name;
    return `
      <button 
        type="button" 
        class="sn-tag-chip ${isActive ? 'active' : ''}" 
        data-tag="${escapeHtml(t.name)}"
      >
        <span>#${escapeHtml(t.name)}</span>
        <span class="sn-tag-count">${t.count}</span>
      </button>
    `;
  }).join('');
}

/**
 * Отрисовка списка заметок
 */
function renderNotes() {
  if (!notesGridEl) return;

  if (state.notes.length === 0) {
    notesGridEl.innerHTML = `
      <div class="sn-card" style="text-align: center; padding: 3rem 1rem;">
        <h3>Ничего не найдено</h3>
        <p style="color: var(--sn-text-muted); margin-top: 0.5rem;">
          ${state.searchQuery || state.activeTag 
            ? 'Попробуйте сбросить поисковый запрос или фильтр по тегам' 
            : 'Создайте свою первую заметку или нажмите кнопку демо-кейса в левой панели'}
        </p>
      </div>
    `;
    return;
  }

  notesGridEl.innerHTML = state.notes.map(note => {
    const isPinned = note.is_pinned;
    const hasItems = Array.isArray(note.items_json) && note.items_json.length > 0;
    const items = hasItems ? note.items_json : [];

    // Теги карточки
    const tagsHtml = Array.isArray(note.tags) && note.tags.length > 0
      ? note.tags.map(t => `
          <button type="button" class="sn-tag-chip" data-tag="${escapeHtml(t.name)}">
            #${escapeHtml(t.name)}
          </button>
        `).join('')
      : '';

    // Бейдж сходства при семантическом поиске
    const similarityBadge = note.similarity_score !== undefined
      ? `<span class="sn-similarity-badge" title="Степень семантического совпадения">🧠 ${Math.round(note.similarity_score * 100)}% совпадение</span>`
      : '';

    // Иерархическое дерево ссылок (<details><summary>)
    let treeHtml = '';
    if (hasItems) {
      treeHtml = `
        <details class="sn-tree" open>
          <summary class="sn-tree-summary">
            <span>📦 Сгруппировано элементов: ${items.length}</span>
          </summary>
          <ul class="sn-tree-list">
            ${items.map(it => {
              const url = it.url ? escapeHtml(it.url) : null;
              const title = escapeHtml(it.title || 'Ссылка');
              const desc = it.description ? escapeHtml(it.description) : '';
              return `
                <li class="sn-tree-item">
                  <div class="sn-item-left">
                    ${url 
                      ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="sn-item-link">${title}</a>`
                      : `<strong>${title}</strong>`
                    }
                    ${desc ? `<span class="sn-item-desc">— ${desc}</span>` : ''}
                  </div>
                  <button type="button" class="sn-copy-btn" data-copy="${url || title}" title="Копировать">
                    📋
                  </button>
                </li>
              `;
            }).join('')}
          </ul>
        </details>
      `;
    }

    return `
      <article class="sn-card ${isPinned ? 'pinned' : ''}" data-id="${note.id}">
        <div class="sn-card-head">
          <h3 class="sn-card-title">${escapeHtml(note.title)}</h3>
          ${similarityBadge}
        </div>

        ${tagsHtml ? `<div class="sn-card-tags">${tagsHtml}</div>` : ''}

        ${note.content_raw && !hasItems 
          ? `<div class="sn-card-text">${escapeHtml(note.content_raw)}</div>` 
          : ''}

        ${treeHtml}

        <div class="sn-card-foot">
          <time datetime="${note.updated_at}">${formatDate(note.updated_at)}</time>
          <div class="sn-card-actions">
            <button type="button" class="sn-icon-btn btn-pin" title="${isPinned ? 'Открепить' : 'Закрепить'}">
              ${isPinned ? '📌 Закреплено' : '📍 Закрепить'}
            </button>
            <button type="button" class="sn-icon-btn btn-edit" title="Редактировать">
              ✏️ Изменить
            </button>
            <button type="button" class="sn-icon-btn danger btn-delete" title="Удалить">
              🗑️
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/**
 * Открытие формы создания новой заметки
 */
function openCreateForm(prefill = null) {
  state.editingNoteId = prefill && prefill.id ? prefill.id : null;
  formTitleEl.textContent = state.editingNoteId ? 'Редактирование заметки' : 'Новая запись';

  noteIdInput.value = state.editingNoteId || '';
  noteTitleInput.value = prefill ? prefill.title || '' : '';
  noteTagsInput.value = prefill && Array.isArray(prefill.tags) 
    ? prefill.tags.map(t => `#${t.name}`).join(', ') 
    : '';
  noteContentInput.value = prefill ? prefill.content_raw || '' : '';
  notePinnedInput.checked = prefill ? Boolean(prefill.is_pinned) : false;

  createCardEl.hidden = false;
  createCardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  noteTitleInput.focus();
}

/**
 * Закрытие формы создания
 */
function closeForm() {
  createCardEl.hidden = true;
  noteFormEl.reset();
  state.editingNoteId = null;
}

/**
 * Сохранение заметки (POST или PUT)
 */
async function handleFormSubmit(e) {
  e.preventDefault();
  const title = noteTitleInput.value.trim();
  const content = noteContentInput.value.trim();
  const tagsStr = noteTagsInput.value.trim();
  const isPinned = notePinnedInput.checked;

  if (!title) return;

  const payload = {
    title,
    content_raw: content,
    tags: tagsStr,
    is_pinned: isPinned,
    reparse_items: true,
  };

  try {
    let res;
    if (state.editingNoteId) {
      res = await fetch(`/api/super-notes/${state.editingNoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch('/api/super-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      let serverErr = '';
      try {
        const errJson = await res.json();
        serverErr = errJson && errJson.error ? errJson.error : '';
      } catch {}
      throw new Error(serverErr ? `Ошибка сервера: ${serverErr}` : 'Не удалось сохранить заметку');
    }
    closeForm();
    showStatus(state.editingNoteId ? 'Заметка обновлена' : 'Заметка создана');
    await Promise.all([loadNotes(), loadTags()]);
  } catch (err) {
    alert(err.message);
  }
}

/**
 * Демо-кейс с Linux-пакетами (запрос пользователя)
 */
async function seedLinuxDemo() {
  const payload = {
    title: 'Пакетные менеджеры и магазины приложений для Linux',
    tags: 'linux, tools, devops, software',
    is_pinned: true,
    content_raw: 
`plasma-discover - https://userbase.kde.org/Discover - Графический центр приложений KDE с поддержкой Flatpak и Snap
stplr - https://github.com/stplr - Консольная утилита управления пакетами и зависимостями
apm - https://atom.io - Менеджер пакетов и расширений
flatpak - https://flatpak.org - Универсальная система дистрибуции изолированных приложений`,
  };

  try {
    const res = await fetch('/api/super-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let serverErr = '';
      try {
        const errJson = await res.json();
        serverErr = errJson && errJson.error ? errJson.error : '';
      } catch {}
      throw new Error(serverErr ? `Ошибка сервера: ${serverErr}` : 'Ошибка создания демо-заметки');
    }
    showStatus('Демо-заметка с 4 пакетами Linux успешно добавлена!');
    await Promise.all([loadNotes(), loadTags()]);
  } catch (err) {
    alert(err.message);
  }
}

// Слушатели событий
btnOpenCreate?.addEventListener('click', () => openCreateForm());
btnCloseForm?.addEventListener('click', closeForm);
btnCancelForm?.addEventListener('click', closeForm);
noteFormEl?.addEventListener('submit', handleFormSubmit);
btnSeedLinux?.addEventListener('click', seedLinuxDemo);

// Поиск
let searchTimer = null;
searchInput?.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  state.searchQuery = val;
  searchClearBtn.hidden = !val;

  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadNotes();
  }, 250);
});

searchClearBtn?.addEventListener('click', () => {
  searchInput.value = '';
  state.searchQuery = '';
  searchClearBtn.hidden = true;
  loadNotes();
});

semanticToggle?.addEventListener('change', (e) => {
  state.isSemantic = e.target.checked;
  loadNotes();
});

// Клик по тегу в облаке или карточке
document.addEventListener('click', (e) => {
  const tagBtn = e.target.closest('[data-tag]');
  if (tagBtn) {
    const tag = tagBtn.dataset.tag;
    if (state.activeTag === tag) {
      state.activeTag = null;
      activeFiltersWrap.hidden = true;
    } else {
      state.activeTag = tag;
      activeFilterText.textContent = `#${tag}`;
      activeFiltersWrap.hidden = false;
    }
    renderTags();
    loadNotes();
    return;
  }

  // Копирование ссылок в буфер
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const text = copyBtn.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = orig; }, 1200);
    });
    return;
  }

  // Действия над карточкой
  const card = e.target.closest('.sn-card');
  if (!card) return;
  const noteId = card.dataset.id;
  const note = state.notes.find(n => n.id === noteId);

  // Удаление
  if (e.target.closest('.btn-delete')) {
    if (confirm(`Удалить заметку "${note.title}"?`)) {
      fetch(`/api/super-notes/${noteId}`, { method: 'DELETE' }).then(() => {
        showStatus('Заметка удалена');
        loadNotes();
        loadTags();
      });
    }
    return;
  }

  // Изменение закрепления (Pin)
  if (e.target.closest('.btn-pin')) {
    fetch(`/api/super-notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: !note.is_pinned }),
    }).then(() => {
      loadNotes();
    });
    return;
  }

  // Редактирование
  if (e.target.closest('.btn-edit')) {
    openCreateForm(note);
    return;
  }
});

// Сброс фильтра по тегу
activeFilterRemove?.addEventListener('click', () => {
  state.activeTag = null;
  activeFiltersWrap.hidden = true;
  renderTags();
  loadNotes();
});

// Навигация в сайдбаре
document.querySelectorAll('.sn-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sn-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.navFilter = btn.dataset.filter;
    loadNotes();
  });
});

// Горячие клавиши
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openCreateForm();
  }
  if (e.key === 'Escape') {
    if (!createCardEl.hidden) {
      closeForm();
    } else if (state.searchQuery) {
      searchInput.value = '';
      state.searchQuery = '';
      searchClearBtn.hidden = true;
      loadNotes();
    }
  }
});

// Инициализация при загрузке страницы
Promise.all([loadNotes(), loadTags()]);
