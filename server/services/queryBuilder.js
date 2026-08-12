function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

function uniqStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).replace(/\s+/g, ' ').trim());
  }
  return out;
}

function genderWord(gender) {
  const g = String(gender || '').toLowerCase();
  if (g.includes('муж')) return 'мужские';
  if (g.includes('жен')) return 'женские';
  return '';
}

function joinParts(parts) {
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build layered search queries from vision attributes.
 * Returns { bases: string[], queries: string[] } where queries include site: variants.
 */
function buildSearchPlan(attributes = {}) {
  const category = String(attributes.category || '').trim();
  const colors = asList(attributes.colors).filter((c) => !/неизвест|неясн|нет/i.test(c));
  const color = colors[0] || '';
  const gender = genderWord(attributes.gender);
  const distinctive = asList(attributes.distinctive_features).slice(0, 4);
  const keyFeatures = asList(attributes.key_features);
  const features = uniqStrings([...distinctive, ...keyFeatures]).slice(0, 5);
  const brand = String(attributes.brand || '').trim();
  const pattern =
    attributes.pattern && !/однотон|неясн|другое/i.test(attributes.pattern)
      ? String(attributes.pattern).trim()
      : '';

  const bases = [];

  // 1) precise — category + color + gender + top features
  const precise = joinParts([
    gender,
    color,
    category || 'одежда',
    brand,
    pattern,
    ...features.slice(0, 3),
  ]);
  if (precise) bases.push(precise);

  // 2) feature-focus — category + 1-2 distinctive features (less fluff)
  const focus = joinParts([
    category || 'одежда',
    ...(features.slice(0, 2).length ? features.slice(0, 2) : features.slice(0, 1)),
    color,
  ]);
  if (focus && focus !== precise) bases.push(focus);

  // 3) second feature pair if we have more details
  if (features.length >= 3) {
    const focus2 = joinParts([category || 'одежда', features[0], features[2], gender]);
    if (focus2 && !bases.includes(focus2)) bases.push(focus2);
  }

  // 4) model-provided queries (if they add new signal)
  for (const q of asList(attributes.search_queries).slice(0, 3)) {
    bases.push(q);
  }

  // 5) broad fallback
  const broad = joinParts([gender, color, category || 'одежда']);
  if (broad) bases.push(broad);

  const uniqueBases = uniqStrings(bases).slice(0, 4);
  if (!uniqueBases.length) uniqueBases.push('купить одежду');

  // Expand with marketplace site filters; prefer precise bases first
  const queries = [];
  for (const q of uniqueBases.slice(0, 2)) {
    queries.push(q);
    queries.push(`${q} site:wildberries.ru`);
    queries.push(`${q} site:ozon.ru`);
  }
  // Keep one extra base without site: if we have room (broader recall)
  if (uniqueBases[2] && queries.length < 7) {
    queries.push(uniqueBases[2]);
  }

  return {
    bases: uniqueBases,
    queries: uniqStrings(queries).slice(0, 7),
    features,
  };
}

function featureMatchTokens(attributes = {}) {
  const tokens = uniqStrings([
    ...asList(attributes.distinctive_features),
    ...asList(attributes.key_features),
    ...asList(attributes.colors),
    attributes.category,
    attributes.pattern && !/однотон|неясн|другое/i.test(attributes.pattern)
      ? attributes.pattern
      : null,
    attributes.brand,
  ])
    .flatMap((phrase) => {
      const words = String(phrase)
        .toLowerCase()
        .split(/[\s,./\\|+]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4);
      return [String(phrase).toLowerCase(), ...words];
    })
    .filter(Boolean);

  return uniqStrings(tokens);
}

function rerankOffers(offers, attributes = {}) {
  const tokens = featureMatchTokens(attributes);
  if (!tokens.length) {
    return [...offers].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  return offers
    .map((o) => {
      const hay = `${o.title || ''} ${o.snippet || ''}`.toLowerCase();
      let hits = 0;
      let phraseHits = 0;
      for (const t of tokens) {
        if (!hay.includes(t)) continue;
        hits += 1;
        if (t.includes(' ')) phraseHits += 1;
      }
      // Phrase matches (e.g. «карманы на молнии») outweigh generic SERP rank
      const bonus = Math.min(1.2, hits * 0.1 + phraseHits * 0.25);
      return {
        ...o,
        score: (o.score || 0) + bonus,
        featureHits: hits,
      };
    })
    .sort((a, b) => {
      if ((b.featureHits || 0) !== (a.featureHits || 0)) {
        return (b.featureHits || 0) - (a.featureHits || 0);
      }
      return (b.score || 0) - (a.score || 0);
    });
}

module.exports = {
  buildSearchPlan,
  rerankOffers,
  featureMatchTokens,
};
