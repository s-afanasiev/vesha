const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { ProcessTreeStore } = require('../server/process-tree');
const { projectTree } = require('../server/process-tree/projection');
const { Components } = require('../server/components');
const { Tree } = require('../server/components/tree');

test('step opens a child node, closes it on return and keeps a named skip', async () => {
  const store = new ProcessTreeStore();
  const root = store.createNode({ nodeType: 'Run', title: 'прогон' });
  root.start();
  const value = await root.step({ nodeType: 'Step', title: 'шаг' }, async (node) => {
    node.update({ summary: 'идёт' });
    return 42;
  });
  await root.step({ nodeType: 'Site', title: 'сайт' }, async (node) => node.skip('no_site', 'сайта нет'));
  assert.equal(value, 42);
  const [step, site] = store.nodesOf(root.id).filter((n) => n.parentNodeId === root.id);
  assert.equal(step.status, 'completed');
  assert.deepEqual(step.outcome, { ok: true });
  assert.equal(step.payload.summary, 'идёт');
  assert.equal(site.status, 'skipped');
  assert.deepEqual(site.outcome, { ok: true, code: 'no_site', detail: 'сайта нет' });
});

test('terminal status is final and secrets never reach the payload', () => {
  const store = new ProcessTreeStore();
  const node = store.createNode({ nodeType: 'Run', payload: { apiKey: 'sk-1', city: 'Курск' } });
  node.start();
  assert.equal(node.skip('empty', 'пусто'), true);
  assert.equal(node.complete(), false);
  assert.equal(node.fail(new Error('поздно')), false);
  const [raw] = store.nodesOf(node.id);
  assert.equal(raw.status, 'skipped');
  assert.equal(raw.payload.apiKey, '[скрыто]');
  assert.equal(raw.payload.city, 'Курск');
});

test('a throwing step fails its node and rethrows; an abort cancels it', async () => {
  const store = new ProcessTreeStore();
  const root = store.createNode({ nodeType: 'Run' });
  await assert.rejects(root.step({ nodeType: 'Bad' }, async () => { throw Object.assign(new Error('сломалось'), { code: 'broken' }); }), /сломалось/);
  const abort = Object.assign(new Error('стоп'), { name: 'AbortError' });
  await assert.rejects(root.step({ nodeType: 'Stopped' }, async () => { throw abort; }));
  const kids = store.nodesOf(root.id).filter((n) => n.parentNodeId);
  assert.deepEqual(kids.map((n) => [n.nodeType, n.status]), [['Bad', 'failed'], ['Stopped', 'cancelled']]);
  assert.deepEqual(kids[0].outcome, { ok: false, code: 'broken', detail: 'сломалось' });
});

test('projection builds the hierarchy with depth, lineage and child stats', async () => {
  const store = new ProcessTreeStore();
  const root = store.createNode({ nodeType: 'Run' });
  await root.step({ nodeType: 'Group' }, async (group) => {
    await group.step({ nodeType: 'Item' }, async () => {});
    await group.step({ nodeType: 'Item' }, async (n) => n.skip('empty', 'пусто'));
  });
  const tree = projectTree(store.nodesOf(root.id), root.id);
  assert.equal(tree.depth, 0);
  assert.equal(tree.displayStatus, 'pending');
  const group = tree.children[0];
  assert.deepEqual(group.stats, { total: 2, completed: 1, skipped: 1 });
  assert.equal(group.children[1].depth, 2);
  assert.deepEqual(group.children[1].lineage, [root.id, group.nodeId]);
  assert.equal(group.children[1].statusTone, 'muted');
  // свёртка глубины: у корня видны исходы внуков, у группы — нет (они её прямые дети)
  assert.deepEqual(tree.deep, { Item: { completed: 1, skipped: 1 } });
  assert.deepEqual(group.deep, {});
});

test('old finished roots are evicted, running ones stay; the node cap detaches overflow', () => {
  const store = new ProcessTreeStore({ keepRoots: 2, maxNodesPerRoot: 3 });
  const running = store.createNode({ nodeType: 'Run', title: 'идёт' });
  running.start();
  const done = store.createNode({ nodeType: 'Run', title: 'готов' });
  done.complete();
  store.createNode({ nodeType: 'Run', title: 'новый' });
  assert.deepEqual(store.roots().map((r) => r.title), ['новый', 'идёт']);

  running.child({ nodeType: 'A' });
  running.child({ nodeType: 'B' });
  const over = running.child({ nodeType: 'C' });
  assert.equal(over.id, null);
  assert.equal(over.complete(), false);
  assert.equal(store.roots().find((r) => r.title === 'идёт').overflow, 1);
});

test('tree@1 answers unchanged for the same version and projects the latest root', async () => {
  const store = new ProcessTreeStore();
  const app = express();
  app.use('/c', Components({ runs: Tree({ store, title: 'Прогоны', labels: { Run: 'прогон' } }) }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/c/runs`;
  try {
    const empty = await (await fetch(`${base}/tree`)).json();
    assert.equal(empty.tree, null);
    const root = store.createNode({ nodeType: 'Run', title: 'прогон' });
    root.start();
    const meta = await (await fetch(`${base}/meta`)).json();
    assert.deepEqual([meta.kind, meta.version, meta.labels.Run], ['tree', 1, 'прогон']);
    const first = await (await fetch(`${base}/tree?root=latest`)).json();
    assert.equal(first.rootId, root.id);
    assert.equal(first.tree.status, 'running');
    const again = await (await fetch(`${base}/tree?since=${first.version}`)).json();
    assert.equal(again.unchanged, true);
  } finally {
    server.close();
  }
});
