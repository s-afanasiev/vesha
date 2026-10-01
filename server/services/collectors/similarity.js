// Похожесть двух записей — способность каркаса сбора (П9): Жаккар по символьным
// триграммам нормализованного текста. Доменных слов не знает; потребители — склейка
// перепечаток idea-radar и будущая дедупликация отзывов pain-radar с двух карт.
function normalizeForMatch(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function trigrams(text) {
  const padded = `  ${text} `;
  const set = new Set();
  for (let i = 0; i <= padded.length - 3; i += 1) set.add(padded.slice(i, i + 3));
  return set;
}

// 0..1. Замер на живых данных (02.10.2026): перепечатка одного события — 0.39,
// разные события одной темы — 0.10–0.14, разные темы — 0.15 и ниже.
function trigramJaccard(a, b) {
  const textA = normalizeForMatch(a);
  const textB = normalizeForMatch(b);
  if (!textA || !textB) return 0;
  const setA = trigrams(textA);
  const setB = trigrams(textB);
  let common = 0;
  for (const gram of setA) if (setB.has(gram)) common += 1;
  return common / (setA.size + setB.size - common);
}

module.exports = {
  normalizeForMatch,
  trigramJaccard,
};
