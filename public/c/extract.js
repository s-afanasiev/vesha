// v-extract@1 — складской рендерер контракта extract@1 (docs/ui-components.md §2г):
// источник целиком и одна или несколько колонок его прочтений — пункты цветом тона
// (ok | ask | miss) с пометкой и заметкой. Щелчок по пункту подсвечивает его строки в
// источнике и пункты других колонок на том же месте; щелчок по строке источника — её
// пункты. Закрытая колонка — причина; «глаз» (peek) — пункты открывает человек; совет
// колонки (hint) — плашкой. Действия: на колонку — кнопки над пунктами; на пункт —
// варианты кнопками всегда (с отличием), «ещё N» свёрнуто с поиском и фильтром по
// отличию, прочие действия — у выбранного пункта. После действия — событие v-changed
// (всплывает): boot@1 перечитывает соседние блоки.
// Монтирование: <v-extract src="/api/<ns>/c/<id>" key="<ключ>" data-poll> (+ /c/ui.js,
// /c/extract.css). Методы: refresh().
(() => {
  'use strict';
  const { escapeHtml, getJson, postJson } = window.VeshaUI;
  const SUPPORTED = 'extract@1';
  const MARKS = { ok: '✓', ask: '?', miss: '✗' };
  const MAX_CHIPS = 12; // отличий больше — фильтр только поиском

  class VExtract extends HTMLElement {
    connectedCallback() {
      if (this._s) return;
      this._s = { meta: null, view: null, last: '', seq: 0, busy: false, form: null, peeked: new Set(), item: null, line: null, col: null };
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('submit', (e) => this._onSubmit(e));
      this.addEventListener('input', (e) => this._onFilter(e));
      this.addEventListener('keydown', (e) => {
        const it = e.target.closest && e.target.closest('[data-vx-item]');
        if (it && e.target === it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this._pickItem(it.dataset.vxItem); }
      });
      this._boot();
    }

    get src() { return this.getAttribute('src'); }
    get key() { return this.getAttribute('key') || ''; }
    get pollMs() { return Number(this.getAttribute('data-poll')) || 0; }

    async _boot() {
      this.innerHTML = '<div class="vx-msg">загрузка…</div>';
      try {
        const meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
        this._s.meta = meta;
        this._s.actions = new Map(meta.actions.map((a) => [a.id, a]));
      } catch (e) {
        this._fail(e.message);
        return;
      }
      await this.refresh();
      this._schedulePoll();
    }

    refresh() {
      const s = this._s;
      if (!s || !s.meta) return Promise.resolve();
      if (!this.key) {
        this._fail('не указано, что показать: нет ключа в адресе');
        return Promise.resolve();
      }
      const seq = ++s.seq;
      return getJson(`${this.src}/view?key=${encodeURIComponent(this.key)}`)
        .then((view) => {
          if (seq !== s.seq) return;
          const json = JSON.stringify(view);
          if (json === s.last) return;
          s.last = json;
          s.view = view;
          this._render();
        })
        .catch((e) => { if (seq === s.seq) this._fail(e.message); });
    }

    _schedulePoll() {
      if (!this.pollMs) return;
      setTimeout(() => {
        // пока открыта форма, идёт действие или открыт список «ещё N» — не перерисовываем под рукой
        const open = this.querySelector('details.vx-more[open]');
        if (!document.hidden && this.isConnected && !this._s.form && !this._s.busy && !open) this.refresh();
        this._schedulePoll();
      }, this.pollMs);
    }

    _fail(msg) {
      this.innerHTML = `<div class="vx-msg vx-msg--err">${escapeHtml(msg)}</div>`;
    }

    // ---------- отрисовка ----------

    _render() {
      const { view: v } = this._s;
      const src = v.source.lines.map((l, i) => `
        <li class="vx-line" data-vx-line="${i}"><span class="vx-n">${i + 1}</span><span class="vx-t">${escapeHtml(l) || '&nbsp;'}</span></li>`).join('');
      this.innerHTML = `
        <div class="vx">
          <header class="vx-head">
            <strong class="vx-title">${escapeHtml(v.title)}</strong>
            ${v.subtitle ? `<span class="vx-sub">${escapeHtml(v.subtitle)}</span>` : ''}
            ${facts(v.facts)}
          </header>
          <div class="vx-cols vx-cols--${1 + v.results.length}">
            <section class="vx-col vx-col--src" aria-label="${escapeHtml(v.source.title)}">
              <h3 class="vx-col-title">${escapeHtml(v.source.title)}</h3>
              ${v.source.note ? `<p class="vx-note">${escapeHtml(v.source.note)}</p>` : ''}
              <ol class="vx-src">${src || '<li class="vx-line"><span class="vx-t">— пусто —</span></li>'}</ol>
            </section>
            ${v.results.map((r) => this._column(r)).join('')}
          </div>
        </div>`;
      this._light();
    }

    _column(r) {
      const { meta } = this._s;
      const peeked = this._s.peeked.has(r.id);
      const showItems = r.state === 'open' || (r.state === 'peek' && peeked);
      const legend = ['ok', 'ask', 'miss'].map((t) => `<span class="vx-legend-i vx--${t}"><span class="vx-dot">${MARKS[t]}</span>${escapeHtml(meta.legend[t])}</span>`).join('');
      const gate = r.state === 'closed' || (r.state === 'peek' && !peeked)
        ? `<div class="vx-gate">
            ${r.reason ? `<p>${escapeHtml(r.reason)}</p>` : ''}
            ${r.state === 'peek' ? `<button type="button" class="vx-btn vx-btn--eye" data-vx="peek"><span aria-hidden="true">👁</span> ${escapeHtml(r.peek)}</button>` : ''}
          </div>` : '';
      // действия колонки — над пунктами: до них не нужно листать двадцать строк
      const bar = r.actions.map((id) => this._s.actions.get(id)).filter((a) => a && a.scope === 'all');
      const actions = `
        ${bar.length ? `<div class="vx-bar">${bar.map((a) => `<button type="button" class="vx-btn${a.primary ? ' vx-btn--main' : ''}" data-vx-act="${escapeHtml(a.id)}">${escapeHtml(a.name)}</button>`).join('')}</div>` : ''}
        <form class="vx-form" data-vx-form="col:${escapeHtml(r.id)}" hidden></form>
        <div class="vx-msg" role="status"></div>`;
      const items = showItems ? `
        ${r.state === 'peek' && r.reason ? `<p class="vx-reason">${escapeHtml(r.reason)} <button type="button" class="vx-link" data-vx="unpeek">спрятать</button></p>` : ''}
        ${facts(r.facts)}
        ${actions}
        ${r.items.length ? `<div class="vx-legend">${legend}</div>` : ''}
        <ol class="vx-items">${r.items.map((it) => this._item(it, r)).join('')}</ol>
        ${r.extra.length ? `<ul class="vx-extra">${r.extra.map((x) => `<li class="vx-pair vx-pair--${x.tone}">${escapeHtml(x.text)}</li>`).join('')}</ul>` : ''}` : actions;
      return `
        <section class="vx-col vx-col--res" data-vx-col="${escapeHtml(r.id)}" aria-label="${escapeHtml(r.title)}">
          <h3 class="vx-col-title">${escapeHtml(r.title)}</h3>
          ${r.hint ? `<p class="vx-hint" role="note">${escapeHtml(r.hint)}</p>` : ''}
          ${gate}${items}
        </section>`;
    }

    _item(it, r) {
      const acts = r.actions.map((id) => this._s.actions.get(id))
        .filter((a) => a && a.scope === 'item' && (!a.tones || a.tones.includes(it.tone)) && (!it.actions || it.actions.includes(a.id)));
      const choose = acts.find((a) => a.choose);
      const option = (a, c) => `
        <button type="button" class="vx-btn vx-btn--choice" data-vx-act="${escapeHtml(a.id)}" data-vx-value="${escapeHtml(c.value)}" data-vx-text="${escapeHtml(`${c.text} ${c.note || ''}`.toLowerCase())}" data-vx-note="${escapeHtml(c.note || '')}">
          ${escapeHtml(c.text)}${c.note ? ` <b class="vx-differs">${escapeHtml(c.note)}</b>` : ''}
        </button>`;
      // варианты (choose) видны всегда — это решение, которого ждут; прочие действия —
      // у выбранного пункта, иначе двадцать строк по две кнопки заслоняют сам разбор
      const choices = choose && it.choices ? `
        <div class="vx-item-acts vx-item-acts--choices"><span class="vx-choose">${escapeHtml(choose.name)}:</span>${it.choices.map((c) => option(choose, c)).join('')}</div>` : '';
      const notes = choose && it.more ? [...new Set(it.more.map((c) => c.note).filter(Boolean))] : [];
      const more = choose && it.more ? `
        <details class="vx-more">
          <summary>ещё ${it.more.length} ${plural(it.more.length, ['вариант', 'варианта', 'вариантов'])}</summary>
          <div class="vx-more-tools">
            <input type="search" class="vx-filter" placeholder="поиск: артикул, размер, покрытие" aria-label="Поиск среди вариантов">
            ${notes.length > 1 && notes.length <= MAX_CHIPS ? `<div class="vx-chips">${notes.map((n) => `<button type="button" class="vx-chip" data-vx-chip="${escapeHtml(n.toLowerCase())}">${escapeHtml(n)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="vx-more-list">${it.more.map((c) => option(choose, c)).join('')}</div>
        </details>` : '';
      const rest = acts.filter((a) => !a.choose)
        .map((a) => `<button type="button" class="vx-btn vx-btn--more" data-vx-act="${escapeHtml(a.id)}">${escapeHtml(a.name)}</button>`).join('');
      const where = it.anchors.length ? `<span class="vx-where">стр. ${it.anchors.map((n) => n + 1).join(', ')}</span>` : '';
      return `
        <li class="vx-item vx--${it.tone}" data-vx-item="${escapeHtml(it.id)}" tabindex="0">
          <div class="vx-item-main">
            <span class="vx-dot" title="${escapeHtml(this._s.meta.legend[it.tone])}">${MARKS[it.tone]}</span>
            <span class="vx-text">${escapeHtml(it.text)}</span>
            ${it.tag ? `<span class="vx-tag">${escapeHtml(it.tag)}</span>` : ''}
            ${where}
          </div>
          ${it.sub ? `<div class="vx-item-sub">${escapeHtml(it.sub)}</div>` : ''}
          ${it.note ? `<div class="vx-item-note">${escapeHtml(it.note)}</div>` : ''}
          ${it.pair ? `<div class="vx-pair vx-pair--${it.pair.tone}">${escapeHtml(it.pair.text)}</div>` : ''}
          ${choices}${more}
          ${rest ? `<div class="vx-item-acts vx-item-acts--more">${rest}</div>` : ''}
          <form class="vx-form" data-vx-form="${escapeHtml(it.id)}" hidden></form>
        </li>`;
    }

    // подсветка: выбранный пункт → его строки источника и пункты других колонок на том же
    // месте; выбранная строка источника → её пункты во всех колонках
    _light() {
      const { view, item, line } = this._s;
      const items = view.results.flatMap((r) => r.items);
      const lit = new Set();
      if (item) {
        const it = items.find((x) => x.id === item);
        if (it) it.anchors.forEach((n) => lit.add(n));
      } else if (line != null) lit.add(line);
      for (const el of this.querySelectorAll('[data-vx-line]')) el.classList.toggle('is-lit', lit.has(Number(el.dataset.vxLine)));
      for (const el of this.querySelectorAll('[data-vx-item]')) {
        const it = items.find((x) => x.id === el.dataset.vxItem);
        el.classList.toggle('is-on', el.dataset.vxItem === item);
        el.classList.toggle('is-near', Boolean(it && el.dataset.vxItem !== item && it.anchors.some((n) => lit.has(n))));
      }
      return [...lit][0];
    }

    _pickItem(id) {
      const s = this._s;
      s.line = null;
      s.item = s.item === id ? null : id;
      const first = this._light();
      if (first == null) return;
      // колонки рядом — прокручиваем источник к строке, не двигая страницу
      const box = this.querySelector('.vx-src');
      const row = box && box.querySelector(`[data-vx-line="${first}"]`);
      const own = this.querySelector(`[data-vx-item="${CSS.escape(id)}"]`);
      const col = own && own.closest('.vx-col--res');
      if (row && col && box.getBoundingClientRect().right <= col.getBoundingClientRect().left + 1) {
        box.scrollTop = row.offsetTop - box.clientHeight / 2;
      }
    }

    // ---------- действия ----------

    _onClick(e) {
      const s = this._s;
      if (!s.view || s.busy) return;
      const t = e.target.closest('[data-vx], [data-vx-act], [data-vx-chip], [data-vx-line], [data-vx-item]');
      if (!t || !this.contains(t)) return;
      const col = t.closest('[data-vx-col]');
      if (t.dataset.vx === 'peek') { s.peeked.add(col.dataset.vxCol); return this._render(); }
      if (t.dataset.vx === 'unpeek') { s.peeked.delete(col.dataset.vxCol); return this._render(); }
      if (t.dataset.vx === 'cancel') return this._closeForm();
      if (t.dataset.vxChip != null) {
        const box = t.closest('details');
        const on = !t.classList.contains('is-on');
        for (const c of box.querySelectorAll('.vx-chip')) c.classList.toggle('is-on', on && c === t);
        return this._filter(box);
      }
      if (t.dataset.vxAct) {
        const action = s.actions.get(t.dataset.vxAct);
        const item = t.closest('[data-vx-item]');
        const itemId = item ? item.dataset.vxItem : null;
        s.col = col ? col.dataset.vxCol : null;
        if (action.fields && action.fields.length) return this._openForm(action, itemId);
        return void this._run(action, { item: itemId, value: t.dataset.vxValue ?? null }, t);
      }
      if (e.target.closest('form, button, a, input, textarea, details')) return;
      if (t.dataset.vxItem) return this._pickItem(t.dataset.vxItem);
      if (t.dataset.vxLine != null) {
        s.item = null;
        s.line = s.line === Number(t.dataset.vxLine) ? null : Number(t.dataset.vxLine);
        this._light();
      }
    }

    // «ещё N»: поиск по тексту варианта и фильтр по отличию
    _onFilter(e) {
      const box = e.target.closest && e.target.closest('details.vx-more');
      if (box && e.target.classList.contains('vx-filter')) this._filter(box);
    }

    _filter(box) {
      const q = (box.querySelector('.vx-filter').value || '').trim().toLowerCase();
      const chip = box.querySelector('.vx-chip.is-on');
      const note = chip ? chip.dataset.vxChip : null;
      for (const b of box.querySelectorAll('.vx-more-list .vx-btn--choice')) {
        b.hidden = Boolean((q && !b.dataset.vxText.includes(q)) || (note && (b.dataset.vxNote || '').toLowerCase() !== note));
      }
    }

    _openForm(action, itemId) {
      this._closeForm();
      const form = this.querySelector(`[data-vx-form="${CSS.escape(itemId || `col:${this._s.col}`)}"]`);
      if (!form) return;
      this._s.form = { action: action.id, item: itemId };
      form.innerHTML = `
        <span class="vx-form-title">${escapeHtml(action.name)}</span>
        ${action.fields.map((f) => `
          <label class="vx-field">${escapeHtml(f.label)}
            ${f.multiline
              ? `<textarea name="${escapeHtml(f.key)}" rows="6"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}></textarea>`
              : `<input name="${escapeHtml(f.key)}"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}>`}
          </label>`).join('')}
        <div class="vx-form-acts">
          <button type="submit" class="vx-btn vx-btn--main">Применить</button>
          <button type="button" class="vx-btn" data-vx="cancel">Отмена</button>
        </div>`;
      form.hidden = false;
      const first = form.querySelector('input, textarea');
      if (first) first.focus();
    }

    _closeForm() {
      this._s.form = null;
      for (const f of this.querySelectorAll('.vx-form')) { f.hidden = true; f.innerHTML = ''; }
    }

    _onSubmit(e) {
      const form = e.target.closest('.vx-form');
      if (!form || !this._s.form) return;
      e.preventDefault();
      const { action, item } = this._s.form;
      const values = Object.fromEntries(new FormData(form).entries());
      void this._run(this._s.actions.get(action), { item, ...values }, form.querySelector('[type="submit"]'));
    }

    async _run(action, body, btn) {
      const s = this._s;
      s.busy = true;
      if (btn) { btn.disabled = true; btn.classList.add('loading'); }
      try {
        const { result } = await postJson(`${this.src}/actions/${encodeURIComponent(action.id)}`, { key: this.key, ...body });
        s.form = null;
        s.last = '';
        await this.refresh();
        if (result && result.message) this._note(result.message);
        if (result && typeof result.download === 'string' && result.download.startsWith('/')) download(result.download);
        this.dispatchEvent(new CustomEvent('v-changed', { bubbles: true, detail: { action: action.id } }));
      } catch (err) {
        this._note(err.message, true);
      } finally {
        s.busy = false;
        if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('loading'); }
      }
    }

    // сообщение — в колонке, где нажали
    _note(text, bad = false) {
      const col = (this._s.col && this.querySelector(`[data-vx-col="${CSS.escape(this._s.col)}"]`)) || this.querySelector('.vx-col--res');
      const el = col && col.querySelector('.vx-msg');
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('vx-msg--err', bad);
    }
  }

  function facts(list) {
    return list.length
      ? `<ul class="vx-facts">${list.map((f) => `<li><span>${escapeHtml(f.label)}</span> <b>${escapeHtml(f.value)}</b></li>`).join('')}</ul>` : '';
  }

  function plural(n, [one, few, many]) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function download(href) {
    const a = document.createElement('a');
    a.href = href;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  customElements.define('v-extract', VExtract);
})();
