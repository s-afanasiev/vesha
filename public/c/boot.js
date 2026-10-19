// boot@1 — сборка служебной страницы из спеки (docs/ui-components.md §5).
// Спека: GET <spec-url> → {kind:'page', version:1, title, subtitle?, blocks[]}.
// Блоки: table@1 → <v-table src [poll]>, kanban@1 → <v-kanban src [poll]>,
// tree@1 → <v-tree src [poll]>, stages@1 → <v-stages src key [poll]> (key — из
// ?<param> адреса страницы), switch@1 → <v-switch src [poll]>, extract@1 →
// <v-extract src key [poll]> (key — как у stages@1); title блока — заголовок секции над ним.
// Неизвестный блок — честная плашка на странице, а не молчаливый пропуск
// (контракт проверяют при сборке, П8). Гость видит ошибку API как есть —
// настоящая граница доступа на сервере, не здесь.
(() => {
  'use strict';

  function el(tag, attrs) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
    return node;
  }

  const MOUNT = {
    'table@1': (b) => el('v-table', { src: b.src, 'data-poll': b.poll }),
    'kanban@1': (b) => el('v-kanban', { src: b.src, 'data-poll': b.poll }),
    'tree@1': (b) => el('v-tree', { src: b.src, 'data-poll': b.poll }),
    // ключ пути — из адреса страницы: ?<param>=… (окно статуса по ссылке)
    'stages@1': (b) => el('v-stages', {
      src: b.src,
      key: new URLSearchParams(location.search).get(b.param || 'key'),
      'data-poll': b.poll,
    }),
    'switch@1': (b) => el('v-switch', { src: b.src, 'data-poll': b.poll }),
    // ключ разбора — из адреса страницы, как у stages@1 (карточка по ссылке из таблицы)
    'extract@1': (b) => el('v-extract', {
      src: b.src,
      key: new URLSearchParams(location.search).get(b.param || 'key'),
      'data-poll': b.poll,
    }),
  };

  async function boot(specUrl) {
    const root = document.getElementById('boot-root');
    const esc = window.VeshaUI.escapeHtml;
    if (!specUrl) {
      root.innerHTML = '<div class="boot-error">укажите спеку: /c/page.html?spec=/api/&lt;ns&gt;/c/pages/&lt;имя&gt;</div>';
      return;
    }
    let spec;
    try {
      spec = await window.VeshaUI.getJson(specUrl);
      const id = `${spec.kind}@${spec.version}`;
      if (id !== 'page@1') throw new Error(`boot@1 понимает page@1, сервер отдаёт ${id}`);
    } catch (e) {
      root.innerHTML = `<div class="boot-error">${esc(e.message)}</div>`;
      return;
    }
    document.title = spec.title;
    // блок что-то поменял (тумблер, действие разбора) — соседи перечитываются сразу, а не по опросу
    if (!root.dataset.bootWired) {
      root.dataset.bootWired = '1';
      root.addEventListener('v-changed', (e) => {
        for (const node of root.querySelectorAll('v-table, v-kanban, v-tree, v-stages, v-switch, v-extract')) {
          if (node !== e.target && typeof node.refresh === 'function') node.refresh();
        }
      });
    }
    root.innerHTML = `
      <header class="boot-head">
        <h1>${esc(spec.title)}</h1>
        ${spec.subtitle ? `<p>${esc(spec.subtitle)}</p>` : ''}
      </header>`;
    for (const block of spec.blocks || []) {
      const make = MOUNT[block.kind];
      if (!make) {
        const note = document.createElement('div');
        note.className = 'boot-error';
        note.textContent = `блок ${block.kind} — рендерера нет в boot@1`;
        root.appendChild(note);
        continue;
      }
      if (block.title) {
        const head = document.createElement('h2');
        head.className = 'boot-block-title';
        head.textContent = block.title;
        root.appendChild(head);
      }
      root.appendChild(make(block));
    }
  }

  window.VeshaBoot = { boot };
})();
