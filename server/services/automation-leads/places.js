// Лестница единиц разбора (П30 Ш3): ниша → место → замер. Places отдаёт места
// ниши, EachPlace — повторитель (П16): на каждое место свой узел и свежий проход
// PlaceAudit, неудача места — строка итога, а не авария прогона (П24).

const { RubricFit } = require('./rules');

class Places {
  async run(niche, world, node) {
    const all = await world.source.places();
    const fit = new RubricFit(niche.rubrics);
    const inNiche = [];
    const outside = [];
    for (const place of all) {
      const verdict = fit.check(place);
      if (verdict.fit) inNiche.push(place);
      else outside.push({ name: place.name, reason: verdict.reason });
    }
    node.complete({
      summary: `${all.length} найдено → ${inNiche.length} в нише`,
      outside: outside.slice(0, 30),
    });
    return inNiche;
  }
}

class PlaceAudit {
  constructor({ card, site, reviews }) {
    this.card = card;
    this.site = site;
    this.reviews = reviews;
  }

  async run(place, world, node) {
    const card = await node.step({ nodeType: 'CardFacts', title: 'карточка' }, (n) => this.card.run(place, world, n));
    if (!card) {
      node.skip('no_card', 'карточки нет — аудит не из чего');
      return { place, card: null, site: null, reviews: null };
    }
    const site = await node.step({ nodeType: 'SiteFacts', title: 'сайт' }, (n) => this.site.run(card, world, n));
    const reviews = await node.step({ nodeType: 'ReviewFailures', title: 'отзывы' }, (n) => this.reviews.run(place, world, n));
    const lines = new Set(reviews.failures.map((f) => f.line)).size;
    node.complete({
      summary: `${site.has ? 'сайт есть' : 'сайта нет'} · ${lines ? `линий сбоя: ${lines}` : 'сбоев в отзывах нет'}`,
    });
    return { place, card, site, reviews };
  }
}

class EachPlace {
  constructor(audit) {
    this.audit = audit;
  }

  async run(places, world, ctx) {
    const results = [];
    for (const place of places) {
      if (ctx.signal && ctx.signal.aborted) throw abortError();
      try {
        const audit = await ctx.node.step(
          { nodeType: 'PlaceAudit', title: place.name, payload: { branch_id: place.branch_id } },
          (n) => this.audit.run(place, world, n),
        );
        results.push({ ok: true, ...audit });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        results.push({ ok: false, place, code: err.code || 'error', detail: err.message });
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    ctx.node.complete({ summary: `${results.length - failed} мест проверено${failed ? ` · с ошибкой ${failed}` : ''}` });
    return results;
  }
}

function abortError() {
  const err = new Error('разбор остановлен');
  err.name = 'AbortError';
  return err;
}

module.exports = { Places, PlaceAudit, EachPlace };
