const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { Catalog, CsvFeed } = require('../server/services/backbone/catalog/Catalog');
const { Components } = require('../server/components');
const { Kanban } = require('../server/components/kanban');

const SHOP = 'test-shop';

function makeDesk() {
  const journal = new MemoryJournal();
  const desk = new BackboneDesk({
    repository: new MemoryRepository(journal),
    journal,
    board: new Board(),
    path: new Path(STAGE_TYPES),
    templateOf,
    shops: { [SHOP]: { name: 'Тест', niche: 'hardware' } },
  });
  return { desk, journal };
}

const types = (events) => events.map((e) => e.type);

// ---------- Board: инварианты конструктора ----------

test('templates of both niches pass the board invariants', () => {
  const board = new Board();
  for (const niche of ['hardware', 'metalworking']) assert.ok(board.check(templateOf(niche)).length >= 5);
  assert.throws(() => templateOf('bakery'), /Нет шаблона/);
});

test('board keeps required types: the only done or inbox column cannot disappear', () => {
  const board = new Board();
  const cols = templateOf('hardware');
  assert.throws(() => board.apply(cols, { op: 'remove', id: 'issued' }), /готово/);
  assert.throws(() => board.apply(cols, { op: 'retype', id: 'new', type: 'working' }), /входящие/);
  assert.throws(() => board.apply(cols, { op: 'retype', id: 'parse', type: 'nonsense' }), /Неизвестный тип/);
  const added = board.apply(cols, { op: 'add', title: 'Ещё отказ', type: 'refused' });
  const next = board.apply(added.columns, { op: 'remove', id: 'refused' });
  assert.ok(next.columns.some((c) => c.type === 'refused'));
  assert.equal(next.event.type, 'column_removed');
});

test('removing a column with cards needs a target column and yields moves', () => {
  const board = new Board();
  const cols = templateOf('hardware');
  assert.throws(() => board.apply(cols, { op: 'remove', id: 'parse' }, { parse: 2 }), /куда их перенести/);
  assert.throws(() => board.apply(cols, { op: 'remove', id: 'parse', moveTo: 'parse' }, { parse: 2 }), /удаляемую/);
  const r = board.apply(cols, { op: 'remove', id: 'parse', moveTo: 'paid' }, { parse: 2 });
  assert.deepEqual(r.moves, [{ from: 'parse', to: 'paid' }]);
  assert.equal(r.event.data.cards, 2);
  assert.ok(!r.columns.some((c) => c.id === 'parse'));
});

