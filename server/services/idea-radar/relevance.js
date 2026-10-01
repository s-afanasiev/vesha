// Правило рубричного шума (П14, И2): рубрики источника, после которых публикация —
// не про бизнес региона. Вердикт с причиной; «relevant» правило не ставит — это работа
// LLM-разметки фазы 2. Список пополняется по наблюдениям: вердикты видны в ленте.
const { normalizeText } = require('../radar/niches');

// Стемы рубрик, реально встречающихся в лентах (срез 02.10.2026): Происшествия,
// Спорт, Культура, Преступность; криминал, шоу и развлечения — запас под другие ленты.
const NOISE_STEMS = ['спорт', 'происшестви', 'преступност', 'криминал', 'культур', 'шоу', 'развлечен'];

function buildNoiseRule(stems = NOISE_STEMS) {
  const normalized = stems.map((stem) => normalizeText(stem));
  return function noiseRule(publication) {
    for (const category of publication.categories || []) {
      const text = normalizeText(category);
      if (normalized.some((stem) => text.startsWith(stem))) {
        return { relevance: 'off_topic', reason: `рубрика «${category}»` };
      }
    }
    return { relevance: 'unknown', reason: null };
  };
}

module.exports = {
  buildNoiseRule,
  NOISE_STEMS,
};
