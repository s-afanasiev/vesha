// v-tree@1 — складской рендерер контракта tree@1 (docs/ui-components.md §2б):
// скин по умолчанию для дерева процессов (docs/process-tree-ui-canon.md §5.1).
// Монтирование: <v-tree src="/api/<ns>/c/<id>" data-poll="1000"></v-tree>
// (+ /c/ui.js, /c/tree.css). Новый вид узла виден сразу, без фронтенд-кода:
// статус, вид (подпись из /meta labels), title, payload.summary, счётчики детей
// по статусам — они же фильтр, свёртка отрицательных исходов глубже по виду
// узла, время шага, инспектор payload и исхода.
// Большие группы детей свёрнуты и раскрываются порциями. Опрос — рекурсивный
// setTimeout с ?since=version: без изменений сервер отвечает unchanged.
// События: v-tree-update {tree}. Метод: refresh().
// Аномалия на экране — гипотеза о дефекте эмиттера, а не повод для вёрстки (канон §4.4).
(() => {
  'use strict';
  const { escapeHtml, getJson } = window.VeshaUI;
  const SUPPORTED = 'tree@1';
  const STATUS = {
    created: { label: 'ждёт', mark: '○' },
    running: { label: 'идёт', mark: '●' },
    waiting: { label: 'ожидание', mark: '◷' },
    completed: { label: 'готово', mark: '✓' },
    skipped: { label: 'пропущено', mark: '⤼' },
    failed: { label: 'ошибка', mark: '✗' },
    cancelled: { label: 'остановлено', mark: '■' },
  };
  const ORDER = ['running', 'waiting', 'created', 'completed', 'skipped', 'failed', 'cancelled'];
  const NOTABLE = ['waiting', 'skipped', 'failed', 'cancelled'];
  const BIG_GROUP = 12;
  const PORTION = 50;

  class VTree extends HTMLElement {

    connectedCallback() {
      if (this._s) return;
      this._s = {
        meta: null, roots: [], tree: null, version: null, rootsVersion: null,
        pick: '', open: new Map(), inspect: new Set(), filter: new Map(), shown: new Map(), seq: 0,
      };
      this.addEventListener('click', (e) => this._onClick(e));
      this.addEventListener('change', (e) => this._onChange(e));
      this._boot();
    }

    get src() { return this.getAttribute('src'); }
    get pollMs() { return Number(this.getAttribute('data-poll')) || 0; }

    async _boot() {
      this.innerHTML = '<div class="vtr-msg">загрузка…</div>';
      try {
        const meta = await getJson(`${this.src}/meta`);
        const id = `${meta.kind}@${meta.version}`;
        if (id !== SUPPORTED) throw new Error(`рендерер понимает ${SUPPORTED}, сервер отдаёт ${id}`);
        this._s.meta = meta;
      } catch (e) {
        this.innerHTML = `<div class="vtr-msg vtr-msg--err">${escapeHtml(e.message)}</div>`;
        return;
      }
      this.innerHTML = `
        <div class="vtr-wrap">
          <div class="vtr-bar">
            <select class="vtr-roots" aria-label="Прогон"></select>
            <span class="vtr-status" role="status"></span>
          </div>
          <div class="vtr-body"></div>
        </div>`;
      this._els = {
        roots: this.querySelector('.vtr-roots'),
        status: this.querySelector('.vtr-status'),
        body: this.querySelector('.vtr-body'),
      };
      await this.refresh();
      this._schedulePoll();
    }

    async refresh() {
      const s = this._s;
      if (!s.meta) return;
      const seq = ++s.seq;
      const qs = new URLSearchParams({ root: s.pick || 'latest' });
      if (s.version != null) qs.set('since', s.version);
      try {
        const data = await getJson(`${this.src}/tree?${qs}`);
        if (seq !== s.seq || data.unchanged) return;
        s.version = data.version;
        s.tree = data.tree;
        if (s.rootsVersion !== data.version) {
          const r = await getJson(`${this.src}/roots`);
          s.roots = r.roots || [];
          s.rootsVersion = data.version;
          this._renderRoots();
        }
        this._renderTree();
        this._els.status.textContent = '';
        this.dispatchEvent(new CustomEvent('v-tree-update', { detail: { tree: s.tree } }));
      } catch (e) {
        if (seq === s.seq) this._els.status.textContent = e.message;
      }
    }

    _schedulePoll() {
      const ms = this.pollMs;
      if (!ms) return;
      setTimeout(() => {
        if (!document.hidden) this.refresh();
        this._schedulePoll();
      }, ms);
    }

    // ---------- события (делегирование) ----------

    _onClick(e) {
      const s = this._s;
      const t = e.target.closest('[data-vtr-toggle], [data-vtr-inspect], [data-vtr-filter], [data-vtr-more]');
      if (!t || !this.contains(t)) return;
      const id = t.closest('.vtr-node') && t.closest('.vtr-node').dataset.id;
      if (!id) return;
      if (t.dataset.vtrInspect != null) {
        if (s.inspect.has(id)) s.inspect.delete(id); else s.inspect.add(id);
      } else if (t.dataset.vtrFilter) {
        const status = t.dataset.vtrFilter;
        if (s.filter.get(id) === status) s.filter.delete(id); else s.filter.set(id, status);
        s.open.set(id, true);
        s.shown.delete(id);
      } else if (t.dataset.vtrMore != null) {
        s.shown.set(id, (s.shown.get(id) || PORTION) + PORTION);
      } else {
        const node = findNode(s.tree, id);
        if (!node || !node.hasChildren) {
          if (s.inspect.has(id)) s.inspect.delete(id); else s.inspect.add(id);
        } else {
          s.open.set(id, !this._isOpen(node));
        }
      }
      this._renderTree();
    }

    _onChange(e) {
      if (!e.target.classList.contains('vtr-roots')) return;
      this._s.pick = e.target.value;
      this._s.version = null;
      this.refresh();
    }

    // ---------- рендеры ----------

    _renderRoots() {
      const s = this._s;
      const opts = s.roots.map((r) => {
        const st = STATUS[r.status] || STATUS.created;
        const when = r.createdAt ? new Date(r.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
        return `<option value="${escapeHtml(r.nodeId)}"${r.nodeId === s.pick ? ' selected' : ''}>${escapeHtml(`${r.title} · ${st.label} · ${when}`)}</option>`;
      }).join('');
      this._els.roots.innerHTML = `<option value=""${s.pick ? '' : ' selected'}>последний прогон</option>${opts}`;
      this._els.roots.hidden = s.roots.length === 0;
    }

    _renderTree() {
      const s = this._s;
      if (!s.tree) {
        this._els.body.innerHTML = '<div class="vtr-msg">Прогонов пока нет</div>';
        return;
      }
      this._els.body.innerHTML = this._nodeHtml(s.tree);
    }

    _isOpen(node) {
      const s = this._s;
      if (s.open.has(node.nodeId)) return s.open.get(node.nodeId);
      if (node.depth === 0) return true;
      return node.depth === 1 && node.children.length <= BIG_GROUP;
    }

    _nodeHtml(node) {
      const s = this._s;
      const st = STATUS[node.status] || STATUS.created;
      const label = (s.meta.labels && s.meta.labels[node.nodeType]) || node.nodeType;
      const summary = node.payload && node.payload.summary != null
        ? node.payload.summary
        : (node.outcome && node.outcome.detail) || '';
      const open = node.hasChildren && this._isOpen(node);
      const caret = node.hasChildren ? (open ? '▾' : '▸') : '·';
      const chips = node.hasChildren ? this._chipsHtml(node) : '';
      const time = duration(node);
      const inspect = s.inspect.has(node.nodeId)
        ? `<pre class="vtr-payload">${escapeHtml(JSON.stringify({ payload: node.payload, outcome: node.outcome }, null, 2))}</pre>`
        : '';
      let kids = '';
      if (open) {
        const want = s.filter.get(node.nodeId);
        const list = want ? node.children.filter((c) => c.status === want) : node.children;
        const limit = s.shown.get(node.nodeId) || PORTION;
        const rest = list.length - limit;
        kids = `<div class="vtr-children">
            ${list.slice(0, limit).map((c) => this._nodeHtml(c)).join('')}
            ${rest > 0 ? `<button type="button" class="vtr-more" data-vtr-more>ещё ${rest}</button>` : ''}
          </div>`;
      }
      return `
        <div class="vtr-node vtr--${escapeHtml(node.statusTone)}" data-id="${escapeHtml(node.nodeId)}">
          <div class="vtr-row" data-vtr-toggle>
            <span class="vtr-caret" aria-hidden="true">${caret}</span>
            <span class="vtr-pill" title="${escapeHtml(node.status)}">${st.mark} ${escapeHtml(st.label)}</span>
            <span class="vtr-type">${escapeHtml(label)}</span>
            <span class="vtr-title">${escapeHtml(node.title)}</span>
            ${summary ? `<span class="vtr-summary">${escapeHtml(summary)}</span>` : ''}
            ${chips}
            ${this._deepHtml(node)}
            ${node.overflow ? `<span class="vtr-warn">+${escapeHtml(node.overflow)} узлов за потолком</span>` : ''}
            ${time ? `<span class="vtr-time">${escapeHtml(time)}</span>` : ''}
            <button type="button" class="vtr-inspect" data-vtr-inspect title="payload и исход" aria-label="Подробности узла">{ }</button>
          </div>
          ${inspect}
          ${kids}
        </div>`;
    }

    // Свёртка глубины: отрицательные исходы внуков и глубже по виду узла —
    // «сайт: ⤼ 68» видно у группы, не раскрывая каждое место.
    _deepHtml(node) {
      const labels = this._s.meta.labels || {};
      const parts = [];
      for (const [type, byStatus] of Object.entries(node.deep || {})) {
        const marks = NOTABLE.filter((k) => byStatus[k]).map((k) => `${STATUS[k].mark} ${byStatus[k]}`);
        if (marks.length) parts.push(`${labels[type] || type}: ${marks.join(' ')}`);
      }
      return parts.length ? `<span class="vtr-deep" title="исходы глубже по виду узла">${escapeHtml(parts.join(' · '))}</span>` : '';
    }

    _chipsHtml(node) {
      const want = this._s.filter.get(node.nodeId);
      const chips = ORDER.filter((k) => node.stats[k]).map((k) => {
        const st = STATUS[k];
        return `<button type="button" class="vtr-chip vtr-chip--${k}${want === k ? ' is-on' : ''}" data-vtr-filter="${k}" title="${escapeHtml(st.label)}: показать только их">${st.mark} ${node.stats[k]}</button>`;
      }).join('');
      return `<span class="vtr-chips">${chips}</span>`;
    }
  }

  function findNode(node, id) {
    if (!node) return null;
    if (node.nodeId === id) return node;
    for (const kid of node.children || []) {
      const hit = findNode(kid, id);
      if (hit) return hit;
    }
    return null;
  }

  function duration(node) {
    if (!node.startedAt) return '';
    const end = node.finishedAt ? new Date(node.finishedAt) : new Date();
    const ms = end - new Date(node.startedAt);
    if (ms < 1000) return `${ms} мс`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} с`;
    return `${Math.floor(ms / 60000)} мин ${Math.round((ms % 60000) / 1000)} с`;
  }

  customElements.define('v-tree', VTree);
})();
