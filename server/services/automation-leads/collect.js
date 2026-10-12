// Сбор корпуса ниши — сценарий «ниша × город → корпус на диске» (шаг сквозного
// прогона, заменивший опытные скрипты 11.10.2026). Каждый шаг виден в дереве
// процессов; узел едет аргументом, отмена — в world.signal (П37). Внешний мир —
// адаптеры каркаса сборщиков за обёрткой терпения (пауза, стоп на 403/429);
// разметка — через квоту LLM от имени инициатора. Корпус подменяется только
// целиком и только при успехе (corpus.js).

const { RubricFit } = require('./rules');
const { siteDomains } = require('./audits');
const { siteSignals } = require('./siteSignals');
const { isStop } = require('./places');
const { systemPrompt, userContent, parseBatch, batchesOf } = require('../radar/reviewMarking');

// Листинг ниши: тематические запросы, страницы до пустой или до двух подряд без
// новых мест. Неудача одного запроса — строка итога; отказ источника — конец сбора.
class Listing {
  constructor({ maxPages = 7, quietPages = 2 } = {}) {
    this.maxPages = maxPages;
    this.quietPages = quietPages;
  }

  async run(niche, world, node) {
    const found = new Map();
    for (const query of niche.queries) {
      try {
        await node.step({ nodeType: 'ListingQuery', title: query }, async (q) => {
          let pages = 0;
          let fresh = 0;
          let quiet = 0;
          for (let page = 1; page <= this.maxPages; page += 1) {
            const places = await world.twogis.listing(world.niche.citySlug, query, page, { signal: world.signal });
            if (!places.length) break;
            pages += 1;
            let added = 0;
            for (const place of places) {
              if (found.has(place.branch_id)) continue;
              found.set(place.branch_id, { ...place, query });
              added += 1;
            }
            fresh += added;
            q.update({ summary: `стр. ${page}: новых ${fresh}` });
            quiet = added ? 0 : quiet + 1;
            if (quiet >= this.quietPages) break;
          }
          if (!pages) q.skip('empty', 'выдача пуста');
          else q.complete({ summary: `${pages} стр. · новых мест ${fresh}` });
        });
      } catch (err) {
        if (isStop(err)) throw err;
      }
    }
    const all = [...found.values()];
    node.complete({ summary: `${all.length} мест по ${niche.queries.length} запросам` });
    return all;
  }
}

class CardPage {
  async run(place, world, node) {
    const card = await world.twogis.firm(world.niche.citySlug, place.branch_id, { signal: world.signal });
    if (!card) {
      node.skip('no_card', 'карточка не открылась');
      return null;
    }
    node.complete({ summary: `телефонов ${card.phones.length} · сайтов ${card.websites.length} · ${card.branches} точ.` });
    return card;
  }
}

// Главная сайта: https, потом http. Один домен на прогон проверяется один раз —
// у сети один сайт на все точки.
class SitePage {
  async run(card, world, node) {
    const domains = siteDomains(card.websites);
    if (!domains.length) {
      node.skip('no_site', 'сайта нет в карточке');
      return null;
    }
    const domain = domains[0];
    if (world.sites.has(domain)) {
      const known = world.sites.get(domain);
      known.branches.push(card.branch_id);
      node.skip('seen', `${domain}: уже проверен в этом сборе`);
      return known;
    }
    let audit = null;
    for (const scheme of ['https://', 'http://']) {
      const page = await world.web.page(scheme + domain, { signal: world.signal });
      if (page.text != null) {
        const { bytes, ...signals } = siteSignals(page.text);
        audit = { domain, branches: [card.branch_id], url: page.finalUrl, status: page.status, ...signals, bytes };
        break;
      }
      audit = { domain, branches: [card.branch_id], error: page.error, errorCode: page.code || null, status: page.status || null };
    }
    world.sites.set(domain, audit);
    node.complete({ summary: audit.error ? `${domain}: ${audit.error}` : `${domain} · ${audit.platform || 'движок не опознан'}` });
    return audit;
  }
}

