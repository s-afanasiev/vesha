// Манифесты проектов и профили монтирования (server/projects.js).
//
// Проверяем: манифесты на диске валидны и совпадают с каталогом; профиль
// фильтрует по роду проекта; full монтирует ровно те же 15 API, что были
// перечислены в main.js руками; showcase не тащит ни одного эксперимента;
// registry.json собирается из манифестов без расхождений.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const projects = require('../server/projects');

const REGISTRY = path.join(ROOT, 'public', 'experiments', 'registry.json');
const readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

// Исторический список main.js: что монтировалось до загрузчика.
const LEGACY = [
  ['/api/summarize', 'server/routes/summarize'],
  ['/api/extract-audio', 'server/routes/extractAudio'],
  ['/api/notes-export', 'server/routes/notesExport'],
  ['/api/llm', 'server/routes/llm'],
  ['/api/idea-radar', 'server/routes/ideaRadar'],
  ['/api/super-notes', 'server/routes/superNotes'],
  ['/api/chat-engine', 'server/routes/chat-engine'],
  ['/api/pain-radar', 'server/routes/pain-radar'],
  ['/api/experiments', 'server/routes/experiments'],
  ['/api/playwright-mcp', 'server/routes/playwright-mcp'],
  ['/api/automation-leads', 'server/routes/automationLeads'],
  ['/api/backbone', 'server/routes/backbone'],
  ['/api/backbone-public', 'server/routes/backbonePublic'],
  ['/api/auth', 'server/routes/auth'],
  ['/api/looks', 'server/routes/looks'],
].map(([mount, mod]) => `${mount} ${mod}`).sort();

test('проекты: манифесты валидны, порядок сплошной, маршруты существуют', () => {
  const all = projects.load({ fresh: true });
  assert.equal(all.length, 15);
  assert.deepEqual(all.map((p) => p.order), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.deepEqual([...new Set(all.map((p) => p.id))].length, all.length, 'id уникальны');
  for (const p of all) {
    assert.ok(['experiment', 'showcase', 'client'].includes(p.kind), `${p.id}: kind`);
    for (const r of p.routes) {
      assert.doesNotThrow(() => require.resolve(path.join(ROOT, r.module)), `${p.id}: ${r.module}`);
    }
  }
});

test('проекты: каждый эксперимент каталога имеет манифест, порядок совпадает', () => {
  const all = projects.load({ fresh: true });
  const registry = readRegistry();
  assert.deepEqual(
    all.filter((p) => p.kind === 'experiment').map((p) => p.id),
    registry.experiments.map((e) => e.id),
  );
});

test('проекты: профиль фильтрует по роду, client:<id> — по заказчику', () => {
  const sample = [
    { id: 'a', kind: 'experiment', order: 1 },
    { id: 'b', kind: 'showcase', order: 2 },
    { id: 'c', kind: 'client', client: 'acme', order: 3 },
    { id: 'd', kind: 'client', client: 'other', order: 4 },
  ];
  const ids = (profile) => projects.select(sample, profile).map((p) => p.id);
  assert.deepEqual(ids('full'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids('lab'), ['a']);
  assert.deepEqual(ids('showcase'), ['b']);
  assert.deepEqual(ids('client:acme'), ['c']);
  assert.deepEqual(ids('client:nobody'), []);
  assert.throws(() => ids('nope'), /неизвестный профиль/);
  assert.throws(() => ids('client:'), /пустой client/);
});

test('проекты: full монтирует ровно те же 15 API, что были в main.js', () => {
  const app = express();
  const active = projects.mount(app, { profile: 'full' });
  const got = active.mounts.map((m) => `${m.mount} ${m.module}`).sort();
  assert.deepEqual(got, LEGACY);
  assert.equal(active.mounts.length, 15);
  assert.equal(active.projects.length, 15);

  const stack = (app.router || app._router).stack;
  assert.equal(stack.length, 15, 'каждый mount — слой Express');
});

test('проекты: showcase не монтирует ни одного эксперимента, только платформу', () => {
  const app = express();
  const active = projects.mount(app, { profile: 'showcase' });
  assert.deepEqual(active.projects, []);
  assert.deepEqual(active.mounts.map((m) => m.mount), ['/api/auth', '/api/llm']);
  assert.equal(projects.hasCatalog('showcase'), false);
  assert.equal(projects.hasCatalog('lab'), true);
  assert.equal(projects.hasCatalog('full'), true);
});

test('проекты: registry.json собирается из манифестов без расхождений', async () => {
  const { registryFrom } = await import('../scripts/build-registry.mjs');
  assert.deepEqual(registryFrom(projects.load({ fresh: true })), readRegistry());
});

test('проекты: main.js больше не перечисляет маршруты руками', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.equal((src.match(/app\.use\('\/api\//g) || []).length, 0);
  assert.match(src, /projects\.mount\(app/);
});
