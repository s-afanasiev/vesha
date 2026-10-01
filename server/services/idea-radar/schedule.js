// Опрос по таймеру — выключен по умолчанию (IDEA_RADAR_POLL_EVERY_MIN=0).
// Ленты региональных СМИ помнят около суток, поэтому для рядов по неделям опрос нужен хотя бы раз в день.
const config = require('../../config');
const { refreshAll } = require('./refresh');

const FIRST_POLL_DELAY_MS = 30 * 1000;

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

  const tick = () =>
    refreshAll()
      .then(({ results, stories }) => console.log('idea-radar poll:', summarize(results, stories)))
      .catch((err) => console.warn('idea-radar poll failed:', err.message));

  setTimeout(tick, FIRST_POLL_DELAY_MS).unref();
  const timer = setInterval(tick, everyMin * 60 * 1000);
  timer.unref();
  console.log(`idea-radar: опрос лент каждые ${everyMin} мин`);
  return timer;
}

module.exports = {
  startIdeaRadarSchedule,
};
