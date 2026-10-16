// v-stages@1 — складской рендерер контракта stages@1 (docs/ui-components.md §2а):
// путь одной карточки во времени, «упрощённый канбан» — окно статуса.
// Монтирование: <v-stages src="/api/<ns>/c/<id>" key="<ключ>" data-poll="5000"></v-stages>
// (+ /c/ui.js, /c/stages.css). data-compact — без заголовка (внутри подробностей
// карточки <v-kanban>, где заголовок уже есть). Шаги: пройдено — с датой,
// сейчас — выделено (с пометкой вроде «ждём до 20.10»), впереди — приглушено;
// выход (отказ с причиной) — отдельной плашкой. Только чтение.
// Методы: refresh().
(() => {
  'use strict';
  const { escapeHtml, getJson } = window.VeshaUI;
  const SUPPORTED = 'stages@1';

  class VStages extends HTMLElement {
    connectedCallback() {
      // элемент переносят между перерисовками родителя — второй раз не грузимся
      if (this._s) return;
      this._s = { meta: null, seq: 0 };
      this._boot();
    }

    get src() { return this.getAttribute('src'); }
    get key() { return this.getAttribute('key') || ''; }
    get pollMs() { return Number(this.getAttribute('data-poll')) || 0; }
    get compact() { return this.hasAttribute('data-compact'); }

    async _boot() {
      this.innerHTML = '<div class="vs-msg">загрузка…</div>';
      try {
        const meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
        this._s.meta = meta;
      } catch (e) {
        this._error(e.message);
        return;
      }
      await this.refresh();
      this._schedulePoll();
    }

    refresh() {
      if (!this._s || !this._s.meta) return Promise.resolve();
      if (!this.key) {
        this._error('не указано, чей путь показать');
        return Promise.resolve();
      }
      const seq = ++this._s.seq;
      return getJson(`${this.src}/path?key=${encodeURIComponent(this.key)}`)
        .then((view) => { if (seq === this._s.seq) this._render(view); })
        .catch((e) => { if (seq === this._s.seq) this._error(e.message); });
    }

    _schedulePoll() {
      const ms = this.pollMs;
      if (!ms) return;
      setTimeout(() => {
        if (!document.hidden && this.isConnected) this.refresh();
        this._schedulePoll();
      }, ms);
    }

    _error(msg) {
      this.innerHTML = `<div class="vs-msg vs-msg--err">${escapeHtml(msg)}</div>`;
    }

    _render(view) {
      const head = this.compact ? '' : `
        <div class="vs-head">
          <strong class="vs-title">${escapeHtml(view.title || '')}</strong>
          ${view.subtitle ? `<span class="vs-sub">${escapeHtml(view.subtitle)}</span>` : ''}
        </div>`;
      const steps = (view.steps || []).map((step, i) => `
        <li class="vs-step vs-step--${escapeHtml(step.state)}"${step.state === 'current' ? ' aria-current="step"' : ''}>
          <span class="vs-dot">${step.state === 'done' ? '✓' : i + 1}</span>
          <span class="vs-name">${escapeHtml(step.name)}</span>
          ${step.at ? `<time class="vs-at">${escapeHtml(fmtDay(step.at))}</time>` : ''}
          ${step.note ? `<span class="vs-note">${escapeHtml(step.note)}</span>` : ''}
        </li>`).join('');
      const exit = view.exit ? `
        <div class="vs-exit vs-exit--${escapeHtml(view.exit.tone || 'refused')}">
          <strong>${escapeHtml(view.exit.name)}${view.exit.reason ? ':' : ''}</strong>
          ${view.exit.reason ? `<span>${escapeHtml(view.exit.reason)}</span>` : ''}
          ${view.exit.at ? `<time class="vs-at">${escapeHtml(fmtDay(view.exit.at))}</time>` : ''}
        </div>` : '';
      this.innerHTML = `${head}<ol class="vs-steps">${steps}</ol>${exit}`;
    }
  }

  function fmtDay(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  customElements.define('v-stages', VStages);
})();
