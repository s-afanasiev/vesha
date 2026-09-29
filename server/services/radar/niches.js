// Общий слой радаров: словарь ниш. Радары читают его, но не пишут (docs/idea-radar-architecture.md).
const db = require('../../db');

async function loadNiches() {
  const { rows } = await db.query(
    `SELECT n.id, n.slug, n.title, n.aliases, n.sort_order, p.slug AS parent_slug
     FROM radar_niches n
     LEFT JOIN radar_niches p ON p.id = n.parent_id
     WHERE n.status = 'active'
     ORDER BY COALESCE(p.sort_order, n.sort_order), p.sort_order NULLS FIRST, n.sort_order`
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    aliases: row.aliases || [],
    parentSlug: row.parent_slug || null,
  }));
}

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Синоним — начала слов подряд: «ремонт автомоб» находит «ремонт автомобилей».
function aliasPattern(alias) {
  const words = normalizeText(alias).trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\p{L}\\p{N}]*[^\\p{L}\\p{N}]+')}`, 'u');
}

// Чистое действие: текст → ниши, чьи синонимы в нём встречаются.
// Родитель засчитывается, если сработал его синоним или синоним любого ребёнка.
function buildNicheMatcher(niches) {
  const compiled = niches.map((niche) => ({
    niche,
    patterns: niche.aliases.map(aliasPattern).filter(Boolean),
  }));

  return function matchNiches(text) {
    const haystack = normalizeText(text);
    const hit = new Set();
    for (const { niche, patterns } of compiled) {
      if (patterns.some((re) => re.test(haystack))) {
        hit.add(niche.slug);
        if (niche.parentSlug) hit.add(niche.parentSlug);
      }
    }
    return niches.filter((niche) => hit.has(niche.slug)).map((niche) => niche.slug);
  };
}

module.exports = {
  loadNiches,
  buildNicheMatcher,
};
