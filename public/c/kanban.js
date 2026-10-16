// v-kanban@1 — складской рендерер контракта kanban@1 (docs/ui-components.md).
// Монтирование: <v-kanban src="/api/<ns>/c/<id>" data-poll="3000"></v-kanban>
// (+ /c/ui.js, /c/kanban.css). Из /meta: колонки (цвет, WIP-лимит), ключи
// полей карточки. Умеет: drag&drop и кнопочный фолбэк ←/→ (оба через
// POST /move — единственную дверь), подсветка перегруза колонки, пустые
// колонки, авто-опрос рекурсивным setTimeout (в фоне не дёргает сервер).
// События: v-card-click {id, card}, v-move {cardId, to, error?}.
// Методы: refresh(), свойство selectedId (подсветка карточки).
// Сбой перемещения — честный тост, карточка остаётся на месте.
// Если источник объявил create — кнопка и форма новой карточки (POST /cards);
// если configure — режим «настроить колонки» (POST /columns): название, тип,
// порядок, цвет, лимит, удаление с переносом карточек, новая колонка. Колонки
// тогда перечитываются из /meta на каждом такте; пока открыта форма или
// настройка, опрос доску не перерисовывает — ввод не теряется.
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
        panel: null, config: false, pendingRemove: null, busy: false,
      };
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('change', (e) => this._onChange(e));
      this.addEventListener('submit', (e) => this._onSubmit(e));
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

    _editing() {
      const s = this._s;
      return !!(s.panel || s.config || s.busy);
    }

    refresh() {
      const seq = ++this._s.seq;
      const s = this._s;
      // колонки с конструктором живые — перечитываем их вместе с карточками
      const meta = s.meta && s.meta.configure && s.meta.configure.enabled && !this._editing()
        ? getJson(`${this.src}/meta`) : Promise.resolve(null);
      return Promise.all([getJson(`${this.src}/cards`), meta])
        .then(([data, fresh]) => {
          if (seq !== this._s.seq) return; // поздний ответ не мешает свежему
          if (fresh) s.meta.columns = fresh.columns;
          s.lastErr = null;
          this._s.cards = data.cards || [];
          // во время перетаскивания доску не перерисовываем — призрак умрёт;
          // свежие данные лягут при dragend (или следующем такте); открытую
          // форму и настройку тоже не трогаем
          if (!this._s.dragging && !this._s.moving && !this._editing()) this._render();
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
      const act = e.target.closest('[data-vk-act]');
      if (act && this.contains(act)) {
        this._onAct(act.dataset.vkAct);
        return;
      }
      const cfg = e.target.closest('button[data-vk-cfg]');
      if (cfg && this.contains(cfg)) {
        this._onCfgButton(cfg);
        return;
      }
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

    // Ошибка загрузки: пока доски нет — сообщение на её месте; доска уже есть —
    // один тост на одну и ту же ошибку, а не на каждый такт опроса.
    _flash(msg) {
      if (!this.querySelector('.vk-col')) {
        this.innerHTML = `<div class="vk-msg vk-msg--err">${escapeHtml(msg)}</div>`;
        return;
      }
      if (this._s.lastErr === msg) return;
      this._s.lastErr = msg;
      toast(msg, { kind: 'err' });
    }

    // ---------- новая карточка и конструктор колонок ----------

    _onAct(act) {
      const s = this._s;
      if (act === 'create') s.panel = s.panel === 'create' ? null : 'create';
      if (act === 'cancel') s.panel = null;
      if (act === 'config') { s.config = !s.config; s.pendingRemove = null; }
      this._render();
      if (act === 'create' && s.panel) {
        const first = this.querySelector('.vk-panel input, .vk-panel textarea');
        if (first) first.focus();
      }
      if (!this._editing()) this.refresh();
    }

    _configure(body) {
      const s = this._s;
      s.busy = true;
      return postJson(`${this.src}/columns`, body)
        .then((data) => {
          s.meta.columns = data.columns;
          s.pendingRemove = null;
        })
        .catch((e) => toast(`Колонки не изменились: ${e.message}`, { kind: 'err' }))
        .finally(() => {
          s.busy = false;
          this._render();
          return this.refreshCards();
        });
    }

    refreshCards() {
      return getJson(`${this.src}/cards`)
        .then((data) => { this._s.cards = data.cards || []; this._render(); })
        .catch((e) => this._flash(e.message));
    }

    _onCfgButton(btn) {
      const s = this._s;
      const id = btn.closest('[data-col]').dataset.col;
      const i = s.meta.columns.findIndex((c) => c.id === id);
      const kind = btn.dataset.vkCfg;
      if (kind === 'left' || kind === 'right') {
        const to = kind === 'left' ? i - 1 : i + 1;
        if (to >= 0 && to < s.meta.columns.length) this._configure({ op: 'move', id, to });
      } else if (kind === 'remove') {
        const count = s.cards.filter((c) => c[s.meta.columnKey] === id).length;
        if (count > 0) { s.pendingRemove = id; this._render(); }
        else if (window.confirm(`Удалить колонку «${s.meta.columns[i].name}»?`)) this._configure({ op: 'remove', id });
      } else if (kind === 'remove-confirm') {
        const select = btn.closest('[data-col]').querySelector('[data-vk-moveto]');
        this._configure({ op: 'remove', id, moveTo: select && select.value });
      } else if (kind === 'remove-cancel') {
        s.pendingRemove = null;
        this._render();
      }
    }

    _onChange(e) {
      const el = e.target.closest('[data-vk-cfg]');
      if (!el || !this.contains(el) || el.tagName === 'BUTTON') return;
      const id = el.closest('[data-col]').dataset.col;
      const op = el.dataset.vkCfg;
      const value = el.value;
      if (op === 'rename') this._configure({ op, id, title: value });
      else if (op === 'retype') this._configure({ op, id, type: value });
      else if (op === 'recolor') this._configure({ op, id, color: value });
      else if (op === 'limit') this._configure({ op, id, limit: value === '' ? null : Number(value) });
    }

    _onSubmit(e) {
      const form = e.target.closest('form[data-vk-form]');
      if (!form || !this.contains(form)) return;
      e.preventDefault();
      const s = this._s;
      const values = Object.fromEntries(new FormData(form).entries());
      if (form.dataset.vkForm === 'add') {
        this._configure({ op: 'add', title: values.title, type: values.type });
        return;
      }
      s.busy = true;
      postJson(`${this.src}/cards`, values)
        .then(() => {
          s.panel = null;
          toast('Карточка создана', { kind: 'ok' });
        })
        .catch((err) => toast(`Не создалась: ${err.message}`, { kind: 'err' }))
        .finally(() => {
          s.busy = false;
          this._render();
          this.refreshCards();
        });
    }

    // ---------- рендеры ----------

    _render() {
      const s = this._s, m = s.meta;
      const byCol = new Map(m.columns.map((c) => [c.id, []]));
      for (const card of s.cards) {
        const col = byCol.get(card[m.columnKey]);
        if (col) col.push(card);
      }
      const create = m.create && m.create.enabled;
      const configure = m.configure && m.configure.enabled;
      const toolbar = create || configure
        ? `<div class="vk-toolbar">
             ${create ? `<button type="button" class="vk-tool" data-vk-act="create" aria-expanded="${s.panel === 'create'}">+ ${escapeHtml(m.create.label || 'Новая карточка')}</button>` : ''}
             ${configure ? `<button type="button" class="vk-tool${s.config ? ' is-on' : ''}" data-vk-act="config" aria-pressed="${s.config}">${s.config ? 'Готово' : 'Настроить колонки'}</button>` : ''}
           </div>`
        : '';
      const panel = s.panel === 'create' ? this._createHtml() : '';
      const addCol = s.config ? this._addColumnHtml() : '';
      this.innerHTML = toolbar + panel + m.columns.map((col) => {
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
            ${s.config ? this._configHtml(col, list.length) : ''}
            <div class="vk-col__cards">${cards || '<div class="vk-col__empty">пусто</div>'}</div>
          </div>`;
      }).join('') + addCol;
    }

    _createHtml() {
      const fields = (this._s.meta.create.fields || []).map((f) => {
        const req = f.required ? ' required' : '';
        const input = f.multiline
          ? `<textarea name="${escapeHtml(f.key)}" rows="3"${req}></textarea>`
          : `<input name="${escapeHtml(f.key)}" type="text"${req}>`;
        return `<label class="vk-field"><span>${escapeHtml(f.label || f.key)}${f.required ? ' *' : ''}</span>${input}</label>`;
      }).join('');
      return `
        <form class="vk-panel" data-vk-form="create">
          ${fields}
          <div class="vk-panel__actions">
            <button type="submit" class="vk-tool is-on">Создать</button>
            <button type="button" class="vk-tool" data-vk-act="cancel">Отмена</button>
          </div>
        </form>`;
    }

    _typeOptions(selected) {
      return (this._s.meta.configure.types || [])
        .map((t) => `<option value="${escapeHtml(t.id)}"${t.id === selected ? ' selected' : ''}>${escapeHtml(t.name)}</option>`)
        .join('');
    }

    _configHtml(col, cards) {
      const s = this._s;
      const others = s.meta.columns.filter((c) => c.id !== col.id)
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
      const removing = s.pendingRemove === col.id
        ? `<div class="vk-cfg__remove">
             <span>${cards} карт. перенести в</span>
             <select data-vk-moveto aria-label="Куда перенести карточки">${others}</select>
             <button type="button" data-vk-cfg="remove-confirm">Перенести и удалить</button>
             <button type="button" data-vk-cfg="remove-cancel">Отмена</button>
           </div>`
        : '';
      return `
        <div class="vk-cfg">
          <input class="vk-cfg__title" type="text" value="${escapeHtml(col.name)}" data-vk-cfg="rename" aria-label="Название колонки" maxlength="40">
          <select data-vk-cfg="retype" aria-label="Тип колонки">${this._typeOptions(col.type)}</select>
          <div class="vk-cfg__row">
            <button type="button" data-vk-cfg="left" aria-label="Переставить левее" title="левее">←</button>
            <button type="button" data-vk-cfg="right" aria-label="Переставить правее" title="правее">→</button>
            <input type="color" value="${escapeHtml(col.color || '#d9dde3')}" data-vk-cfg="recolor" aria-label="Цвет колонки">
            <input type="number" min="0" max="999" placeholder="лимит" value="${col.limit || ''}" data-vk-cfg="limit" aria-label="Лимит карточек">
            <button type="button" data-vk-cfg="remove" class="vk-cfg__del">Удалить</button>
          </div>
          ${removing}
        </div>`;
    }

    _addColumnHtml() {
      return `
        <form class="vk-col vk-col--add" data-vk-form="add">
          <div class="vk-col__head"><span class="vk-col__title">Новая колонка</span></div>
          <div class="vk-cfg">
            <input class="vk-cfg__title" name="title" type="text" placeholder="название" required maxlength="40" aria-label="Название новой колонки">
            <select name="type" aria-label="Тип новой колонки">${this._typeOptions('working')}</select>
            <button type="submit" class="vk-tool is-on">Добавить</button>
          </div>
        </form>`;
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
