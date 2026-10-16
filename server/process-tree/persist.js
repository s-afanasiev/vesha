// Мост вех дерева процессов в базу (docs/automation-leads-architecture.md, шаг 2):
// прогоны переживают рестарт. Хранилище остаётся в памяти — оно быстрое и
// синхронное для шагов; мост подписан на его события и пишет снимки узлов
// пачкой раз в flushMs (последний снимок узла побеждает, порядок записей не важен).
// При старте мост читает прошлые прогоны и отдаёт их хранилищу (restore):
// незакрытые узлы закрываются исходом interrupted.
//
// Сбой базы — не сбой прогона (П24): дерево живёт в памяти, мост ругается в лог
// и повторяет запись следующим тактом. Пока база не готова (миграции), мост
// только копит снимки — по одному на узел, не больше дерева.
// Словарный греп (П9): доменных слов нет.

class TreeLog {
  constructor(rows, { tree, flushMs = 500, ready = Promise.resolve(), batch = 500, log = console } = {}) {
    if (!tree) throw new Error('TreeLog: нужно имя дерева');
    this.rows = rows;
    this.tree = tree;
    this.flushMs = flushMs;
    this.ready = ready;
    this.batch = batch;
    this.log = log;
    this.dirty = new Map();
    this.timer = null;
    this.flushing = null;
    this.isReady = false;
    this.restored = false;
    this.lastError = null;
  }

  // Подписаться сразу (ни одна веха не потеряется), прошлые прогоны — когда база готова.
  attach(store) {
    this.store = store;
    store.subscribe(({ node }) => this.mark(node));
    // узлы, родившиеся до моста, тоже уходят в базу — иначе ребёнок без корня
    for (const rootId of store.rootIds()) {
      for (const node of store.nodesOf(rootId)) this.dirty.set(node.nodeId, node);
    }
    this.loaded = (async () => {
      await this.ready;
      this.isReady = true;
      const nodes = await this.rows.load(this.tree);
      for (const node of store.restore(nodes)) this.dirty.set(node.nodeId, node);
      this.restored = true;
      this.schedule();
    })().catch((err) => this.warn(`прошлые прогоны не восстановлены — ${err.message}`));
    return this.loaded;
  }

  mark(node) {
    this.dirty.set(node.nodeId, node);
    this.schedule();
  }

  schedule() {
    if (this.timer || !this.isReady || !this.dirty.size) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushMs);
    if (this.timer.unref) this.timer.unref();
  }

  // Записать всё, что накопилось; одна запись за раз. Для тестов и остановки (П20).
  async flush() {
    if (this.flushing) await this.flushing;
    if (!this.isReady) return;
    this.flushing = this._flush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async _flush() {
    const nodes = [...this.dirty.values()];
    this.dirty.clear();
    try {
      for (let i = 0; i < nodes.length; i += this.batch) {
        await this.rows.save(this.tree, nodes.slice(i, i + this.batch));
      }
      // выселенные хранилищем прогоны уходят и из базы — но только после
      // восстановления, иначе стёрли бы прошлое, которое ещё не прочитано
      if (this.restored && this.store) await this.rows.prune(this.tree, this.store.rootIds());
      this.lastError = null;
    } catch (err) {
      for (const node of nodes) if (!this.dirty.has(node.nodeId)) this.dirty.set(node.nodeId, node);
      this.warn(`вехи не записаны — ${err.message}`);
    }
    this.schedule();
  }

  warn(message) {
    if (message === this.lastError) return;
    this.lastError = message;
    this.log.warn(`process-tree ${this.tree}: ${message}`);
  }
}

// Строки в Postgres (таблица process_tree_nodes, миграция 021): снимок узла
// целиком в jsonb, пачка — одним запросом.
class PgTreeRows {
  constructor(db) {
    this.db = db;
  }

  async load(tree) {
    const { rows } = await this.db.query(
      'SELECT node FROM process_tree_nodes WHERE tree = $1 ORDER BY created_at',
      [tree]
    );
    return rows.map((r) => r.node);
  }

  async save(tree, nodes) {
    await this.db.query(
      `INSERT INTO process_tree_nodes (node_id, tree, root_id, parent_id, node, created_at, updated_at)
       SELECT (n->>'nodeId')::uuid, $1, (n->>'rootId')::uuid, (n->>'parentNodeId')::uuid, n,
              (n->>'createdAt')::timestamptz, (n->>'updatedAt')::timestamptz
       FROM jsonb_array_elements($2::jsonb) AS n
       ON CONFLICT (node_id) DO UPDATE SET node = EXCLUDED.node, updated_at = EXCLUDED.updated_at`,
      [tree, JSON.stringify(nodes)]
    );
  }

  async prune(tree, keepRootIds) {
    await this.db.query(
      'DELETE FROM process_tree_nodes WHERE tree = $1 AND NOT (root_id = ANY($2::uuid[]))',
      [tree, keepRootIds]
    );
  }
}

// Честный простой узел (О6): те же строки в памяти — для тестов рестарта.
class MemoryTreeRows {
  constructor() {
    this.trees = new Map();
  }

  rowsOf(tree) {
    if (!this.trees.has(tree)) this.trees.set(tree, new Map());
    return this.trees.get(tree);
  }

  async load(tree) {
    return [...this.rowsOf(tree).values()].map((n) => JSON.parse(JSON.stringify(n)));
  }

  async save(tree, nodes) {
    for (const n of nodes) this.rowsOf(tree).set(n.nodeId, JSON.parse(JSON.stringify(n)));
  }

  async prune(tree, keepRootIds) {
    const keep = new Set(keepRootIds);
    for (const [id, n] of this.rowsOf(tree)) if (!keep.has(n.rootId)) this.rowsOf(tree).delete(id);
  }
}

module.exports = { TreeLog, PgTreeRows, MemoryTreeRows };
