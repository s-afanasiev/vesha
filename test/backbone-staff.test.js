// Костяк: сотрудник магазина. Админ экземпляра (ADMIN_EMAILS) — все магазины и
// экран «Магазины»; сотрудник — почта, которую админ добавил магазину: входит
// обычной регистрацией и видит только свой магазин. Чужой магазин и демо — 403
// до чтения данных, без входа — 401. Решает ShopAccess, граница — routes/backbone.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('../server/config');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { TEMPLATES, templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { ShopForm } = require('../server/services/backbone/shops/ShopForm');
const { ShopAccess } = require('../server/services/backbone/shops/ShopAccess');

const ADMIN = { id: 'u0', email: 'admin@vesha.test' };
const STAFF = { id: 'u1', email: 'manager@shop.test' };
const STRANGER = { id: 'u2', email: 'stranger@shop.test' };

function makeDesk() {
  const journal = new MemoryJournal();
  const repository = new MemoryRepository(journal);
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shops: { demo: { name: 'Демо', niche: 'hardware', mode: 'help', shadowDays: 0 } },
    shopForm: new ShopForm({ niches: Object.keys(TEMPLATES) }),
    access: new ShopAccess({ admins: [' Admin@Vesha.test '] }),
  });
  return { desk, journal };
}

test('shop access: admin enters everything, staff — only a shop with its e-mail, demo — admin only; verdicts carry a reason', () => {
  const access = new ShopAccess({ admins: ['Admin@Vesha.test'] });
  assert.equal(access.emailOf({ email: ' Manager@Shop.Test ' }), 'manager@shop.test', 'почта — как её хранит регистрация');
  assert.equal(access.isAdmin(ADMIN), true);
  assert.equal(access.isAdmin(STAFF), false);
  assert.equal(new ShopAccess().isAdmin(ADMIN), false, 'ADMIN_EMAILS пуст — админа нет');

  for (const user of [null, { id: 'x' }]) {
    const v = access.signedIn(user);
    assert.deepEqual([v.ok, v.status], [false, 401]);
    assert.match(v.reason, /Войдите/);
  }
  assert.deepEqual(access.signedIn(STAFF), { ok: true, role: 'staff' });
  assert.deepEqual(access.cabinet(ADMIN), { ok: true, role: 'admin' });
  assert.deepEqual([access.cabinet(STAFF).status, access.cabinet(null).status], [403, 401]);
  assert.match(access.cabinet(STAFF).reason, /только для админа/);

  assert.deepEqual(access.shop(ADMIN, { seed: true }), { ok: true, role: 'admin' });
  assert.deepEqual(access.shop(STAFF, { staff: true }), { ok: true, role: 'staff' });
  assert.equal(access.shop(STAFF, { staff: false }).status, 403);
  assert.match(access.shop(STAFF).reason, /попросите админа/);
  assert.equal(access.shop(STAFF, { staff: true, seed: true }).status, 403, 'демо — только админ');
  assert.equal(access.shop(null, { staff: true }).status, 401);
});

