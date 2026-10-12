// Дерево процессов — каркас наблюдаемости (docs/process-tree-ui-canon.md, П25).
// Узел регистрирует себя в общем хранилище со ссылкой на смыслового родителя;
// дерево собирает проекция по parentNodeId, а не пересылка событий вверх.
//
// Поправки к канону (13.10.2026):
// - статусы с именованными исходами — waiting, skipped, cancelled (П38);
//   исход на границе узла — { ok, code, detail } (П24);
// - узел едет в контексте запуска ctx.node (П37): доменный шаг зовёт
//   ctx.node.step(...) и не знает хранилища (П7);
// - терминальный статус окончателен: поздние вызовы — no-op;
// - payload уходит в UI как есть, поэтому ключи с секретами режутся на входе.
// Словарный греп (П9): доменных слов нет.

const crypto = require('node:crypto');

const STATUSES = ['created', 'running', 'waiting', 'completed', 'skipped', 'failed', 'cancelled'];
const TERMINAL = new Set(['completed', 'skipped', 'failed', 'cancelled']);
const SECRET_KEY = /(api_?key|token|secret|password|authorization)/i;

function cleanPayload(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    out[k] = SECRET_KEY.test(k) ? '[скрыто]' : v;
  }
  return out;
}

class ProcessTreeStore {
  constructor({ keepRoots = 20, maxNodesPerRoot = 5000, clock = () => new Date() } = {}) {
    this.keepRoots = keepRoots;
    this.maxNodesPerRoot = maxNodesPerRoot;
    this.clock = clock;
    this.nodes = new Map();
    this.rootOrder = [];
    this.countByRoot = new Map();
    this.listeners = new Set();
    this.version = 0;
  }

  createNode({ parent = null, nodeType, title, payload } = {}) {
    if (!nodeType) throw new Error('process-tree: нужен nodeType');
    const parentNode = parent ? this.nodes.get(parent.id || parent) : null;
    if (parent && !parentNode) return DETACHED;
    const rootId = parentNode ? parentNode.rootId : null;
    if (rootId && this.countByRoot.get(rootId) >= this.maxNodesPerRoot) {
      // потолок узлов: дальше дерево не растёт, корень знает, сколько отброшено
      const root = this.nodes.get(rootId);
      root.overflow = (root.overflow || 0) + 1;
      return DETACHED;
    }
    const now = this.clock().toISOString();
    const nodeId = crypto.randomUUID();
    const node = {
      nodeId,
      parentNodeId: parentNode ? parentNode.nodeId : null,
      rootId: rootId || nodeId,
      nodeType,
      title: title || nodeType,
      status: 'created',
      payload: cleanPayload(payload),
      outcome: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      updateCount: 0,
    };
    this.nodes.set(nodeId, node);
    if (!parentNode) {
      this.rootOrder.push(nodeId);
      this.countByRoot.set(nodeId, 1);
      this._evict();
    } else {
      this.countByRoot.set(node.rootId, this.countByRoot.get(node.rootId) + 1);
    }
    this._emit('create', node);
    return new ProcessNode(this, nodeId);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  roots() {
    return [...this.rootOrder].reverse().map((id) => snapshot(this.nodes.get(id)));
  }

  nodesOf(rootId) {
    const out = [];
    for (const node of this.nodes.values()) {
      if (node.rootId === rootId) out.push(snapshot(node));
    }
    return out;
  }

  _mutate(nodeId, change) {
    const node = this.nodes.get(nodeId);
    if (!node || TERMINAL.has(node.status)) return false;
    const now = this.clock().toISOString();
    if (change.payload) node.payload = { ...node.payload, ...cleanPayload(change.payload) };
    if (change.status) {
      if (change.status === 'running' && !node.startedAt) node.startedAt = now;
      if (TERMINAL.has(change.status)) node.finishedAt = now;
      node.status = change.status;
    }
    if (change.outcome !== undefined) node.outcome = change.outcome;
    node.updateCount += 1;
    node.updatedAt = now;
    this._emit('update', node);
    return true;
  }

  // Старые завершённые прогоны уходят целиком; идущие не трогаем.
  _evict() {
    while (this.rootOrder.length > this.keepRoots) {
      const victim = this.rootOrder.find((id) => TERMINAL.has(this.nodes.get(id).status));
      if (!victim) return;
      this.rootOrder.splice(this.rootOrder.indexOf(victim), 1);
      this.countByRoot.delete(victim);
      for (const [id, node] of this.nodes) {
        if (node.rootId === victim) this.nodes.delete(id);
      }
    }
  }

  _emit(type, node) {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener({ type, node: snapshot(node) });
      } catch (err) {
        console.warn('process-tree listener:', err.message);
      }
    }
  }
}

// Handle узла: единственный путь, которым шаг сообщает о себе (канон §3.2).
class ProcessNode {
  constructor(store, nodeId) {
    this.store = store;
    this.id = nodeId;
  }

  get status() {
    const node = this.store.nodes.get(this.id);
    return node ? node.status : 'created';
  }

  get isTerminal() {
    return TERMINAL.has(this.status);
  }

  child({ nodeType, title, payload } = {}) {
    return this.store.createNode({ parent: this.id, nodeType, title, payload });
  }

  start(payload) {
    return this.store._mutate(this.id, { status: 'running', payload });
  }

  update(payload) {
    return this.store._mutate(this.id, { payload });
  }

  wait(detail, payload) {
    return this.store._mutate(this.id, { status: 'waiting', payload, outcome: { ok: true, code: 'waiting', detail } });
  }

  complete(payload) {
    return this.store._mutate(this.id, { status: 'completed', payload, outcome: { ok: true } });
  }

  skip(code, detail, payload) {
    return this.store._mutate(this.id, { status: 'skipped', payload, outcome: { ok: true, code, detail } });
  }

  fail(error, payload) {
    const code = (error && error.code) || 'error';
    const detail = (error && error.message) || String(error);
    return this.store._mutate(this.id, { status: 'failed', payload, outcome: { ok: false, code, detail } });
  }

  cancel(detail = 'остановлено', payload) {
    return this.store._mutate(this.id, { status: 'cancelled', payload, outcome: { ok: false, code: 'cancelled', detail } });
  }

  // Шаг-ребёнок: узел открывает обёртка, а не сам шаг. Не закрытый работой
  // узел закрывается по её возврату; исключение — fail и летит дальше: где
  // ошибка становится результатом, решает вызывающий (П24).
  async step({ nodeType, title, payload } = {}, work) {
    const node = this.child({ nodeType, title, payload });
    node.start();
    try {
      const result = await work(node);
      if (!node.isTerminal) node.complete();
      return result;
    } catch (err) {
      if (err && err.name === 'AbortError') node.cancel();
      else node.fail(err);
      throw err;
    }
  }
}

// Узел за потолком или без родителя: принимает вызовы и ничего не пишет.
const DETACHED = {
  id: null,
  status: 'created',
  isTerminal: false,
  child: () => DETACHED,
  start: () => false,
  update: () => false,
  wait: () => false,
  complete: () => false,
  skip: () => false,
  fail: () => false,
  cancel: () => false,
  step: async (_spec, work) => work(DETACHED),
};

function snapshot(node) {
  return { ...node, payload: { ...node.payload }, outcome: node.outcome ? { ...node.outcome } : null };
}

module.exports = { ProcessTreeStore, ProcessNode, STATUSES, TERMINAL };
