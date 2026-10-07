// v-kanban@1 — складской рендерер контракта kanban@1 (docs/ui-components.md).
// Монтирование: <v-kanban src="/api/<ns>/c/<id>" data-poll="3000"></v-kanban>
// (+ /c/ui.js, /c/kanban.css). Из /meta: колонки (цвет, WIP-лимит), ключи
// полей карточки. Умеет: drag&drop и кнопочный фолбэк ←/→ (оба через
// POST /move — единственную дверь), подсветка перегруза колонки, пустые
// колонки, авто-опрос рекурсивным setTimeout (в фоне не дёргает сервер).
// События: v-card-click {id, card}, v-move {cardId, to, error?}.
// Методы: refresh(), свойство selectedId (подсветка карточки).
// Сбой перемещения — честный тост, карточка остаётся на месте.
(() => {
  'use strict';
  const { escapeHtml, getJson, postJson, toast } = window.VeshaUI;
  const SUPPORTED = 'kanban@1';

  class VKanban extends HTMLElement {

    connectedCallback() {
      if (this._s) return;
      this._s = {
        meta: null, cards: [],
        selectedId: null,
        dragging: false, moving: false, seq: 0,
      };
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('dragstart', (e) => this._onDragStart(e));
      this.addEventListener('dragend', () => this._onDragEnd());
      this.addEventListener('dragover', (e) => this._onDragOver(e));
      this.addEventListener('dragleave', (e) => this._onDragLeave(e));
      this.addEventListener('drop', (e) => this._onDrop(e));
      this._boot();
    }

    get src() { return this.getAttribute('src'); }
    get pollMs() { return Number(this.getAttribute('data-poll')) || 0; }

    get selectedId() { return this._s && this._s.selectedId; }
    set selectedId(id) {
      this._s.selectedId = id;
      this.querySelectorAll('.vk-card').forEach((el) => {
        el.classList.toggle('vk-card--selected', el.dataset.id === id);
      });
    }

    async _boot() {
      this.innerHTML = '<div class="vk-msg">загрузка…</div>';
      let meta;
      try {
        meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
      } catch (e) {
        this.innerHTML = `<div class="vk-msg vk-msg--err">${escapeHtml(e.message)}</div>`;
        return;
      }
      this._s.meta = meta;
      await this.refresh();
      this._schedulePoll();
    }

    refresh() {
      const seq = ++this._s.seq;
      return getJson(`${this.src}/cards`)
        .then((data) => {
          if (seq !== this._s.seq) return; // поздний ответ не мешает свежему
          this._s.cards = data.cards || [];
          // во время перетаскивания доску не перерисовываем — призрак умрёт;
          // свежие данные лягут при dragend (или следующем такте)
          if (!this._s.dragging && !this._s.moving) this._render();
        })
        .catch((e) => {
          if (seq === this._s.seq && !this._s.dragging) {
            this._flash(e.message);
          }
        });
    }

    _schedulePoll() {
      const ms = this.pollMs;
      if (!ms) return;
      setTimeout(() => {
        // фоновая вкладка: сервер не дёргаем, просто ждём следующего такта
        if (!document.hidden && !this._s.dragging && !this._s.moving) this.refresh();
        this._schedulePoll();
      }, ms);
    }

    // ---------- перемещения (drag&drop и кнопки — одна дверь) ----------

    _move(cardId, to) {
      const s = this._s;
      const card = s.cards.find((c) => String(c[s.meta.idKey]) === String(cardId));
      if (!card || String(card[s.meta.columnKey]) === String(to)) return Promise.resolve();
      s.moving = true;
      return postJson(`${this.src}/move`, { cardId, to })
        .then(() => {
          card[s.meta.columnKey] = to; // оптимистично, источник подтвердил
          this.dispatchEvent(new CustomEvent('v-move', { detail: { cardId, to } }));
        })
        .catch((e) => {
          this.dispatchEvent(new CustomEvent('v-move', { detail: { cardId, to, error: e.message } }));
          toast(`Не переместилось: ${e.message}`, { kind: 'err' });
        })
        .finally(() => {
          s.moving = false;
          this.refresh();
        });
    }

    _onDragStart(e) {
      const card = e.target.closest && e.target.closest('.vk-card');
      if (!card) return;
      this._s.dragging = true;
      this._s.dragId = card.dataset.id;
      card.classList.add('is-dragging');
      if (e.dataTransfer) e.dataTransfer.setData('text/plain', card.dataset.id);
    }

    _onDragEnd() {
      this._s.dragging = false;
      this.querySelectorAll('.vk-card.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
      this.querySelectorAll('.vk-col.is-over').forEach((col) => col.classList.remove('is-over'));
      this.refresh(); // за время драга могли приехать свежие карточки
    }

    _onDragOver(e) {
      const col = e.target.closest && e.target.closest('.vk-col');
      if (!col || !this._s.dragging) return;
      e.preventDefault(); // разрешаем drop
      this.querySelectorAll('.vk-col.is-over').forEach((c) => { if (c !== col) c.classList.remove('is-over'); });
      col.classList.add('is-over');
    }

    _onDragLeave(e) {
      const col = e.target.closest && e.target.closest('.vk-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
    }

    _onDrop(e) {
      const col = e.target.closest && e.target.closest('.vk-col');
      if (!col || !this._s.dragging) return;
      e.preventDefault();
      col.classList.remove('is-over');
      const cardId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || this._s.dragId;
      if (cardId) this._move(cardId, col.dataset.col);
    }

    // ---------- события (делегирование) ----------

    _onClick(e) {
      const s = this._s;
      if (!s || !s.meta) return;
      const btn = e.target.closest('[data-vk-move]');
      if (btn && this.contains(btn)) {
        const card = btn.closest('.vk-card');
        const to = this._neighbourCol(card, btn.dataset.vkMove);
        if (to) this._move(card.dataset.id, to);
        return;
      }
      const card = e.target.closest('.vk-card');
      if (card && this.contains(card)) {
        this.selectedId = card.dataset.id;
        const data = s.cards.find((c) => String(c[s.meta.idKey]) === String(card.dataset.id));
        this.dispatchEvent(new CustomEvent('v-card-click', { detail: { id: card.dataset.id, card: data } }));
      }
    }

    _neighbourCol(cardEl, dir) {
      const s = this._s;
      const card = s.cards.find((c) => String(c[s.meta.idKey]) === String(cardEl.dataset.id));
      const i = s.meta.columns.findIndex((c) => c.id === (card && card[s.meta.columnKey]));
      const j = dir === 'prev' ? i - 1 : i + 1;
      return j >= 0 && j < s.meta.columns.length ? s.meta.columns[j].id : null;
    }

    // ---------- рендеры ----------

    _render() {
      const s = this._s, m = s.meta;
      const byCol = new Map(m.columns.map((c) => [c.id, []]));
      for (const card of s.cards) {
        const col = byCol.get(card[m.columnKey]);
        if (col) col.push(card);
      }
      this.innerHTML = m.columns.map((col) => {
        const list = byCol.get(col.id);
        const count = col.limit
          ? `<span class="vk-col__count${list.length > col.limit ? ' is-over' : ''}">${list.length}/${col.limit}</span>`
          : `<span class="vk-col__count">${list.length}</span>`;
        const cards = list.map((card) => this._cardHtml(card)).join('');
        return `
          <div class="vk-col" data-col="${escapeHtml(col.id)}" style="--vk-col-color:${escapeHtml(col.color || 'var(--vk-line)')}">
            <div class="vk-col__head">
              <span class="vk-col__title">${escapeHtml(col.name)}${col.limit ? ` <span class="vk-col__limit">≤ ${col.limit}</span>` : ''}</span>
              ${count}
            </div>
            <div class="vk-col__cards">${cards || '<div class="vk-col__empty">пусто</div>'}</div>
          </div>`;
      }).join('');
    }

    _cardHtml(card) {
      const s = this._s, m = s.meta;
      const id = String(card[m.idKey] ?? '');
      const title = card[m.card.title];
      const snippet = m.card.snippet ? card[m.card.snippet] : '';
      const time = m.card.time ? relTime(card[m.card.time]) : '';
      const badges = (card.badges || [])
        .map((b) => `<span class="vk-badge${b.kind ? ` vk-badge--${escapeHtml(b.kind)}` : ''}">${escapeHtml(b.text)}</span>`)
        .join('');
      const moveBtns = m.move.enabled
        ? `<span class="vk-card__move">
             <button type="button" data-vk-move="prev" aria-label="Переместить в предыдущую колонку" title="←">←</button>
             <button type="button" data-vk-move="next" aria-label="Переместить в следующую колонку" title="→">→</button>
           </span>`
        : '';
      return `
        <div class="vk-card${id === s.selectedId ? ' vk-card--selected' : ''}" data-id="${escapeHtml(id)}" draggable="true">
          <div class="vk-card__top">
            <span class="vk-card__name">${escapeHtml(title == null ? '' : title)}</span>
            ${time ? `<span class="vk-card__time">${escapeHtml(time)}</span>` : ''}
          </div>
          ${snippet ? `<div class="vk-card__snippet">${escapeHtml(snippet)}</div>` : ''}
          ${badges ? `<div class="vk-card__badges">${badges}</div>` : ''}
          ${moveBtns}
        </div>`;
    }
  }

  function relTime(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин.`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ч.`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} дн.`;
    return `${Math.floor(days / 30)} мес.`;
  }

  customElements.define('v-kanban', VKanban);
})();
