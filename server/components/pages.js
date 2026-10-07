// Реестр спек страниц (docs/ui-components.md §5): домен объявляет
// Pages({ '<имя>': {title, subtitle, blocks:[...]} }) в своей точке сборки,
// каркас отдаёт спеку GET /:name. Сборка экрана — boot@1 на клиенте
// (/c/boot.js на общей странице /c/page.html). Спека — данные: новый
// служебный экран = правка декларации, не код.
// Валидация — при старте сервера (П8: контракт проверяют при сборке, а не на
// первом вызове): блок вне списка известного boot@1 валит запуск.

const express = require('express');

// что умеет монтировать boot@1 на клиенте; новый вид — строка здесь и
// конструктор в MOUNT /c/boot.js
const KNOWN_BLOCKS = new Set(['table@1', 'kanban@1']);

function Pages(declarations) {
  const router = express.Router();
  for (const [name, spec] of Object.entries(declarations || {})) {
    const unknown = (spec.blocks || []).filter((b) => !KNOWN_BLOCKS.has(b.kind));
    if (unknown.length) {
      throw new Error(`Страница "${name}": блоки вне boot@1 — ${unknown.map((b) => b.kind).join(', ')}`);
    }
    router.get(`/${name}`, (_req, res) => {
      res.json({ ok: true, kind: 'page', version: 1, name, ...spec });
    });
  }
  return router;
}

module.exports = { Pages, KNOWN_BLOCKS };
