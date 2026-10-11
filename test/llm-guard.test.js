const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const config = require('../server/config');
const { runGuarded, __test } = require('../server/services/llmGuard');
const ideaRadarRoutes = require('../server/routes/ideaRadar');

const originalGuestLimit = config.llmGuestRequestsPerHour;
const originalUserLimit = config.llmUserRequestsPerHour;
const originalConcurrent = config.llmMaxConcurrent;
const originalAdminEmails = config.adminEmails;

test.afterEach(() => {
  config.llmGuestRequestsPerHour = originalGuestLimit;
  config.llmUserRequestsPerHour = originalUserLimit;
  config.llmMaxConcurrent = originalConcurrent;
  config.adminEmails = originalAdminEmails;
  __test.buckets.clear();
});

test('LLM guard limits requests per identity', async () => {
  config.llmGuestRequestsPerHour = 1;
  const req = { guest: { id: 'guest-1' }, ip: '127.0.0.1' };

  assert.equal(await runGuarded(req, async () => 'ok'), 'ok');
  await assert.rejects(
    runGuarded(req, async () => 'not reached'),
    (err) => err.status === 429 && err.code === 'llm_rate_limit'
  );
});

test('guest cannot reset the limit by rotating the guest id on the same IP', async () => {
  config.llmGuestRequestsPerHour = 1;

  assert.equal(
    await runGuarded(
      { guest: { id: 'guest-1' }, ip: '203.0.113.10' },
      async () => 'ok'
    ),
    'ok'
  );
  await assert.rejects(
    runGuarded(
      { guest: { id: 'guest-2' }, ip: '203.0.113.10' },
      async () => 'not reached'
    ),
    (err) => err.status === 429
  );
});

const ADMIN = { id: 'admin-1', email: 'admin@example.com' };

// Роутер с общим обработчиком ошибок, как в main.js; личность — вместо identityMiddleware.
async function postIdeaRadar(path, body, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/idea-radar', ideaRadarRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/idea-radar${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  } finally {
    server.close();
  }
}

test('idea-radar operator actions are admin-only, a guest never reaches the LLM guard', async () => {
  config.adminEmails = [ADMIN.email];
  for (const path of ['/polls', '/stories', '/gov-texts', '/mark']) {
    const res = await postIdeaRadar(path, { limit: 20 }, null);
    assert.equal(res.status, 403, path);
  }
  assert.equal(__test.buckets.size, 0);
});

test('idea-radar /mark spends the same LLM quota as other routes', async () => {
  config.adminEmails = [ADMIN.email];
  config.llmUserRequestsPerHour = 1;
  // Квоту этого пользователя уже потратил другой LLM-route.
  await runGuarded({ user: ADMIN }, async () => 'ok');

  // Без ключа — серверный ключ; до разметки и БД запрос не доходит.
  const res = await postIdeaRadar('/mark', { limit: 20 }, ADMIN);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.match(res.body.error, /Лимит LLM/);
});

test('idea-radar /mark waits for a free LLM slot', async () => {
  config.adminEmails = [ADMIN.email];
  config.llmMaxConcurrent = 0;
  const res = await postIdeaRadar('/mark', { limit: 5 }, ADMIN);
  assert.equal(res.status, 503);
});
