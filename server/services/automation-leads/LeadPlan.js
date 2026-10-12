// План лидов — чистое действие (П15): из фактов аудита мест решает, кто лид,
// что ему предложить и почему, — или почему нет. Ничего не пишет и не ходит в
// сеть; тестируется как функция. Балл прозрачен и разложен на три оси:
//   боль — линии сбоя из отзывов (×2), пробел — веса DigitalGaps,
//   досягаемость — реклама в 2ГИС (+1: есть бюджет на цифровое) и ответы
//   владельца на отзывы (+1: читает отзывы, довод из них до него дойдёт).

const { DigitalGaps, LeadRule } = require('./rules');
const { OfferCatalog } = require('./catalogs');

class LeadPlan {
  constructor({ gaps = new DigitalGaps(), rule = new LeadRule(), offers = new OfferCatalog() } = {}) {
    this.gaps = gaps;
    this.rule = rule;
    this.offers = offers;
  }

  decide(audits, niche) {
    const rows = [];
    const unaudited = [];
    for (const audit of audits) {
      if (!audit.ok || !audit.card) {
        unaudited.push({ name: audit.place.name, reason: audit.detail || 'карточки нет' });
        continue;
      }
      rows.push(this._row(audit, niche));
    }
    rows.sort((a, b) => a.order - b.order || b.score - a.score || b.pain - a.pain);
    return { leads: rows, products: this._products(rows), counts: counts(rows, unaudited), unaudited };
  }

  _row({ place, card, site, reviews }, niche) {
    const gaps = this.gaps.of(card, site);
    const lines = [...new Set(reviews.failures.map((f) => f.line))];
    const verdict = this.rule.check({ place, card, gaps, failures: lines });
    const hooks = Object.entries(niche.hooks || {})
      .filter(([, rubrics]) => (place.rubrics || []).some((r) => rubrics.includes(r)))
      .map(([id]) => id);
    const products = verdict.lead ? this.offers.productsFor({ gaps, failures: lines, hooks }) : [];
    const pain = lines.length * 2;
    const gapScore = gaps.reduce((sum, g) => sum + g.weight, 0);
    const reach = (card.promoted ? 1 : 0) + (reviews.answered > 0 ? 1 : 0);
    const quote = firstQuote(reviews.failures);
    return {
      id: place.branch_id,
      name: place.name,
      address: place.address,
      verdict: !verdict.lead ? 'отказ' : verdict.strength === 'strong' ? 'лид: сбой' : 'лид: пробелы',
      strength: verdict.strength,
      reason: verdict.reason,
      products: products.filter((p) => !p.hook).sort((a, b) => b.strong - a.strong).map((p) => p.title).join(', '),
      product_ids: products.map((p) => p.id),
      product_detail: products,
      hooks: products.filter((p) => p.hook)
        .map((p) => (p.strong ? `${p.title} (довод: ${p.evidence.join(', ')})` : `${p.title} (по рубрике)`))
        .join(', '),
      score: verdict.lead ? pain + gapScore + reach : 0,
      pain,
      gap_score: gapScore,
      reach,
      failures: lines.join(', '),
      gaps: gaps.map((g) => g.label).join(', '),
      quote: quote ? `«${quote.quote}» (${quote.date.slice(0, 7)})` : '',
      phone: card.phone,
      site: site.has ? site.url : '',
      site_note: site.has ? '' : 'нет сайта',
      branches: card.branches,
      rating: card.rating,
      reviews_count: card.reviewsCount,
      fresh: reviews.fresh,
      answered: reviews.answered,
      order: !verdict.lead ? 2 : verdict.strength === 'strong' ? 0 : 1,
    };
  }

  // Сводка по продуктам: скольким местам и с какими доводами нужен каждый —
  // это и есть «ниша автоматизации» для нас (OfferMap).
  _products(rows) {
    const out = new Map();
    for (const id of Object.keys(this.offers.products)) {
      const p = this.offers.products[id];
      out.set(id, { id, title: p.title, pitch: p.pitch, hook: !!p.hook, places: 0, strong: 0, weak: 0, evidence: new Map(), example: '' });
    }
    for (const row of rows) {
      for (const p of row.product_detail) {
        const agg = out.get(p.id);
        if (!agg) continue;
        agg.places += 1;
        if (p.strong) agg.strong += 1; else agg.weak += 1;
        for (const e of p.evidence) agg.evidence.set(e, (agg.evidence.get(e) || 0) + 1);
        if (!agg.example && p.strong && row.quote) agg.example = `${row.name}: ${row.quote}`;
      }
    }
    return [...out.values()].map((agg) => ({
      id: agg.id,
      title: agg.title,
      kind: agg.hook ? 'модуль ниши' : 'продукт',
      places: agg.places,
      strong: agg.strong,
      weak: agg.weak,
      evidence: [...agg.evidence].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ×${n}`).join(', '),
      example: agg.example,
      pitch: agg.pitch,
    }));
  }
}

function firstQuote(failures) {
  return failures.find((f) => f.verified && f.quote) || failures.find((f) => f.quote) || null;
}

function counts(rows, unaudited) {
  const by = (pred) => rows.filter(pred).length;
  return {
    places: rows.length + unaudited.length,
    leads: by((r) => r.strength),
    strong: by((r) => r.strength === 'strong'),
    weak: by((r) => r.strength === 'weak'),
    rejected: by((r) => !r.strength),
    unaudited: unaudited.length,
  };
}

module.exports = { LeadPlan };
