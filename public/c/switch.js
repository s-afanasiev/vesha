// v-switch@1 — складской рендерер контракта switch@1 (docs/ui-components.md §2в):
// тумблер на несколько положений с фразами-пояснениями и кнопкой-призывом.
// Монтирование: <v-switch src="/api/<ns>/c/<id>" data-poll="8000"></v-switch>
// (+ /c/ui.js, /c/switch.css). Домен может спросить вместо запрета: ответ { confirm }
// — предупреждение показывается тут же с «Да» / «Отмена», «Да» повторяет смену с
// confirm: true. После смены — событие v-changed (всплывает): соседние блоки страницы
// перечитываются (boot@1). Методы: refresh().
(() => {
  'use strict';
  const { escapeHtml, getJson, postJson } = window.VeshaUI;
  const SUPPORTED = 'switch@1';

  class VSwitch extends HTMLElement {
    connectedCallback() {
      if (this._s) return;
      this._s = { meta: null, state: null, seq: 0, ask: null, busy: false, last: '' };
      this.addEventListener('click', (e) => this._onClick(e));
      this._boot();
    }

    get src() { return this.getAttribute('src'); }
    get pollMs() { return Number(this.getAttribute('data-poll')) || 0; }

    async _boot() {
      this.innerHTML = '<div class="vsw-msg">загрузка…</div>';
      try {
        const meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
        this._s.meta = meta;
      } catch (e) {
        this.innerHTML = `<div class="vsw-msg vsw-msg--err">${escapeHtml(e.message)}</div>`;
        return;
      }
      await this.refresh();
      this._schedulePoll();
    }

    refresh() {
      const s = this._s;
      if (!s || !s.meta) return Promise.resolve();
      const seq = ++s.seq;
      return getJson(`${this.src}/state`)
        .then((state) => {
          if (seq !== s.seq) return;
          const json = JSON.stringify(state);
          if (json === s.last && this.querySelector('.vsw')) return; // ничего не поменялось
          s.last = json;
          s.state = state;
          this._render();
        })
        .catch((e) => { if (seq === s.seq) this._note(e.message, true); });
    }

    _schedulePoll() {
      if (!this.pollMs) return;
      setTimeout(() => {
        if (!document.hidden && this.isConnected && !this._s.ask && !this._s.busy) this.refresh();
        this._schedulePoll();
      }, this.pollMs);
    }

    _render() {
      const { meta, state, ask } = this._s;
      const opts = state.options.map((o) => `
        <button type="button" class="vsw-opt" role="radio" aria-checked="${o.value === state.value}" data-value="${escapeHtml(o.value)}">
          <span class="vsw-name">${escapeHtml(o.name)}</span>
          ${o.note ? `<span class="vsw-note">${escapeHtml(o.note)}</span>` : ''}
        </button>`).join('');
      const lines = (state.lines || []).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
      const cta = state.cta && state.cta.value !== state.value
        ? `<button type="button" class="vsw-btn vsw-btn--cta" data-value="${escapeHtml(state.cta.value)}">${escapeHtml(state.cta.name)}</button>` : '';
      this.innerHTML = `
        <div class="vsw">
          ${meta.title || state.hint ? `<div class="vsw-head">
            ${meta.title ? `<strong class="vsw-title">${escapeHtml(meta.title)}</strong>` : ''}
            ${state.hint ? `<span class="vsw-hint">${escapeHtml(state.hint)}</span>` : ''}
          </div>` : ''}
          ${lines ? `<ul class="vsw-lines">${lines}</ul>` : ''}
          <div class="vsw-seg" role="radiogroup" aria-label="${escapeHtml(meta.title || 'Положение')}">${opts}</div>
          ${ask ? `<div class="vsw-ask" role="alertdialog" aria-live="assertive">
            <p>${escapeHtml(ask.text)}</p>
            <button type="button" class="vsw-btn vsw-btn--cta" data-vsw="yes">Да, включить</button>
            <button type="button" class="vsw-btn" data-vsw="no">Отмена</button>
          </div>` : ''}
          ${cta && !ask ? `<div class="vsw-cta">${cta}</div>` : ''}
          <div class="vsw-msg" role="status"></div>
        </div>`;
    }

    _onClick(e) {
      const s = this._s;
      const t = e.target.closest('[data-value], [data-vsw]');
      if (!t || !this.contains(t) || s.busy) return;
      if (t.dataset.vsw === 'no') { s.ask = null; return this._render(); }
      if (t.dataset.vsw === 'yes') return void this._set(s.ask.value, true);
      if (t.dataset.value === s.state.value) return;
      void this._set(t.dataset.value, false);
    }

    async _set(value, confirm) {
      const s = this._s;
      s.busy = true;
      for (const b of this.querySelectorAll('button')) b.disabled = true;
      try {
        const { result } = await postJson(`${this.src}/set`, { value, confirm });
        if (result.confirm) {
          s.ask = { value, text: result.confirm };
          this._render();
          return;
        }
        s.ask = null;
        s.last = '';
        await this.refresh();
        if (result.message) this._note(result.message);
        this.dispatchEvent(new CustomEvent('v-changed', { bubbles: true, detail: { value } }));
      } catch (err) {
        s.ask = null;
        this._render();
        this._note(err.message, true);
      } finally {
        s.busy = false;
        for (const b of this.querySelectorAll('button')) b.disabled = false;
      }
    }

    _note(text, bad = false) {
      const el = this.querySelector('.vsw-msg');
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('vsw-msg--err', bad);
    }
  }

  customElements.define('v-switch', VSwitch);
})();
