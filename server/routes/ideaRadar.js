// /api/idea-radar — фаза 1: источники, ручной опрос, лента, примитивный счётчик ниш.
// Ручки тонкие: ошибки ловит общий обработчик в main.js (Express 5 передаёт ему отклонённые промисы).
const express = require('express');
const config = require('../config');
const { refreshAll } = require('../services/idea-radar/refresh');
const { rebuildStories } = require('../services/idea-radar/stories');
const { deliverPendingActs } = require('../services/idea-radar/govTexts');
const { listSources, listPublications, publicationsSince } = require('../services/idea-radar/store');
const { getStorageInfo } = require('../services/storageInfo');
const { lastWeeks, weekStartsAt, weeklyNicheCounts } = require('../services/idea-radar/keywords');
const { buildNoiseRule } = require('../services/idea-radar/relevance');
const { loadNiches, buildNicheMatcher, matchableText } = require('../services/radar/niches');

const router = express.Router();

// Фильтр по нише считается в JS по свежему окну ленты — на объёмах фазы 1 этого хватает.
const NICHE_FILTER_WINDOW = 3000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function intParam(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function textParam(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 200) : null;
}

function weekRange(week) {
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return {};
  const from = weekStartsAt(week);
  if (!Number.isFinite(from.getTime())) return {};
  return { from, to: new Date(from.getTime() + WEEK_MS) };
}

router.get('/sources', async (_req, res) => {
  res.json({ sources: await listSources() });
});

// Свободное место на диске данных: ряды растут с включённым таймером опроса.
// На сервере путь к растущему тому задаётся DISK_INFO_PATH (fs.statfs работает
// и на Windows, и на Linux — проверено в alpine-контейнере).
router.get('/disk', (_req, res) => {
  res.json({ disk: getStorageInfo(config.diskInfoPath) });
});

router.post('/polls', async (req, res) => {
  const { results, stories } = await refreshAll({ sourceSlug: textParam(req.body && req.body.source) });
  res.json({ results, stories, sources: await listSources() });
});

// Ручная пересборка сюжетов по всему корпусу (после опроса происходит сама).
router.post('/stories', async (_req, res) => {
  res.json({ stories: await rebuildStories() });
});

// Доставка текста госактов: батч за раз, повтор безопасен — берёт только пустые body.
router.post('/gov-texts', async (req, res) => {
  const limit = intParam(req.body && req.body.limit, config.ideaRadarGovTextsBatch, 1, 200);
  res.json({ delivery: await deliverPendingActs({ limit }) });
});

router.get('/publications', async (req, res) => {
  const limit = intParam(req.query.limit, 50, 1, 200);
  const offset = intParam(req.query.offset, 0, 0, 100000);
  const niche = textParam(req.query.niche);
  const filters = {
    sourceSlug: textParam(req.query.source),
    q: textParam(req.query.q),
    ...weekRange(textParam(req.query.week)),
  };
  const matchNiches = buildNicheMatcher(await loadNiches());
  const noise = buildNoiseRule();
  // Лента отдаёт сырой meta; правило ждёт рубрики — приводим форму один раз.
  const noiseVerdictOf = (pub) => noise({ categories: (pub.meta && pub.meta.categories) || [] });

  let items;
  let hasMore;
  if (niche) {
    // Фильтр ниши считает так же, как счётчик: шумовые рубрики мимо (И2).
    const window = await listPublications({ ...filters, limit: NICHE_FILTER_WINDOW, offset: 0 });
    const matched = window.filter(
      (pub) =>
        noiseVerdictOf(pub).relevance !== 'off_topic' &&
        matchNiches(matchableText(pub)).some((verdict) => verdict.slug === niche)
    );
    items = matched.slice(offset, offset + limit);
    hasMore = matched.length > offset + limit;
  } else {
    const rows = await listPublications({ ...filters, limit: limit + 1, offset });
    items = rows.slice(0, limit);
    hasMore = rows.length > limit;
  }

  res.json({
    items: items.map((pub) => {
      const verdicts = matchNiches(matchableText(pub));
      const noiseVerdict = noiseVerdictOf(pub);
      return {
        ...pub,
        niches: verdicts.map((v) => v.slug),
        nicheHits: verdicts,
        relevance: noiseVerdict.relevance,
        relevanceReason: noiseVerdict.reason,
      };
    }),
    hasMore,
  });
});

router.get('/keywords', async (req, res) => {
  const weeks = lastWeeks(new Date(), intParam(req.query.weeks, 8, 1, 26));
  const niches = await loadNiches();
  const noise = buildNoiseRule();
  const publications = (await publicationsSince(weekStartsAt(weeks[0])))
    .filter((pub) => noise(pub).relevance !== 'off_topic')
    .map((pub) => ({
      text: matchableText(pub),
      publishedAt: pub.publishedAt,
      region: pub.region,
      regionName: pub.regionName,
    }));
  res.json(
    weeklyNicheCounts({ publications, niches, matchNiches: buildNicheMatcher(niches), weeks })
  );
});

module.exports = router;