// Свежие отзывы места: не больше perOrg последних, с даты from, с текстом —
// одинаковый «голос» у мест с разной плотностью отзывов.
class FreshReviews {
  constructor({ from = '2024-01-01', perOrg = 10 } = {}) {
    this.from = from;
    this.perOrg = perOrg;
  }

  async run(place, world, node) {
    const list = await world.twogis.reviews(place.branch_id, { limit: this.perOrg, signal: world.signal });
    const fresh = list
      .filter((r) => String(r.date_created || '') >= this.from && String(r.text || '').trim())
      .map((r) => ({ branch_id: place.branch_id, org_name: place.name, ...r }));
    if (!fresh.length) node.skip('no_fresh_reviews', `свежих нет (из ${list.length})`);
    else node.complete({ summary: `${fresh.length} свежих из ${list.length}` });
    return fresh;
  }
}

class PlaceCorpus {
  constructor({ card, site, reviews }) {
    this.card = card;
    this.site = site;
    this.reviews = reviews;
  }

  async run(place, world, node) {
    const card = await node.step({ nodeType: 'CardPage', title: 'карточка' }, (n) => this.card.run(place, world, n));
    const site = card ? await node.step({ nodeType: 'SitePage', title: 'сайт' }, (n) => this.site.run(card, world, n)) : null;
    const reviews = await node.step({ nodeType: 'FreshReviews', title: 'отзывы' }, (n) => this.reviews.run(place, world, n));
    node.complete({ summary: `${card ? 'карточка есть' : 'карточки нет'} · ${site && !site.error ? 'сайт есть' : 'сайта нет'} · свежих отзывов ${reviews.length}` });
    return { place, card, site, reviews };
  }
}

// Разметка батчами через квоту LLM. Неудачный батч — строка журнала с ошибкой:
// его отзывы останутся «не размечены», а не «без сбоев» (П38).
class Marking {
  async run(reviews, world, node) {
    const batches = batchesOf(reviews);
    if (!batches.length) {
      node.skip('nothing_to_mark', 'размечать нечего');
      return { records: [], costRub: 0, marked: 0 };
    }
    const system = systemPrompt(world.catalog);
    const records = [];
    let costRub = 0;
    let marked = 0;
    for (const [i, batch] of batches.entries()) {
      const n = i + 1;
      const record = { batch: n, group: batch.group, directory: world.catalog.version, niche: world.niche.slug };
      try {
        await node.step({ nodeType: 'MarkBatch', title: `#${n} ${batch.group === 'negative' ? 'негатив' : 'позитив'} · ${batch.reviews.length}` }, async (b) => {
          const result = await world.llm.complete(
            [{ role: 'system', content: system }, { role: 'user', content: userContent(batch.reviews) }],
            { node: b, signal: world.signal },
          );
          const parsed = parseBatch(result.text, batch.reviews, world.catalog);
          record.costRub = (result.usage && result.usage.cost_rub) || null;
          record.rejected = parsed.rejected;
          record.missing = parsed.missing;
          record.reviews = parsed.results.map(({ review, author, signals }) => ({
            review_id: review.review_id,
            branch_id: review.branch_id,
            org_name: review.org_name || null,
            rating: review.rating,
            date: String(review.date_created).slice(0, 10),
            author,
            signals,
          }));
          costRub += record.costRub || 0;
          marked += record.reviews.length;
          const signals = record.reviews.reduce((sum, r) => sum + r.signals.length, 0);
          b.complete({
            summary: `сигналов ${signals} · без ответа ${parsed.missing.length} · отброшено ${parsed.rejected.length}${record.costRub ? ` · ${record.costRub.toFixed(2)} ₽` : ''}`,
          });
        });
      } catch (err) {
        if (isStop(err)) throw err;
        record.error = String(err.message || err).slice(0, 300);
      }
      records.push(record);
    }
    const failed = records.filter((r) => r.error).length;
    node.complete({ summary: `размечено ${marked} из ${reviews.length}${failed ? ` · батчей с ошибкой ${failed}` : ''}${costRub ? ` · ${costRub.toFixed(2)} ₽` : ''}` });
    return { records, costRub, marked };
  }
}

