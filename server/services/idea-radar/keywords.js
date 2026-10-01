// Примитивный счётчик фазы 1: сколько публикаций в неделю упоминают синонимы ниш.
// Чистое действие (П15): вход — тексты публикаций (matchableText) и словарь,
// выход — таблица; БД и HTTP не знает.
// Неделя — с понедельника по московскому времени; публикации без даты не считаются.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function weekStart(date) {
  const msk = new Date(date.getTime() + MOSCOW_OFFSET_MS);
  const sinceMonday = (msk.getUTCDay() + 6) % 7;
  return new Date(msk.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

// Последние `count` недель, от старой к текущей.
function lastWeeks(now, count) {
  const current = new Date(`${weekStart(now)}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(current.getTime() - (count - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10)
  );
}

function weekStartsAt(week) {
  return new Date(`${week}T00:00:00+03:00`);
}

function weeklyNicheCounts({ publications, niches, matchNiches, weeks }) {
  const column = new Map(weeks.map((week, i) => [week, i]));
  const empty = () => weeks.map(() => 0);
  const totals = empty();
  const counts = new Map(niches.map((niche) => [niche.slug, empty()]));

  for (const pub of publications) {
    if (!pub.publishedAt) continue;
    const i = column.get(weekStart(new Date(pub.publishedAt)));
    if (i === undefined) continue;
    totals[i] += 1;
    for (const { slug } of matchNiches(pub.text)) {
      counts.get(slug)[i] += 1;
    }
  }

  return {
    weeks,
    totals,
    niches: niches.map((niche) => {
      const row = counts.get(niche.slug);
      return {
        slug: niche.slug,
        title: niche.title,
        parentSlug: niche.parentSlug,
        counts: row,
        total: row.reduce((sum, n) => sum + n, 0),
      };
    }),
  };
}

module.exports = {
  weekStart,
  lastWeeks,
  weekStartsAt,
  weeklyNicheCounts,
};