test('board ops: add after, rename, move, recolor and limit validate their input', () => {
  const board = new Board();
  const cols = templateOf('hardware');
  const added = board.apply(cols, { op: 'add', title: 'Доставка', type: 'working', after: 'paid' });
  assert.equal(added.columns[added.columns.findIndex((c) => c.id === 'paid') + 1].title, 'Доставка');
  assert.equal(added.event.data.column, 'col-1');
  assert.throws(() => board.apply(cols, { op: 'rename', id: 'parse', title: '  ' }), /пустым/);
  const moved = board.apply(cols, { op: 'move', id: 'refused', to: 0 });
  assert.equal(moved.columns[0].id, 'refused');
  assert.throws(() => board.apply(cols, { op: 'move', id: 'refused', to: 99 }), /вне доски/);
  assert.throws(() => board.apply(cols, { op: 'recolor', id: 'parse', color: 'red' }), /#rrggbb/);
  assert.equal(board.apply(cols, { op: 'limit', id: 'parse', limit: 5 }).columns.find((c) => c.id === 'parse').limit, 5);
  assert.equal(board.apply(cols, { op: 'limit', id: 'parse', limit: 0 }).columns.find((c) => c.id === 'parse').limit, null);
  assert.throws(() => board.apply(cols, { op: 'limit', id: 'parse', limit: 1.5 }), /целое/);
  assert.throws(() => board.apply(cols, { op: 'explode' }), /Неизвестная операция/);
});

// ---------- BackboneDesk: заявка, путь, конструктор — всё события журнала ----------

test('a manual order lands in the inbox column, gets a number and a received event', async () => {
  const { desk, journal } = makeDesk();
  const a = await desk.createOrder(SHOP, { client: 'ООО Ромашка', contact: '+7 900', text: 'болт М10×50 — 200 шт' }, 'admin@x');
  const b = await desk.createOrder(SHOP, { client: 'ИП Петров' }, 'admin@x');
  assert.equal(a.column_id, 'new');
  assert.deepEqual([a.number, b.number], [1, 2]);
  await assert.rejects(desk.createOrder(SHOP, { client: '   ' }, 'admin@x'), /Клиент: пусто/);
  const shop = await desk.shop(SHOP);
  const events = await journal.forScope(shop.id);
  assert.deepEqual(types(events).reverse(), ['board_created', 'received', 'received']);
  assert.equal(events[0].actor, 'admin@x');
});

test('moving an order records from/to with semantic types; a stale move is refused', async () => {
  const { desk, journal } = makeDesk();
  const order = await desk.createOrder(SHOP, { client: 'Клиент' }, 'a');
  await desk.moveOrder(SHOP, order.id, 'parse', { actor: 'a' });
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'a', cause: 'drag' });
  await assert.rejects(desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'a' }), /уже в этой колонке/);
  await assert.rejects(desk.moveOrder(SHOP, order.id, 'nowhere', { actor: 'a' }), /Нет такой колонки/);
  await assert.rejects(desk.moveOrder(SHOP, 'missing', 'parse', { actor: 'a' }), /не найдена/);
  const { events } = await desk.history(SHOP, order.id);
  assert.deepEqual(types(events), ['received', 'moved', 'moved']);
  assert.deepEqual(events[2].data, { number: 1, from: 'parse', to: 'invoice', fromType: 'working', toType: 'waiting_client' });
  assert.equal(events[2].cause, 'drag');
  // повтор того же переноса снаружи двери (гонка двух вкладок) — отказ репозитория
  const repo = desk.repository;
  await assert.rejects(repo.moveOrder(order.id, 'parse', 'paid', []), /уже переместилась/);
  assert.equal((await journal.forSubject('order', order.id)).length, 3);
});

test('constructor: rename and delete a column with cards — cards move and every step is an event', async () => {
  const { desk, journal } = makeDesk();
  const o1 = await desk.createOrder(SHOP, { client: 'Один' }, 'a');
  const o2 = await desk.createOrder(SHOP, { client: 'Два' }, 'a');
  await desk.moveOrder(SHOP, o1.id, 'ask', { actor: 'a' });
  await desk.moveOrder(SHOP, o2.id, 'ask', { actor: 'a' });

  let cols = await desk.configure(SHOP, { op: 'rename', id: 'ask', title: 'Уточняем' }, 'owner');
  assert.equal(cols.find((c) => c.id === 'ask').title, 'Уточняем');
  await assert.rejects(desk.configure(SHOP, { op: 'remove', id: 'ask' }, 'owner'), /куда их перенести/);
  cols = await desk.configure(SHOP, { op: 'remove', id: 'ask', moveTo: 'invoice' }, 'owner');
  assert.ok(!cols.some((c) => c.id === 'ask'));
  const orders = await desk.orders(SHOP);
  assert.deepEqual(orders.map((o) => o.column_id), ['invoice', 'invoice']);

  const shop = await desk.shop(SHOP);
  const events = (await journal.forScope(shop.id)).reverse();
  assert.deepEqual(types(events).slice(-4), ['column_renamed', 'column_removed', 'moved', 'moved']);
  const removal = events.filter((e) => e.cause === 'column_removed');
  assert.equal(removal.length, 2);
  assert.deepEqual(removal.map((e) => e.data.toType), ['waiting_client', 'waiting_client']);
  assert.equal(shop.board_version, 3);
});

test('constructor uses optimistic locking: a stale board version is refused', async () => {
  const { desk } = makeDesk();
  const { shop, version, columns } = await desk.board(SHOP);
  await desk.configure(SHOP, { op: 'rename', id: 'parse', title: 'Разбор заявки' }, 'one');
  await assert.rejects(
    desk.repository.saveBoard(shop.id, version, columns, [], [], () => null),
    /Доска изменилась/,
  );
});

// ---------- каталог-фикстура ----------

