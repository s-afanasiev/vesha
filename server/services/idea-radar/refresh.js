// «Опрос → склейка сюжетов» — родитель порядка (П21): pollAll не знает про сюжеты,
// сюжеты не знают про HTTP. Через него идут оба зачинщика — ручная ручка и таймер.
const { pollAll } = require('./poller');
const { rebuildStories } = require('./stories');

async function refreshAll(options = {}) {
  const results = await pollAll(options);
  const fresh = results.reduce((sum, r) => sum + (r.itemsNew || 0), 0);
  if (!fresh) return { results, stories: null };
  return { results, stories: await rebuildStories() };
}

module.exports = { refreshAll };
