// Опрос лент. Единица работы — опрос одного источника: на её границе ошибка становится
// строкой idea_radar_polls, а не падением всего опроса (П24).
const db = require('../../db');
const config = require('../../config');
const ADAPTERS = require('../collectors/adapters');
const { contentHash } = require('../collectors/text');
const { POLL_OUTCOMES, SKIP_OUTCOME, SKIP_CODES, DEADLINE_CODE } = require('../collectors/states');
const { activeSourceWhere } = require('./store');

const running = new Set();

async function activeSources(sourceSlug) {
  const { rows } = await db.query(
    `SELECT id, slug, name, adapter, settings
     FROM idea_radar_sources
     WHERE ${activeSourceWhere()} AND ($1::text IS NULL OR slug = $1)
     ORDER BY sort_order`,
    [sourceSlug || null]
  );
  return rows;
}

async function secondsSinceLastPoll(sourceId) {
  const { rows } = await db.query(
    `SELECT EXTRACT(EPOCH FROM (now() - max(started_at)))::int AS seconds
     FROM idea_radar_polls WHERE source_id = $1`,
    [sourceId]
  );
  return rows[0].seconds;
}

async function saveItems(sourceId, pollId, items) {
  let fresh = 0;
  for (const item of items) {
    const { rowCount } = await db.query(
      `INSERT INTO idea_radar_publications
         (source_id, external_id, url, title, lead, body, published_at, first_poll_id, content_hash, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source_id, external_id) DO NOTHING`,
      [
        sourceId,
        item.externalId,
        item.url,
        item.title,
        item.lead || null,
        item.body || null,
        item.publishedAt,
        pollId,
        contentHash(item.title, item.lead),
        item.meta || {},
      ]
    );
    fresh += rowCount;
  }
  return fresh;
}

function skipped(source, code, reason, retryInSec) {
  return { sourceId: source.id, slug: source.slug, outcome: SKIP_OUTCOME, code, reason, retryInSec };
}

async function runPoll(source, adapter, signal) {
  const { rows } = await db.query(
    'INSERT INTO idea_radar_polls (source_id) VALUES ($1) RETURNING id',
    [source.id]
  );
  const pollId = rows[0].id;
  const deadline = AbortSignal.timeout(config.ideaRadarPollDeadlineMs);
  const ctx = {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    pageTimeoutMs: config.ideaRadarPageTimeoutMs,
    maxBytes: config.ideaRadarMaxBytes,
  };

  let itemsSeen = 0;
  let itemsNew = 0;
  let outcome = POLL_OUTCOMES.OK;
  let errorCode = null;
  let error = null;
  try {
    for await (const items of adapter.pages(source, ctx)) {
      const fresh = await saveItems(source.id, pollId, items);
      itemsSeen += items.length;
      itemsNew += fresh;
      if (fresh === 0) break; // дальше только уже известное
    }
  } catch (err) {
    outcome = itemsSeen > 0 ? POLL_OUTCOMES.PARTIAL : POLL_OUTCOMES.FAILED;
    errorCode = deadline.aborted ? DEADLINE_CODE : err.code || 'error';
    error = deadline.aborted
      ? `Опрос не уложился в ${config.ideaRadarPollDeadlineMs / 1000} с`
      : err.message;
  }

  await db.query(
    `UPDATE idea_radar_polls
     SET finished_at = now(), outcome = $2, items_seen = $3, items_new = $4, error_code = $5, error = $6
     WHERE id = $1`,
    [pollId, outcome, itemsSeen, itemsNew, errorCode, error]
  );
  return { sourceId: source.id, slug: source.slug, outcome, itemsSeen, itemsNew, errorCode, error };
}

async function pollSource(source, { signal } = {}) {
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) return skipped(source, SKIP_CODES.UNKNOWN_ADAPTER, `адаптер «${source.adapter}» не подключён`);
  if (running.has(source.id)) return skipped(source, SKIP_CODES.ALREADY_RUNNING, 'опрос уже идёт');

  running.add(source.id);
  try {
    const since = await secondsSinceLastPoll(source.id);
    const minInterval = config.ideaRadarMinPollIntervalSec;
    if (since !== null && since < minInterval) {
      return skipped(source, SKIP_CODES.MIN_INTERVAL, 'слишком рано', minInterval - since);
    }
    return await runPoll(source, adapter, signal);
  } finally {
    running.delete(source.id);
  }
}

// Все активные источники параллельно: хосты разные, у каждого свой минимальный интервал.
async function pollAll({ sourceSlug, signal } = {}) {
  const sources = await activeSources(sourceSlug);
  if (sourceSlug && !sources.length) {
    const err = new Error('Источник не найден');
    err.status = 404;
    throw err;
  }
  return Promise.all(sources.map((source) => pollSource(source, { signal })));
}

module.exports = {
  pollAll,
};
