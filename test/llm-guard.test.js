const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { runGuarded, __test } = require('../server/services/llmGuard');

const originalGuestLimit = config.llmGuestRequestsPerHour;
const originalConcurrent = config.llmMaxConcurrent;

test.afterEach(() => {
  config.llmGuestRequestsPerHour = originalGuestLimit;
  config.llmMaxConcurrent = originalConcurrent;
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