test('staff of a shop: added and removed by the admin with events; enters only its shop, the list shows only its shops', async () => {
  const { desk, journal } = makeDesk();
  const shop = await desk.openShop({ slug: 'krepezh-kursk', name: 'Крепёж Курск', niche: 'hardware' }, ADMIN.email);
  await desk.openShop({ slug: 'other-shop', name: 'Другой магазин', niche: 'hardware' }, ADMIN.email);

  const added = await desk.addStaff('krepezh-kursk', ' Manager@Shop.Test ', ADMIN.email);
  assert.deepEqual([added.shop.slug, added.email], ['krepezh-kursk', 'manager@shop.test']);
  await assert.rejects(desk.addStaff('krepezh-kursk', 'manager@shop.test', ADMIN.email), (e) => e.status === 409);
  await assert.rejects(desk.addStaff('demo', 'x@shop.test', ADMIN.email), (e) => e.status === 400 && /Демо-магазин/.test(e.message));
  await assert.rejects(desk.addStaff('krepezh-kursk', 'не почта', ADMIN.email), (e) => e.status === 400 && /Почта сотрудника/.test(e.message));
  await assert.rejects(desk.addStaff('nope', 'x@shop.test', ADMIN.email), (e) => e.status === 404);

  assert.equal((await desk.enter('krepezh-kursk', STAFF)).id, shop.id);
  assert.equal((await desk.enter('krepezh-kursk', { email: 'MANAGER@shop.test' })).id, shop.id, 'регистр почты не важен');
  for (const slug of ['other-shop', 'demo', 'nope']) {
    await assert.rejects(desk.enter(slug, STAFF), (e) => e.status === 403, `${slug}: 403, существование адреса не выдаём`);
  }
  await assert.rejects(desk.enter('krepezh-kursk', STRANGER), (e) => e.status === 403);
  await assert.rejects(desk.enter('krepezh-kursk', null), (e) => e.status === 401);
  assert.equal((await desk.enter('demo', ADMIN)).slug, 'demo', 'админу посев заводится при входе');
  await assert.rejects(desk.enter('nope', ADMIN), (e) => e.status === 404, 'админу неизвестный адрес — 404');
  assert.throws(() => desk.enterCabinet(STAFF), (e) => e.status === 403);
  assert.equal(desk.enterCabinet(ADMIN).role, 'admin');

  const mine = await desk.shopsFor(STAFF);
  assert.deepEqual([mine.admin, mine.shops.map((s) => s.slug)], [false, ['krepezh-kursk']]);
  const all = await desk.shopsFor(ADMIN);
  assert.deepEqual([all.admin, all.shops.map((s) => s.slug).sort()], [true, ['demo', 'krepezh-kursk', 'other-shop']]);
  assert.deepEqual((await desk.shopsFor(STRANGER)).shops, []);
  await assert.rejects(desk.shopsFor(null), (e) => e.status === 401);

  const [row] = await desk.staffList();
  assert.deepEqual([row.slug, row.name, row.email, row.added_by], ['krepezh-kursk', 'Крепёж Курск', 'manager@shop.test', ADMIN.email]);

  await desk.removeStaff('krepezh-kursk', 'Manager@Shop.Test', ADMIN.email);
  await assert.rejects(desk.enter('krepezh-kursk', STAFF), (e) => e.status === 403, 'убранный теряет вход сразу');
  await assert.rejects(desk.removeStaff('krepezh-kursk', 'manager@shop.test', ADMIN.email), (e) => e.status === 409);
  assert.deepEqual(await desk.staffList(), []);

  const events = (await journal.history(shop.id)).filter((e) => e.type.startsWith('staff_'));
  assert.deepEqual(events.map((e) => [e.stream, e.type, e.data.email, e.actor, e.cause]), [
    ['shop', 'staff_added', 'manager@shop.test', ADMIN.email, 'cabinet'],
    ['shop', 'staff_removed', 'manager@shop.test', ADMIN.email, 'cabinet'],
  ]);
});

