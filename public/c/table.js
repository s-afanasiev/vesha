// v-table@1 — складской рендерер контракта table@1 (docs/ui-components.md).
// Монтирование: <v-table src="/api/<ns>/c/<id>"></v-table> (+ /c/ui.js, /c/table.css).
// Читает /meta и конфигурируется сам: сортировка по клику на шапке, поиск с
// debounce, выбор (всё/снять/пресеты через /ids), bulk-действия с loader,
// пагинация. События: v-select {ids}, v-action {id, response?|error?}.
// Метод: refresh(). Состояние выбора — клиентское, живёт в элементе.
(() => {
  'use strict';
  const { escapeHtml, fmtInt, getJson, postJson, debounce } = window.VeshaUI;
  const SUPPORTED = 'table@1';

  class VTable extends HTMLElement {

    connectedCallback() {
      if (this._s) return;
      this._s = {
        meta: null, rows: [], total: 0,
        sort: null, q: '', offset: 0, limit: 50,
        sel: new Set(), seq: 0, loading: false, flash: 0,
      };
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('keydown', (e) => this._onKey(e));
      this.addEventListener('change', (e) => this._onChange(e));
      this._boot();
    }

    get src() { return this.getAttribute('src'); }

    async _boot() {
      this.innerHTML = '<div class="vt-wrap"><div class="vt-msg">загрузка…</div></div>';
      let meta;
      try {
        meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
      } catch (e) {
        this.innerHTML = `<div class="vt-wrap"><div class="vt-msg vt-msg--err">${escapeHtml(e.message)}</div></div>`;
        return;
      }
      this._s.meta = meta;
      this._s.limit = (meta.limits && meta.limits.pageSize) || 50;
      this._renderChrome();
      await this._load();
    }

    refresh() { return this._s ? this._load() : Promise.resolve(); }

    // ---------- данные ----------

    async _load() {
      const s = this._s;
      const seq = ++s.seq;
      s.loading = true; this._foot();
      const qs = new URLSearchParams({ limit: s.limit, offset: s.offset });
      if (s.sort) qs.set('sort', s.sort);
      if (s.q) qs.set('q', s.q);
      try {
        const data = await getJson(`${this.src}/rows?${qs}`);
        if (seq !== s.seq) return; // поздний ответ не мешает свежему запросу
        s.rows = data.rows || [];
        s.total = data.total || 0;
      } catch (e) {
        if (seq === s.seq) this._flash(e.message);
      } finally {
        if (seq === s.seq) { s.loading = false; this._renderBody(); this._foot(); }
      }
    }

    async _ids(preset) {
      const s = this._s;
      const qs = new URLSearchParams();
      if (preset) qs.set('preset', preset);
      if (s.q) qs.set('q', s.q);
      const data = await getJson(`${this.src}/ids?${qs}`);
      return data.ids || [];
    }

    async _runAction(id, btn) {
      const ids = [...this._s.sel];
      btn.disabled = true; btn.classList.add('loading');
      try {
        const response = await postJson(`${this.src}/actions/${encodeURIComponent(id)}`, { ids });
        this.dispatchEvent(new CustomEvent('v-action', { detail: { id, response } }));
      } catch (e) {
        this._flash(e.message);
        this.dispatchEvent(new CustomEvent('v-action', { detail: { id, error: e.message } }));
      } finally {
        btn.classList.remove('loading');
        this._updateSel();
      }
    }

    // ---------- события (делегирование) ----------

    _onClick(e) {
      const s = this._s;
      if (!s || !s.meta) return;
      const t = e.target.closest('[data-vt-sort], [data-vt-action], [data-vt], [data-vt-preset]');
      if (!t || !this.contains(t)) return;
      if (t.dataset.vtSort) return this._toggleSort(t.dataset.vtSort, t.dataset.vtType);
      if (t.dataset.vtAction) return void this._runAction(t.dataset.vtAction, t);
      if (t.dataset.vtPreset) {
        return void this._ids(t.dataset.vtPreset)
          .then((ids) => this._setSelection(new Set(ids)))
          .catch((err) => this._flash(err.message));
      }
      switch (t.dataset.vt) {
        case 'all':
          return void this._ids()
            .then((ids) => this._setSelection(new Set(ids)))
            .catch((err) => this._flash(err.message));
        case 'clear': return this._setSelection(new Set());
        case 'prev': s.offset = Math.max(0, s.offset - s.limit); return void this._load();
        case 'next':
          if (s.offset + s.limit < s.total) { s.offset += s.limit; void this._load(); }
          return;
      }
    }

    _onKey(e) {
      const th = e.target.closest && e.target.closest('.vt-th[data-vt-sort]');
      if (th && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this._toggleSort(th.dataset.vtSort, th.dataset.vtType);
      }
    }

    _onChange(e) {
      const s = this._s;
      if (!s || !s.meta) return;
      const idKey = s.meta.idKey;
      const box = e.target;
      if (box.dataset.vtId != null) {
        const id = box.dataset.vtId;
        if (box.checked) s.sel.add(id); else s.sel.delete(id);
        this._syncHeaderBox();
        this._updateSel();
        this._emitSelect();
      } else if (box.dataset.vt === 'page') {
        const pageIds = s.rows.map((r) => String(r[idKey] ?? ''));
        for (const id of pageIds) { if (box.checked) s.sel.add(id); else s.sel.delete(id); }
        this._renderBody();
        this._updateSel();
        this._emitSelect();
      }
    }

    _toggleSort(key, type) {
      const s = this._s;
      const cur = s.sort ? (s.sort[0] === '-' ? { key: s.sort.slice(1), dir: -1 } : { key: s.sort, dir: 1 }) : null;
      // первый клик: числа — по убыванию, текст — по возрастанию
      s.sort = !cur || cur.key !== key
        ? (type === 'num' ? `-${key}` : key)
        : (cur.dir === 1 ? `-${key}` : key);
      s.offset = 0;
      this._renderHead();
      void this._load();
    }

    _setSelection(set) {
      this._s.sel = set;
      this._renderBody();
      this._updateSel();
      this._emitSelect();
    }

    _emitSelect() {
      this.dispatchEvent(new CustomEvent('v-select', { detail: { ids: [...this._s.sel] } }));
    }

    _flash(msg) {
      const el = this._els && this._els.msg;
      if (!el) return;
      el.textContent = msg;
      el.classList.add('vt-msg--err');
      clearTimeout(this._s.flash);
      this._s.flash = setTimeout(() => {
        el.classList.remove('vt-msg--err');
        this._foot();
      }, 4000);
    }

    // ---------- рендеры ----------

    _renderChrome() {
      const s = this._s, m = s.meta;
      const presets = m.select.presets
        .map((p) => `<button type="button" class="vt-btn" data-vt-preset="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`)
        .join('');
      const actions = m.actions
        .map((a) => `<button type="button" class="vt-btn vt-btn--act" data-vt-action="${escapeHtml(a.id)}"${a.bulk ? ' data-bulk="1"' : ''}>${escapeHtml(a.name)}</button>`)
        .join('');
      this.innerHTML = `
        <div class="vt-wrap">
          <div class="vt-bar">
            ${m.search ? '<input class="vt-search" type="search" placeholder="поиск…" aria-label="Поиск по таблице">' : ''}
            <button type="button" class="vt-btn" data-vt="all">Выбрать всё</button>
            <button type="button" class="vt-btn" data-vt="clear">Снять</button>
            ${presets}
            <span class="vt-selinfo" role="status"></span>
            <span class="vt-actions">${actions}</span>
          </div>
          <div class="vt-scroll">
            <table class="vt-table"><thead></thead><tbody></tbody></table>
          </div>
          <div class="vt-foot">
            <span class="vt-range"></span>
            <span class="vt-msg" role="status"></span>
            <span class="vt-pager" hidden>
              <button type="button" class="vt-btn" data-vt="prev" aria-label="Предыдущая страница">←</button>
              <button type="button" class="vt-btn" data-vt="next" aria-label="Следующая страница">→</button>
            </span>
          </div>
        </div>`;
      this._els = {
        search: this.querySelector('.vt-search'),
        selinfo: this.querySelector('.vt-selinfo'),
        thead: this.querySelector('thead'),
        tbody: this.querySelector('tbody'),
        range: this.querySelector('.vt-range'),
        msg: this.querySelector('.vt-msg'),
        pager: this.querySelector('.vt-pager'),
        prev: this.querySelector('[data-vt="prev"]'),
        next: this.querySelector('[data-vt="next"]'),
        headerBox: null,
      };
      if (this._els.search) {
        this._els.search.addEventListener('input', debounce(() => {
          s.q = this._els.search.value.trim();
          s.offset = 0;
          void this._load();
        }, 350));
      }
      this._renderHead();
      this._renderBody();
      this._foot();
      this._updateSel();
    }

    _renderHead() {
      const s = this._s, m = s.meta;
      const cur = s.sort ? (s.sort[0] === '-' ? { key: s.sort.slice(1), dir: 'desc' } : { key: s.sort, dir: 'asc' }) : null;
      const th = m.columns.map((c) => {
        const active = cur && cur.key === c.key;
        const aria = active ? cur.dir : 'none';
        const arrow = active
          ? `<span class="vt-arrow" aria-hidden="true">${cur.dir === 'asc' ? '▲' : '▼'}</span>`
          : (c.sortable ? '<span class="vt-arrow vt-arrow--dim" aria-hidden="true">↕</span>' : '');
        const attrs = c.sortable
          ? ` class="vt-th" data-vt-sort="${escapeHtml(c.key)}" data-vt-type="${escapeHtml(c.type || 'text')}" tabindex="0" title="Сортировать"`
          : ' class="vt-th"';
        return `<th${attrs} aria-sort="${aria}"><span>${escapeHtml(c.name)} ${arrow}</span></th>`;
      }).join('');
      this._els.thead.innerHTML =
        `<tr><th class="vt-check"><input type="checkbox" data-vt="page" aria-label="Выбрать все на странице"></th>${th}</tr>`;
      this._els.headerBox = this._els.thead.querySelector('[data-vt="page"]');
    }

    _renderBody() {
      const s = this._s, m = s.meta;
      const idKey = m.idKey;
      const trs = s.rows.map((row) => {
        const id = String(row[idKey] ?? '');
        const tds = m.columns.map((c) => {
          const cls = c.type === 'num' ? ' class="vt-num"' : '';
          return `<td${cls}>${cellHtml(row, c)}</td>`;
        }).join('');
        return `<tr><td class="vt-check"><input type="checkbox" data-vt-id="${escapeHtml(id)}" aria-label="Выбрать строку"${s.sel.has(id) ? ' checked' : ''}></td>${tds}</tr>`;
      }).join('');
      this._els.tbody.innerHTML = trs ||
        `<tr><td class="vt-empty" colspan="${m.columns.length + 1}">${s.loading ? 'загрузка…' : 'Пока пусто'}</td></tr>`;
      this._syncHeaderBox();
    }

    _foot() {
      const s = this._s;
      if (!this._els) return;
      const from = s.total === 0 ? 0 : s.offset + 1;
      const to = Math.min(s.offset + s.limit, s.total);
      this._els.range.textContent = `показаны ${from}–${to} из ${s.total}`;
      const paged = s.total > s.limit;
      this._els.pager.hidden = !paged;
      if (paged) {
        this._els.prev.disabled = s.offset === 0;
        this._els.next.disabled = s.offset + s.limit >= s.total;
      }
      if (!this._els.msg.classList.contains('vt-msg--err')) {
        this._els.msg.textContent = s.loading ? 'загрузка…' : '';
      }
    }

    _updateSel() {
      const s = this._s;
      if (!this._els) return;
      this._els.selinfo.textContent = s.sel.size
        ? `выбрано ${s.sel.size} из ${s.total}`
        : (s.total ? `всего ${s.total}` : '');
      this.querySelectorAll('[data-vt-action]').forEach((btn) => {
        if (btn.dataset.bulk === '1') btn.disabled = s.sel.size === 0;
      });
    }

    _syncHeaderBox() {
      const s = this._s;
      const box = this._els && this._els.headerBox;
      if (!box || !s.meta) return;
      const idKey = s.meta.idKey;
      const pageIds = s.rows.map((r) => String(r[idKey] ?? ''));
      box.checked = pageIds.length > 0 && pageIds.every((id) => s.sel.has(id));
      box.indeterminate = !box.checked && pageIds.some((id) => s.sel.has(id));
    }
  }

  function cellHtml(row, c) {
    const v = row[c.key];
    if (c.render === 'link') {
      if (v && /^https?:\/\//.test(String(v))) {
        let host = String(v);
        try { const u = new URL(String(v)); host = u.host + u.pathname.replace(/\/$/, ''); } catch {}
        return `<a href="${escapeHtml(v)}" target="_blank" rel="noopener" class="vt-link">${escapeHtml(host)}</a>`;
      }
      const note = c.note ? row[c.note] : null;
      return `<span class="vt-note">${escapeHtml(note || '—')}</span>`;
    }
    if (v == null || v === '') return '<span class="vt-note">—</span>';
    return escapeHtml(c.type === 'num' ? fmtInt(v) : v);
  }

  customElements.define('v-table', VTable);
})();