class NicheCollect {
  constructor({ listing, each, marking, corpus }) {
    this.listing = listing;
    this.each = each;
    this.marking = marking;
    this.corpus = corpus;
  }

  async run(niche, world, ctx) {
    const writer = this.corpus.writer(niche.slug);
    await writer.begin();
    try {
      const all = await ctx.node.step({ nodeType: 'Listing', title: 'листинг 2ГИС' }, (n) => this.listing.run(niche, world, n));
      const fit = new RubricFit(niche.rubrics);
      const places = all.filter((p) => fit.check(p).fit);
      const corpus = await ctx.node.step(
        { nodeType: 'EachPlace', title: 'места ниши', payload: { summary: `${places.length} из ${all.length} — в нише` } },
        (n) => this.each.run(places, world, { ...ctx, node: n }),
      );
      const cards = {};
      const reviews = [];
      for (const r of corpus) {
        if (!r.ok) continue;
        if (r.card) cards[r.place.branch_id] = r.card;
        reviews.push(...r.reviews);
      }
      const marks = await ctx.node.step({ nodeType: 'Marking', title: 'разметка отзывов' }, (n) => this.marking.run(reviews, world, n));
      const counts = {
        listed: all.length,
        places: places.length,
        cards: Object.keys(cards).length,
        sites: world.sites.size,
        reviews: reviews.length,
        marked: marks.marked,
        costRub: Number(marks.costRub.toFixed(2)),
      };
      await ctx.node.step({ nodeType: 'CorpusCommit', title: 'корпус на диск' }, async (n) => {
        await writer.json('orgs.json', all);
        await writer.json('audit-cards.json', cards);
        await writer.json('audit-sites.json', Object.fromEntries(world.sites));
        await writer.ndjson('reviews.ndjson', reviews);
        await writer.ndjson('marks.jsonl', marks.records);
        await writer.json('meta.json', {
          niche: niche.slug,
          city: niche.city,
          queries: niche.queries,
          rubrics: niche.rubrics,
          pack: niche.pack || null,
          collectedAt: new Date().toISOString(),
          counts,
        });
        await writer.commit();
        n.complete({ summary: `мест ${counts.places} · отзывов ${counts.reviews} · размечено ${counts.marked}` });
      });
      return counts;
    } catch (err) {
      await writer.abandon();
      throw err;
    }
  }
}

// Проверка источника: три запроса — листинг, карточка, отзывы. Отвечает на
// главный риск сбора с сервера: отдаёт ли 2ГИС данные этому IP.
class SourceProbe {
  async run(niche, world, ctx) {
    const query = niche.queries[0];
    const places = await ctx.node.step({ nodeType: 'ProbeListing', title: `листинг «${query}», стр. 1` }, async (n) => {
      const list = await world.twogis.listing(world.niche.citySlug, query, 1, { signal: world.signal });
      if (!list.length) n.skip('empty', 'выдача пуста: поиск ничего не нашёл или сменилась вёрстка');
      else n.complete({ summary: `${list.length} мест` });
      return list;
    });
    if (!places.length) return { ok: false, reason: 'листинг пуст' };
    const first = places[0];
    await ctx.node.step({ nodeType: 'ProbeFirm', title: `карточка «${first.name}»` }, async (n) => {
      const card = await world.twogis.firm(world.niche.citySlug, first.branch_id, { signal: world.signal });
      if (!card) n.skip('no_card', 'карточка не разобралась');
      else n.complete({ summary: `телефонов ${card.phones.length} · сайтов ${card.websites.length}` });
    });
    await ctx.node.step({ nodeType: 'ProbeReviews', title: 'отзывы места' }, async (n) => {
      const list = await world.twogis.reviews(first.branch_id, { limit: 5, signal: world.signal });
      n.complete({ summary: `${list.length} отзывов` });
    });
    return { ok: true };
  }
}

module.exports = { Listing, CardPage, SitePage, FreshReviews, PlaceCorpus, Marking, NicheCollect, SourceProbe };
