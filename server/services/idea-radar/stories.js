// Склейка перепечаток в сюжеты (И10, ступень B): одно событие, покрытое несколькими
// изданиями, — один сигнал с известным охватом. Похожесть — каркас (collectors/similarity),
// сюжет — домен idea-radar. Решение отдельно от применения (П15): кластеризация — чистое
// действие, запись — отдельный проход в транзакции. Полная пересборка — только пока на
// сюжеты не ссылаются сдвиги и журнал разметки; дальше — мягкое прикрепление новых
// публикаций (удаление сюжета каскадом стёрло бы разметку; П26, П32).
const db = require('../../db');
const { trigramJaccard } = require('../collectors/similarity');

const DAY_MS = 24 * 60 * 60 * 1000;

// Правило-вердикт (П14): пара записей — дубликат или нет, с причиной.
// Порог — параметр в декларации (П6), замер на живых данных: 0.3 разделяет
// перепечатку (0.39) и разные события одной темы (до 0.14).
function buildDuplicateRule({ threshold = 0.3 } = {}) {
  return function duplicateRule(pair) {
    if (pair.similarity >= threshold) {
      return { duplicate: true, reason: `заголовки схожи на ${pair.similarity.toFixed(2)}` };
    }
    return { duplicate: false, reason: null };
  };
}

// Чистое действие: датированные публикации → кластеры; БД и HTTP не знает.
// Склейка живёт в окне ±windowDays; публикация присоединяется к кластеру
// с максимальной схожестью среди его участников окна. Публикации без даты
// не склеиваются — окно им не определить.
function clusterStories({ publications, windowDays = 3, rule, similarity = trigramJaccard }) {
  const dated = publications
    .filter((pub) => pub.publishedAt && pub.title)
    .sort((a, b) => a.publishedAt - b.publishedAt || String(a.id).localeCompare(String(b.id)));

  const clusters = [];
  for (const pub of dated) {
    let best = null;
    for (const cluster of clusters) {
      for (const member of cluster.members) {
        const gap = Math.abs(pub.publishedAt.getTime() - member.publishedAt.getTime());
        if (gap > windowDays * DAY_MS) continue;
        const sim = similarity(pub.title, member.title);
        const verdict = rule({ similarity: sim });
        if (verdict.duplicate && (!best || sim > best.similarity)) {
          best = { cluster, similarity: sim };
        }
      }
    }
    if (best) best.cluster.members.push(pub);
    else clusters.push({ members: [pub] });
  }

  return clusters.map((cluster) => ({
    pubIds: cluster.members.map((m) => m.id),
    seedTitle: cluster.members[0].title,
    firstPublishedAt: cluster.members[0].publishedAt,
    sources: new Set(cluster.members.map((m) => m.sourceId)).size,
  }));
}

// Пересборка: полная, только пока на сюжеты не ссылаются сдвиги и журнал разметки
// (их удаление каскадом стёр бы разметку). После появления ссылок — только мягкое
// прикрепление новых публикаций к существующим сюжетам или новым (П26, П32).
async function rebuildStories({ windowDays = 3, threshold } = {}) {
  const rule = buildDuplicateRule({ threshold });
  const { rows: refs } = await db.query(
    `SELECT (EXISTS(SELECT 1 FROM idea_radar_shifts)
          OR EXISTS(SELECT 1 FROM idea_radar_markings)) AS has_refs`
  );
  if (refs[0].has_refs) return attachNewPublications({ windowDays, rule });
  return fullRebuild({ windowDays, rule });
}

async function fullRebuild({ windowDays, rule }) {
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.published_at, s.id AS source_id
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE p.published_at IS NOT NULL AND s.kind <> 'serendipity'`
  );

  const clusters = clusterStories({
    publications: rows.map((row) => ({
      id: row.id,
      title: row.title,
      publishedAt: row.published_at,
      sourceId: row.source_id,
    })),
    windowDays,
    rule,
  });

  const examples = [];
  const summary = await db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM idea_radar_stories'); // FK обнуляет story_id у публикаций
      let clustered = 0;
      let multiSource = 0;
      for (const cluster of clusters) {
        const { rows: created } = await client.query(
          'INSERT INTO idea_radar_stories (title) VALUES ($1) RETURNING id',
          [cluster.seedTitle]
        );
        await client.query(
          'UPDATE idea_radar_publications SET story_id = $1 WHERE id = ANY($2::uuid[])',
          [created[0].id, cluster.pubIds]
        );
        clustered += cluster.pubIds.length;
        if (cluster.sources > 1) {
          multiSource += 1;
          examples.push({ title: cluster.seedTitle, sources: cluster.sources, copies: cluster.pubIds.length });
        }
      }
      await client.query('COMMIT');
      return { stories: clusters.length, clustered, multiSource };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  return {
    ...summary,
    singles: summary.stories - summary.multiSource,
    examples: examples.sort((a, b) => b.copies - a.copies).slice(0, 5),
  };
}

// Мягкий путь: публикации без сюжета прикрепляются к существующим сюжетам в окне
// ±windowDays или образуют новые. Существующие склейки не трогаются.
async function attachNewPublications({ windowDays = 3, rule }) {
  const { rows: fresh } = await db.query(
    `SELECT p.id, p.title, p.published_at, s.id AS source_id
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE p.story_id IS NULL AND p.published_at IS NOT NULL AND s.kind <> 'serendipity'
     ORDER BY p.published_at`
  );

  let attached = 0;
  let created = 0;
  for (const pub of fresh) {
    const { rows: neighbors } = await db.query(
      `SELECT sp.story_id, sp.title
       FROM idea_radar_publications sp
       JOIN idea_radar_sources ss ON ss.id = sp.source_id
       WHERE sp.story_id IS NOT NULL AND ss.kind <> 'serendipity'
         AND sp.published_at BETWEEN $1 AND $2`,
      [new Date(pub.published_at.getTime() - windowDays * DAY_MS), new Date(pub.published_at.getTime() + windowDays * DAY_MS)]
    );
    let best = null;
    for (const neighbor of neighbors) {
      const sim = trigramJaccard(pub.title, neighbor.title);
      const verdict = rule({ similarity: sim });
      if (verdict.duplicate && (!best || sim > best.sim)) best = { storyId: neighbor.story_id, sim };
    }
    if (best) {
      await db.query('UPDATE idea_radar_publications SET story_id = $1 WHERE id = $2', [best.storyId, pub.id]);
      attached += 1;
    } else {
      const { rows: createdStory } = await db.query(
        'INSERT INTO idea_radar_stories (title) VALUES ($1) RETURNING id',
        [pub.title]
      );
      await db.query('UPDATE idea_radar_publications SET story_id = $1 WHERE id = $2', [createdStory[0].id, pub.id]);
      created += 1;
    }
  }

  return {
    mode: 'attach',
    stories: attached + created,
    clustered: fresh.length,
    multiSource: null,
    attached,
    created,
  };
}

module.exports = {
  buildDuplicateRule,
  clusterStories,
  rebuildStories,
};
