// Чтение корпуса радара идей для API: источники со снимком последнего опроса, лента публикаций.
const db = require('../../db');
const config = require('../../config');
const { INTERRUPTED_CODE } = require('../collectors/states');

// Опрос без finished_at дольше дедлайна — процесс умер посреди опроса (перезапуск сервера).
// Состояние вычисляется при чтении, сторож его не переписывает.
const INTERRUPTED_GRACE_MS = 30 * 1000;

// Активен источник — внутри периода активности; правило одно на всех читателей
// idea_radar_sources (poller.js берёт отсюда же).
function activeSourceWhere(alias = '') {
  return `${alias}active_from <= now() AND (${alias}active_to IS NULL OR ${alias}active_to >= now())`;
}

function pollSnapshot(row) {
  const snapshot = {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
    itemsSeen: row.items_seen,
    itemsNew: row.items_new,
    errorCode: row.error_code,
    error: row.error,
  };
  const age = Date.now() - new Date(row.started_at).getTime();
  if (!row.finished_at && age > config.ideaRadarPollDeadlineMs + INTERRUPTED_GRACE_MS) {
    snapshot.outcome = 'failed';
    snapshot.errorCode = INTERRUPTED_CODE;
    snapshot.error = 'Опрос прерван: сервер перезапустился посреди опроса';
  }
  return snapshot;
}

function likePattern(q) {
  const text = String(q || '').trim();
  if (!text) return null;
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

async function listSources() {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.kind, s.name, s.site_url, s.adapter, s.rubric,
            r.name AS region_name, n.title AS niche_hint,
            lp.started_at, lp.finished_at, lp.outcome, lp.items_seen, lp.items_new,
            lp.error_code, lp.error,
            st.total, st.dated, st.latest_published_at,
            h.polls_3d, h.failed_3d
     FROM idea_radar_sources s
     LEFT JOIN radar_regions r ON r.id = s.region_id
     LEFT JOIN radar_niches n ON n.id = s.niche_hint_id
     LEFT JOIN LATERAL (
       SELECT * FROM idea_radar_polls p
       WHERE p.source_id = s.id ORDER BY p.started_at DESC LIMIT 1
     ) lp ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total, count(published_at)::int AS dated,
              max(published_at) AS latest_published_at
       FROM idea_radar_publications pub WHERE pub.source_id = s.id
     ) st ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS polls_3d,
              count(*) FILTER (
                WHERE outcome = 'failed'
                   OR (finished_at IS NULL AND started_at < now() - make_interval(secs => $1))
              )::int AS failed_3d
       FROM idea_radar_polls p
       WHERE p.source_id = s.id AND p.started_at > now() - interval '3 days'
     ) h ON true
     WHERE ${activeSourceWhere('s.')}
     ORDER BY s.sort_order`,
    [(config.ideaRadarPollDeadlineMs + INTERRUPTED_GRACE_MS) / 1000]
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    siteUrl: row.site_url,
    adapter: row.adapter,
    rubric: row.rubric,
    region: row.region_name,
    nicheHint: row.niche_hint,
    total: row.total,
    dated: row.dated,
    latestPublishedAt: row.latest_published_at,
    health: { polls3d: row.polls_3d, failed3d: row.failed_3d },
    lastPoll: row.started_at ? pollSnapshot(row) : null,
  }));
}

function toPublication(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    lead: row.lead,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    meta: row.meta,
    source: { slug: row.source_slug, name: row.source_name, kind: row.source_kind },
  };
}

// Новые сверху; без даты публикации — в конце.
async function listPublications({ sourceSlug, q, from, to, limit, offset }) {
  const { rows } = await db.query(
    `SELECT p.id, p.url, p.title, p.lead, p.published_at, p.fetched_at, p.meta,
            s.slug AS source_slug, s.name AS source_name, s.kind AS source_kind
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE ($1::text IS NULL OR s.slug = $1)
       AND ($2::text IS NULL OR p.title ILIKE $2 OR p.lead ILIKE $2)
       AND ($3::timestamptz IS NULL OR p.published_at >= $3)
       AND ($4::timestamptz IS NULL OR p.published_at < $4)
     ORDER BY p.published_at DESC NULLS LAST, p.fetched_at DESC, p.id
     LIMIT $5 OFFSET $6`,
    [sourceSlug || null, likePattern(q), from || null, to || null, limit, offset]
  );
  return rows.map(toPublication);
}

// Тексты для счётчика с профилем источника: рубрики и регион потока.
async function publicationsSince(since) {
  const { rows } = await db.query(
    `SELECT p.title, p.lead, p.meta, p.published_at, r.code AS region_code, r.name AS region_name
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     LEFT JOIN radar_regions r ON r.id = s.region_id
     WHERE p.published_at >= $1 AND s.kind <> 'serendipity'`,
    [since]
  );
  return rows.map((row) => ({
    title: row.title,
    lead: row.lead,
    categories: (row.meta && row.meta.categories) || [],
    region: row.region_code || 'unknown',
    regionName: row.region_name || row.region_code || null,
    publishedAt: row.published_at,
  }));
}

module.exports = {
  listSources,
  listPublications,
  publicationsSince,
  activeSourceWhere,
};
