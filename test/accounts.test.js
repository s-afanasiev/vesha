// Учётки входа (server/services/accounts.js, server/routes/auth.js): админ — из .env,
// регистрация его почты закрыта; в сборке магазина регистрация закрыта целиком —
// учётки выдаёт админ; смена пароля вошедшим закрывает остальные его сессии.

process.env.REGISTRATION_OPEN = 'false'; // до чтения config: как в .env.example сборки магазина

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { Accounts, generatePassword, bootAdmins } = require('../server/services/accounts');

test('generated password: three groups of four, no look-alike characters, not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.match(p, /^[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}$/, p);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

function client(base) {
  const jar = new Map();
  const call = async (p, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + p, { ...init, headers });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { ...(await r.json().catch(() => ({}))), status: r.status };
  };
  return {
    jar,
    get: (p) => call(p),
    post: (p, body) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

test('postgres: admin account from .env, closed registration, password change ends other sessions', async (t) => {
  const db = require('../server/db');
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const accounts = new Accounts(db);
  const tag = Date.now().toString(36);
  const adminMail = `boot-admin-${tag}@acc.test`;
  const userMail = `user-${tag}@acc.test`;
  const { identityMiddleware } = require('../server/middleware/identity');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', identityMiddleware);
  app.use('/api/auth', require('../server/routes/auth'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const fresh = () => { const c = client(base); clients.push(c); return c; };
  try {
    // стартовый админ: заводится один раз; короткий пароль — не заводится, остаётся в «missing»
    const quiet = { log: () => {}, warn: () => {} };
    assert.deepEqual(await bootAdmins(accounts, { adminEmails: [adminMail], adminPassword: 'short' }, quiet), { created: [], missing: [adminMail] });
    assert.deepEqual(await bootAdmins(accounts, { adminEmails: [adminMail], adminPassword: 'admin-pass-123' }, quiet), { created: [adminMail], missing: [] });
    assert.deepEqual(await bootAdmins(accounts, { adminEmails: [adminMail], adminPassword: 'other-pass-456' }, quiet), { created: [], missing: [] });
    const admin = fresh();
    assert.equal((await admin.post('/api/auth/login', { email: adminMail, password: 'admin-pass-123' })).status, 200, 'пароль — первый, повтор старта не меняет');

    // регистрация закрыта (сборка магазина): учётки выдаёт админ
    const me = await fresh().get('/api/auth/me');
    assert.equal(me.registrationOpen, false);
    const reg = await fresh().post('/api/auth/register', { email: `nobody-${tag}@acc.test`, password: 'nobody-pass-123' });
    assert.equal(reg.status, 403);
    assert.match(reg.error, /закрыта/);

    // смена пароля: без входа — 401; неверный текущий — 401; короткий — 400; удачно — другие сессии вышли
    const { password } = await accounts.issue({ email: userMail });
    const laptop = fresh();
    const phone = fresh();
    for (const c of [laptop, phone]) assert.equal((await c.post('/api/auth/login', { email: userMail, password })).status, 200);
    assert.equal((await fresh().post('/api/auth/password', { current: password, password: 'new-pass-789' })).status, 401);
    assert.equal((await laptop.post('/api/auth/password', { current: 'wrong-pass', password: 'new-pass-789' })).status, 401);
    assert.equal((await laptop.post('/api/auth/password', { current: password, password: 'short' })).status, 400);
    assert.equal((await laptop.post('/api/auth/password', { current: password, password: 'new-pass-789' })).status, 200);
    assert.equal((await laptop.get('/api/auth/me')).user.email, userMail, 'своя сессия осталась');
    assert.equal((await phone.get('/api/auth/me')).user, null, 'другое устройство вышло');
    assert.equal((await fresh().post('/api/auth/login', { email: userMail, password })).status, 401, 'старый пароль больше не входит');
    assert.equal((await fresh().post('/api/auth/login', { email: userMail, password: 'new-pass-789' })).status, 200);
  } finally {
    server.close();
    await db.query('DELETE FROM users WHERE email = ANY($1)', [[adminMail, userMail]]);
    const guests = clients.map((c) => decodeURIComponent(c.jar.get('vesha_guest') || '').split('.')[0]).filter(Boolean);
    if (guests.length) await db.query('DELETE FROM guests WHERE id = ANY($1::uuid[])', [guests]).catch(() => {});
  }
});
