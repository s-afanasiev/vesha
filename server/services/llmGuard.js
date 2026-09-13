const config = require('../config');

const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map();
let activeRequests = 0;

function subjects(req) {
  if (req.user && req.user.id) return [{ key: `user:${req.user.id}`, isGuest: false }];
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const owners = [{ key: `ip:${ip}`, isGuest: true }];
  if (req.guest && req.guest.id) {
    owners.unshift({ key: `guest:${req.guest.id}`, isGuest: true });
  }
  return owners;
}

function cleanup(now) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(key);
  }
}

function assertRateLimit(req) {
  const now = Date.now();
  cleanup(now);
  const owners = subjects(req);
  const limit = owners[0].isGuest
    ? config.llmGuestRequestsPerHour
    : config.llmUserRequestsPerHour;
  const states = owners.map((owner) => {
    const previous = buckets.get(owner.key);
    const bucket =
      !previous || now - previous.startedAt >= WINDOW_MS
        ? { startedAt: now, count: 0 }
        : previous;
    return { owner, bucket };
  });
  const exhausted = states.find(({ bucket }) => bucket.count >= limit);
  if (exhausted) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((exhausted.bucket.startedAt + WINDOW_MS - now) / 1000)
    );
    const err = new Error(
      exhausted.owner.isGuest
        ? `Гостевой лимит LLM: ${limit} запросов в час. Войдите или повторите позже.`
        : `Лимит LLM: ${limit} запросов в час. Повторите позже.`
    );
    err.status = 429;
    err.code = 'llm_rate_limit';
    err.retryAfterSec = retryAfterSec;
    throw err;
  }
  for (const { owner, bucket } of states) {
    bucket.count += 1;
    buckets.set(owner.key, bucket);
  }
  const used = Math.max(...states.map(({ bucket }) => bucket.count));
  return { limit, remaining: Math.max(0, limit - used) };
}

async function runGuarded(req, task) {
  if (activeRequests >= config.llmMaxConcurrent) {
    const err = new Error('Все LLM-слоты заняты. Повторите через несколько секунд.');
    err.status = 503;
    err.code = 'llm_busy';
    throw err;
  }
  const quota = assertRateLimit(req);
  activeRequests += 1;
  try {
    return await task(quota);
  } finally {
    activeRequests -= 1;
  }
}

function snapshot() {
  return {
    active: activeRequests,
    maxConcurrent: config.llmMaxConcurrent,
  };
}

module.exports = {
  runGuarded,
  snapshot,
  __test: {
    assertRateLimit,
    buckets,
  },
};