test('catalog fixture has 300 unique positions with pack, price and stock', () => {
  const catalog = new Catalog(new CsvFeed(require('node:path').join(__dirname, '..', 'server', 'services', 'backbone', 'catalog', 'fixtures', 'hardware-300.csv')));
  const items = catalog.items();
  assert.equal(items.length, 300);
  assert.equal(new Set(items.map((i) => i.sku)).size, 300);
  assert.ok(items.every((i) => i.name && i.pack >= 1 && i.price > 0 && i.stock >= 0));
  assert.ok(items.some((i) => i.stock === 0), 'есть позиции без остатка — для проверки остатков на шаге 2');
  assert.equal(catalog.bySku('B933-10x50-ZN').name, 'Болт DIN 933 М10×50 кл. 8.8 оцинк.');
});

// ---------- kanban@1: колонки от источника, type, POST /columns, POST /cards ----------

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use('/c', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/c/board`;
  const call = async (path, body) => {
    const res = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, json: await res.json() };
  };
  return { server, call };
}

test('kanban@1 serves live columns with types and the constructor and create doors', async () => {
  const { desk } = makeDesk();
  const { server, call } = await serve(Components({
    board: Kanban({
      columns: () => desk.columns(SHOP),
      cards: async () => (await desk.orders(SHOP)).map((o) => ({ id: o.id, column: o.column_id, title: o.client })),
      card: { title: 'title' },
      move: ({ cardId, to }) => desk.moveOrder(SHOP, cardId, to, { actor: 't' }),
      create: { fields: [{ key: 'client', label: 'Клиент', required: true }], run: ({ fields }) => desk.createOrder(SHOP, fields, 't') },
      configure: { types: new Board().typeNames(), run: ({ op }) => desk.configure(SHOP, op, 't') },
    }),
  }));
  try {
    let meta = (await call('/meta')).json;
    assert.equal(meta.columns[0].type, 'inbox');
    assert.equal(meta.create.enabled, true);
    assert.equal(meta.configure.types.length, 5);

    const created = await call('/cards', { client: 'Новый', ignored: 'x' });
    assert.equal(created.status, 200);
    const cards = (await call('/cards')).json.cards;
    assert.equal(cards[0].column, 'new');

    const renamed = await call('/columns', { op: 'rename', id: 'new', title: 'Входящие' });
    assert.equal(renamed.json.columns[0].name, 'Входящие');
    meta = (await call('/meta')).json;
    assert.equal(meta.columns[0].name, 'Входящие', '/meta читает колонки у источника на каждом запросе');

    const refused = await call('/columns', { op: 'remove', id: 'new' });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /перенести|входящие/);

    const added = await call('/columns', { op: 'add', title: 'Доставка', type: 'working' });
    const newId = added.json.columns.find((c) => c.name === 'Доставка').id;
    assert.equal((await call('/move', { cardId: cards[0].id, to: newId })).status, 200);
    assert.equal((await call('/move', { cardId: cards[0].id, to: 'nowhere' })).status, 400);
  } finally {
    server.close();
  }
});

test('backbone API is admin-only: a guest gets 403 before any data is touched', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/backbone', require('../server/routes/backbone'));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/backbone`;
    for (const path of ['/c/board/meta', '/c/board/cards', '/c/journal/rows', '/c/pages/main']) {
      assert.equal((await fetch(base + path)).status, 403, path);
    }
    const post = await fetch(`${base}/c/board/columns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'remove', id: 'new' }),
    });
    assert.equal(post.status, 403);
  } finally {
    server.close();
  }
});

test('kanban@1 without create/configure keeps the old contract: static columns, doors closed', async () => {
  const { server, call } = await serve(Components({
    board: Kanban({ columns: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], cards: async () => [] }),
  }));
  try {
    const meta = (await call('/meta')).json;
    assert.deepEqual(meta.columns, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    assert.equal(meta.create.enabled, false);
    assert.equal(meta.configure.enabled, false);
    assert.equal((await call('/columns', { op: 'rename', id: 'a', title: 'x' })).status, 400);
    assert.equal((await call('/cards', { title: 'x' })).status, 400);
  } finally {
    server.close();
  }
});
