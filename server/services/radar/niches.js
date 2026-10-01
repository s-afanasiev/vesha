// Общий слой радаров: словарь ниш. Радары читают его, но не пишут (docs/idea-radar-architecture.md).
const db = require('../../db');

async function loadNiches() {
  const { rows } = await db.query(
    `SELECT n.id, n.slug, n.title, n.aliases, n.excludes, n.sort_order, p.slug AS parent_slug
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
    excludes: row.excludes || [],
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
// Хвост после последнего слова не нужен: «шиномонтаж» в конце заголовка тоже считается.
function aliasPattern(alias) {
  const words = normalizeText(alias).trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\p{L}\\p{N}]*[^\\p{L}\\p{N}]+')}[\\p{L}\\p{N}]*`, 'u');
}

// Текст публикации, по которому ищутся ниши; правило одно для ленты и счётчика.
function matchableText(publication) {
  return [publication.title, publication.lead].filter(Boolean).join(' ');
}

// Чистое действие: текст → вердикты ниш с причиной (П14). Вердикт — { slug, hits },
// hit называет сработавший синоним и совпавший текст; у hit, принесённого родителю
// ребёнком, заполнен viaSlug. Исключения ниши и её предков снимают срабатывание —
// такая ниша в ответ не попадает. Порядок — как в словаре, родители раньше детей.
function buildNicheMatcher(niches) {
  const bySlug = new Map(niches.map((niche) => [niche.slug, niche]));
  const compiled = niches.map((niche) => {
    const ancestors = ancestorsOf(niche, bySlug);
    const patterns = (list) =>
      (list || []).map((alias) => ({ alias, pattern: aliasPattern(alias) })).filter((x) => x.pattern);
    return {
      niche,
      aliases: patterns(niche.aliases),
      allExcludes: [...ancestors, niche].flatMap((n) => patterns(n.excludes)),
      ancestors,
    };
  });

  return function matchNiches(text) {
    const haystack = normalizeText(text);
    const verdicts = new Map();

    const confirm = (slug, hit) => {
      const verdict = verdicts.get(slug) || { slug, hits: [] };
      // Один и тот же текст ловят несколько синонимов («шиномонтаж» и «шин») —
      // остаётся самый длинный, самый конкретный.
      const twin = verdict.hits.find((h) => h.matchedText === hit.matchedText);
      if (twin) {
        if (hit.alias.length > twin.alias.length) Object.assign(twin, hit);
      } else {
        verdict.hits.push(hit);
      }
      verdicts.set(slug, verdict);
    };

    for (const { niche, aliases, ancestors } of compiled) {
      for (const { alias, pattern } of aliases) {
        const found = pattern.exec(haystack);
        if (!found) continue;
        confirm(niche.slug, { alias, matchedText: found[0] });
        for (const parent of ancestors) {
          confirm(parent.slug, { alias, matchedText: found[0], viaSlug: niche.slug });
        }
      }
    }

    return compiled
      .filter(
        ({ niche, allExcludes }) =>
          verdicts.has(niche.slug) && !allExcludes.some(({ pattern }) => pattern.test(haystack))
      )
      .map(({ niche }) => verdicts.get(niche.slug));
  };
}

function ancestorsOf(niche, bySlug) {
  const chain = [];
  const seen = new Set([niche.slug]);
  let parent = niche.parentSlug ? bySlug.get(niche.parentSlug) : null;
  while (parent && !seen.has(parent.slug)) {
    chain.push(parent);
    seen.add(parent.slug);
    parent = parent.parentSlug ? bySlug.get(parent.parentSlug) : null;
  }
  return chain;
}

module.exports = {
  loadNiches,
  buildNicheMatcher,
  matchableText,
  normalizeText,
};
