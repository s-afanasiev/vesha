// Опрос по таймеру — включён (IDEA_RADAR_POLL_EVERY_MIN=360, раз в 6 часов).
// Ленты региональных СМИ помнят около суток — для рядов по неделям нужен хотя бы
// ежедневный опрос. Доставку текстов госактов в таймер сознательно не включали.
const config = require('../../config');
const { refreshAll } = require('./refresh');

const FIRST_POLL_DELAY_MS = 30 * 1000;

let nextPollAtMs = null;

// Снимок расписания для UI: когда будет следующий автоматический опрос.
function scheduleInfo() {
  return {
    pollEveryMin: config.ideaRadarPollEveryMin,
    nextPollAt: nextPollAtMs ? new Date(nextPollAtMs).toISOString() : null,
  };
}

function summarize(results, stories) {
  const polls = results
    .map((r) => `${r.slug}: ${r.outcome}${r.itemsNew ? ` +${r.itemsNew}` : ''}`)
    .join(', ');
  const clustered = stories
    ? `; сюжетов: ${stories.stories} (мультиисточниковых ${stories.multiSource})`
    : '';
  return `${polls}${clustered}`;
}

function startIdeaRadarSchedule() {
  const everyMin = config.ideaRadarPollEveryMin;
  if (!everyMin || everyMin <= 0) return null;
  const intervalMs = everyMin * 60 * 1000;

  nextPollAtMs = Date.now() + FIRST_POLL_DELAY_MS;
  const tick = () => {
    nextPollAtMs = Date.now() + intervalMs;
    refreshAll()
      .then(({ results, stories }) => console.log('idea-radar poll:', summarize(results, stories)))
      .catch((err) => console.warn('idea-radar poll failed:', err.message));
  };

  setTimeout(tick, FIRST_POLL_DELAY_MS).unref();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  console.log(`idea-radar: опрос лент каждые ${everyMin} мин`);
  return timer;
}

module.exports = {
  startIdeaRadarSchedule,
  scheduleInfo,
};
