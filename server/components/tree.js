// Каркас контракта tree@1 (docs/ui-components.md §2б): зеркало дерева процессов
// (docs/process-tree-ui-canon.md). Домен объявляет экземпляр Tree({ store }) —
// хранилище process-tree и подписи видов узлов; каркас конструирует /meta
// /roots /tree. Только чтение (П14): запуск и остановка — доменные ручки.
// Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET /meta                         → заголовок, подписи видов узлов (labels)
//   GET /roots                        → { ok, version, roots } — прогоны, новые первыми
//   GET /tree?root=<id|latest>&since= → { ok, version, unchanged: true }, если с
//                                       версии since ничего не менялось, иначе
//                                       { ok, version, rootId, tree } (tree = null — прогонов нет)

const express = require('express');
const { projectTree, projectRoot } = require('../process-tree/projection');

function Tree(decl) {
  return { kind: 'tree', version: 1, ...decl };
}

function router(decl) {
  const r = express.Router();
  const store = decl.store;
  if (!store) throw new Error('Tree: нужен store');

  r.get('/meta', (_req, res) => {
    res.json({ ok: true, kind: 'tree', version: 1, title: decl.title || '', labels: decl.labels || {} });
  });

  r.get('/roots', (_req, res) => {
    res.json({ ok: true, version: store.version, roots: store.roots().map(projectRoot) });
  });

  r.get('/tree', (req, res) => {
    const since = Number(req.query.since);
    if (Number.isFinite(since) && since === store.version) {
      return res.json({ ok: true, version: store.version, unchanged: true });
    }
    const wanted = String(req.query.root || 'latest');
    const roots = store.roots();
    const root = wanted === 'latest' ? roots[0] : roots.find((n) => n.nodeId === wanted);
    if (!root) return res.json({ ok: true, version: store.version, rootId: null, tree: null });
    res.json({
      ok: true,
      version: store.version,
      rootId: root.nodeId,
      tree: projectTree(store.nodesOf(root.nodeId), root.nodeId),
    });
  });

  return r;
}

module.exports = { Tree, router };