test('http boundary without a database: no sign-in — 401 everywhere, a non-admin — 403 on the cabinet of shops', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.get('x-test-user')) req.user = { id: 'u', email: req.get('x-test-user') }; next(); });
  app.use('/api/backbone', require('../server/routes/backbone'));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/backbone`;
    for (const p of ['/me', '/c/shops/rows', '/c/staff/rows', '/s/demo-krepezh/c/pages/main', '/s/demo-krepezh/files/invoice/x.xlsx']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 401, p);
      assert.match((await r.json()).error, /Войдите/);
    }
    const as = { 'x-test-user': 'nobody@shop.test', 'Content-Type': 'application/json' };
    for (const p of ['/c/shops/rows', '/c/pages/shops', '/c/staff/rows', '/c/staff/meta']) {
      assert.equal((await fetch(base + p, { headers: as })).status, 403, p);
    }
    for (const p of ['/c/shops/actions/staff', '/c/staff/actions/remove', '/c/shops/actions/open']) {
      const r = await fetch(base + p, { method: 'POST', headers: as, body: JSON.stringify({ ids: ['demo-krepezh'], email: 'nobody@shop.test' }) });
      assert.equal(r.status, 403, p);
    }
  } finally {
    server.close();
  }
});

// ---------- Postgres: сотрудник регистрируется сам и работает в своём магазине ----------

// Клиент с cookie: сессия сотрудника после регистрации едет в каждом запросе.
function client(base, headers = {}) {
  const jar = new Map();
  const call = async (p, init = {}) => {
    const h = { ...headers, ...(init.headers || {}) };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + p, { ...init, headers: h });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    let body = {};
    try { body = JSON.parse(await r.text()); } catch { /* xlsx или пусто */ }
    return { ...body, status: r.status };
  };
  return {
    jar,
    get: (p) => call(p),
    post: (p, body) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

test('postgres: the admin adds an e-mail, the employee registers with it and works in its shop; other shops and the cabinet — 403', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['025_backbone_shop_staff.sql']);
    if (!rows.length) return t.skip('миграция 025 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  if (!config.adminEmails.length) return t.skip('ADMIN_EMAILS пуст');
  const adminEmail = config.adminEmails[0];
  const { identityMiddleware } = require('../server/middleware/identity');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', identityMiddleware);
  // админ экземпляра — заголовком теста (его пароля в общей базе нет); сотрудник — настоящей регистрацией
  app.use('/api', (req, _res, next) => { if (req.get('x-test-admin')) req.user = { id: 'test-admin', email: adminEmail }; next(); });
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/backbone', require('../server/routes/backbone'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = client(base, { 'x-test-admin': '1' });
  const staff = client(base);
  const tag = Date.now().toString(36);
  const own = `t-staff-${tag}`;
  const other = `t-other-${tag}`;
  const email = `staff-${tag}@shop.test`;
  try {
    for (const [slug, name] of [[own, 'Магазин сотрудника'], [other, 'Чужой магазин']]) {
      const opened = await admin.post('/api/backbone/c/shops/actions/open', { slug, name, niche: 'hardware' });
      assert.equal(opened.status, 200, opened.error);
    }
    const added = await admin.post('/api/backbone/c/shops/actions/staff', { ids: [own], email: email.toUpperCase() });
    assert.equal(added.status, 200, added.error);
    assert.match(added.result.message, new RegExp(`${email} — сотрудник «Магазин сотрудника»`));

    assert.equal((await staff.get(`/api/backbone/s/${own}/c/pages/main`)).status, 401, 'до регистрации — гость');
    const registered = await staff.post('/api/auth/register', { email, password: 'staff-pass-123' });
    assert.equal(registered.status, 201, registered.error);

    const me = await staff.get('/api/backbone/me');
    assert.deepEqual([me.status, me.email, me.admin, me.shops], [200, email, false, [{ slug: own, name: 'Магазин сотрудника', demo: false }]]);

    // свой магазин: доска, черновики, замеры, каталог — экраны и данные
    for (const page of ['main', 'draft', 'measures', 'catalog']) {
      assert.equal((await staff.get(`/api/backbone/s/${own}/c/pages/${page}`)).status, 200, page);
    }
    const card = await staff.post(`/api/backbone/s/${own}/c/board/cards`, { client: 'ООО «Тест»', text: 'Болт М10х50 — 100 шт' });
    assert.equal(card.status, 200, card.error);
    assert.equal((await staff.get(`/api/backbone/s/${own}/c/board/cards`)).cards.length, 1);
    for (const p of ['drafts/rows', 'summary/rows', 'catalog-fields/rows', 'catalog-loads/rows']) {
      assert.equal((await staff.get(`/api/backbone/s/${own}/c/${p}`)).status, 200, p);
    }

    // чужое — 403 до данных: другой магазин, демо, неизвестный адрес, кабинет магазинов
    for (const p of [
      `/s/${other}/c/pages/main`, `/s/${other}/c/board/cards`, `/s/${other}/c/journal/rows`, `/s/${other}/files/invoice/x.xlsx`,
      '/s/demo-krepezh/c/pages/main', `/s/nope-${tag}/c/pages/main`, '/c/shops/rows', '/c/pages/shops', '/c/staff/rows',
    ]) {
      const r = await staff.get(`/api/backbone${p}`);
      assert.equal(r.status, 403, p);
    }
    assert.equal((await staff.post(`/api/backbone/s/${other}/c/board/cards`, { client: 'Чужая заявка' })).status, 403);
    assert.equal((await staff.post('/api/backbone/c/shops/actions/staff', { ids: [other], email })).status, 403, 'сам себе магазин не добавит');

    // админ: список сотрудников, неизвестный адрес — 404; убрал — вход закрыт сразу
    const listed = (await admin.get('/api/backbone/c/staff/rows?limit=200')).rows.find((r) => r.email === email);
    assert.deepEqual([listed.id, listed.shop, listed.by], [`${own}:${email}`, `${own} · Магазин сотрудника`, adminEmail]);
    assert.equal((await admin.get(`/api/backbone/s/nope-${tag}/c/pages/main`)).status, 404);
    const removed = await admin.post('/api/backbone/c/staff/actions/remove', { ids: [listed.id] });
    assert.equal(removed.status, 200, removed.error);
    assert.equal((await staff.get(`/api/backbone/s/${own}/c/pages/main`)).status, 403);
    assert.deepEqual((await staff.get('/api/backbone/me')).shops, []);

    const journal = (await admin.get(`/api/backbone/s/${own}/c/journal/rows?limit=200`)).rows;
    assert.ok(journal.some((r) => r.what === `сотрудник ${email} добавлен: входит в кабинет магазина` && r.actor === adminEmail));
    assert.ok(journal.some((r) => r.what === `сотрудник ${email} убран: кабинет магазина ему закрыт`));
    assert.ok(journal.some((r) => /^заявка №1 принята/.test(r.what) && r.actor === email), 'заявка — от имени сотрудника');
  } finally {
    server.close();
    for (const slug of [own, other]) {
      const { rows: [shop] } = await db.query('SELECT id FROM backbone_shops WHERE slug = $1', [slug]);
      if (!shop) continue;
      await db.query('DELETE FROM journal_events WHERE scope = $1', [shop.id]);
      await db.query('DELETE FROM backbone_shops WHERE id = $1', [shop.id]);
    }
    await db.query('DELETE FROM users WHERE email = $1', [email]);
    const guests = [admin, staff].map((c) => decodeURIComponent(c.jar.get('vesha_guest') || '').split('.')[0]).filter(Boolean);
    if (guests.length) await db.query('DELETE FROM guests WHERE id = ANY($1::uuid[])', [guests]).catch(() => {});
  }
});
