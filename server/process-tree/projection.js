// Проекция дерева процессов в модель чтения (канон §3.3): process-tree отвечает
// «что произошло», проекция — «как показать». Чистая функция над снимком узлов:
// иерархия, глубина, цепочка родителей, счётчики детей по статусам, тон.
// deep — свёртка внуков и глубже по виду узла и статусу: у группы из 150 мест
// видно «сайт: пропущено 68», не раскрывая каждое место.
// Витрина ничего не пишет и домен ради экрана не ломает (П25, П40).

const DISPLAY = {
  created: { displayStatus: 'pending', statusTone: 'neutral' },
  running: { displayStatus: 'running', statusTone: 'info' },
  waiting: { displayStatus: 'waiting', statusTone: 'warn' },
  completed: { displayStatus: 'success', statusTone: 'positive' },
  skipped: { displayStatus: 'skipped', statusTone: 'muted' },
  failed: { displayStatus: 'danger', statusTone: 'critical' },
  cancelled: { displayStatus: 'cancelled', statusTone: 'muted' },
};

function projectTree(nodes, rootId) {
  const byParent = new Map();
  let root = null;
  for (const node of nodes) {
    if (node.nodeId === rootId) root = node;
    if (!node.parentNodeId) continue;
    if (!byParent.has(node.parentNodeId)) byParent.set(node.parentNodeId, []);
    byParent.get(node.parentNodeId).push(node);
  }
  if (!root) return null;

  // below — все потомки узла по виду и статусу; deep — потомки детей (без самих детей)
  const below = new Map();
  const build = (node, depth, lineage) => {
    const kids = byParent.get(node.nodeId) || [];
    const children = kids.map((kid) => build(kid, depth + 1, [...lineage, node.nodeId]));
    const stats = { total: children.length };
    const deep = {};
    const all = {};
    for (const kid of children) {
      stats[kid.status] = (stats[kid.status] || 0) + 1;
      count(all, kid.nodeType, kid.status, 1);
      for (const [type, byStatus] of Object.entries(below.get(kid.nodeId))) {
        for (const [status, n] of Object.entries(byStatus)) {
          count(deep, type, status, n);
          count(all, type, status, n);
        }
      }
    }
    below.set(node.nodeId, all);
    return {
      ...node,
      ...(DISPLAY[node.status] || DISPLAY.created),
      depth,
      lineage,
      hasChildren: children.length > 0,
      children,
      stats,
      deep,
    };
  };
  return build(root, 0, []);
}

function count(acc, type, status, n) {
  if (!acc[type]) acc[type] = {};
  acc[type][status] = (acc[type][status] || 0) + n;
}

function projectRoot(node) {
  return { ...node, ...(DISPLAY[node.status] || DISPLAY.created) };
}

module.exports = { projectTree, projectRoot, DISPLAY };
