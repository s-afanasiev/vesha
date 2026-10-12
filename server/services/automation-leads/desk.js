// Дверь территории «Кому автоматизировать» (П28): сценарии собрать, разобрать,
// проверить источник, остановить — и витрины для экрана. Прогоны — корни дерева
// процессов; у каждого вход и выход у одного хозяина (П39).
//
// Полосы занятости (П22: у дефицита один владелец): разбор держит нишу, сбор —
// нишу и 2ГИС, проверка — 2ГИС. Занятая полоса — отказ с причиной, а не очередь:
// два сбора не стучатся в 2ГИС вдвое чаще, разбор не читает корпус, который
// в этот момент собирается.

// В вехах — UTC, человеку — Москва: перевод только здесь, на границе (П41).
const MOSCOW = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });

const KIND_TITLE = { NicheScan: 'разбор', NicheCollect: 'сбор', SourceProbe: 'проверка 2ГИС' };

class Runs {
  constructor({ tree }) {
    this.tree = tree;
    this.active = new Map();
  }

  start({ nodeType, title, niche, actor, lanes, work, summarize }) {
    const busy = [...this.active.values()].find((r) => r.lanes.some((l) => lanes.includes(l)));
    if (busy) throw new Error(`сейчас идёт ${KIND_TITLE[busy.nodeType] || busy.nodeType}: «${busy.title}»`);
    const root = this.tree.createNode({ nodeType, title, payload: { niche, actor } });
    const controller = new AbortController();
    const run = { nodeType, title, niche, lanes, root, controller };
    this.active.set(root.id, run);
    run.done = (async () => {
      root.start();
      try {
        const result = await work({ node: root, signal: controller.signal });
        root.complete({ summary: summarize ? summarize(result) : undefined });
      } catch (err) {
        if (err && err.name === 'AbortError') root.cancel('остановлено человеком');
        else root.fail(err);
      } finally {
        this.active.delete(root.id);
      }
    })();
    return { runId: root.id };
  }

  stop(niche) {
    const runs = [...this.active.values()].filter((r) => r.niche === niche);
    for (const run of runs) run.controller.abort();
    return runs.length ? { stopping: runs.map((r) => r.title) } : { stopping: [], reason: 'по этой нише ничего не идёт' };
  }

  kindsFor(niche) {
    return [...this.active.values()].filter((r) => r.niche === niche).map((r) => r.nodeType);
  }

  // Ждать прогоны ниши — для тестов и для остановки процесса (П20).
  settle(niche) {
    return Promise.all([...this.active.values()].filter((r) => !niche || r.niche === niche).map((r) => r.done));
  }
}

class LeadsDesk {
  constructor({ tree, niches, corpus, scan, collect, probe, scanWorld, collectWorld, twogis }) {
    this.niches = niches;
    this.corpus = corpus;
    this.scanWork = scan;
    this.collectWork = collect;
    this.probeWork = probe;
    this.scanWorld = scanWorld;
    this.collectWorld = collectWorld;
    this.twogis = twogis;
    this.runs = new Runs({ tree });
    this.plans = new Map();
  }

  scan(slug, { actor = null } = {}) {
    const niche = this._niche(slug);
    return this.runs.start({
      nodeType: 'NicheScan',
      title: `${niche.title} · ${niche.city}`,
      niche: slug,
      actor: actorName(actor),
      lanes: [`niche:${slug}`],
      work: async (ctx) => {
        const plan = await this.scanWork.run(niche, this.scanWorld(niche), ctx);
        this.plans.set(slug, { plan, at: new Date().toISOString() });
        return plan;
      },
      summarize: (plan) => `лидов ${plan.counts.leads} из ${plan.counts.places} мест`,
    });
  }

  collect(slug, { actor = null } = {}) {
    const niche = this._niche(slug);
    return this.runs.start({
      nodeType: 'NicheCollect',
      title: `${niche.title} · ${niche.city}`,
      niche: slug,
      actor: actorName(actor),
      lanes: [`niche:${slug}`, 'source:2gis'],
      work: (ctx) => this.collectWork.run(niche, this.collectWorld(niche, actor, ctx.signal), ctx),
      summarize: (c) => `мест ${c.places} · отзывов ${c.reviews} · размечено ${c.marked}${c.costRub ? ` · ${c.costRub} ₽` : ''}`,
    });
  }

  probe(slug, { actor = null } = {}) {
    const niche = this._niche(slug);
    return this.runs.start({
      nodeType: 'SourceProbe',
      title: `2ГИС · ${niche.city}`,
      niche: slug,
      actor: actorName(actor),
      lanes: ['source:2gis'],
      work: (ctx) => this.probeWork.run(niche, this.collectWorld(niche, actor, ctx.signal), ctx),
      summarize: (r) => (r.ok ? '2ГИС отвечает этому серверу' : r.reason),
    });
  }

  stop(slug) {
    this._niche(slug);
    return this.runs.stop(slug);
  }

  settle(slug) {
    return this.runs.settle(slug);
  }

  async nicheRows() {
    const source = this.twogis && this.twogis.status ? this.twogis.status() : null;
    const refused = source && source.refused
      ? ` · 2ГИС остывает после ${source.refused.status} с ${MOSCOW.format(new Date(source.refused.at))}`
      : '';
    return Promise.all(Object.values(this.niches).map(async (n) => {
      const info = await this.corpus.info(n.slug);
      const last = this.plans.get(n.slug);
      const kinds = this.runs.kindsFor(n.slug);
      const c = info && info.counts;
      return {
        slug: n.slug,
        title: n.title,
        city: n.city,
        corpus: !info
          ? 'нет корпуса — нажмите «Собрать»'
          : [
            info.collectedAt ? `собран ${MOSCOW.format(new Date(info.collectedAt))}` : 'собран скриптами',
            c ? `мест ${c.places} · отзывов ${c.reviews} · размечено ${c.marked}` : null,
          ].filter(Boolean).join(' · '),
        state: (kinds.length ? `идёт: ${kinds.map((k) => KIND_TITLE[k]).join(', ')}` : last ? 'разобрана' : '—') + refused,
        leads: last ? last.plan.counts.leads : null,
        strong: last ? last.plan.counts.strong : null,
        at: last ? MOSCOW.format(new Date(last.at)) : '',
      };
    }));
  }

  leadRows() {
    return [...this.plans.values()].flatMap(({ plan }) => plan.leads);
  }

  productRows() {
    const out = [];
    for (const [slug, { plan }] of this.plans) {
      for (const p of plan.products) out.push({ ...p, key: `${slug}:${p.id}`, niche: this.niches[slug].title });
    }
    return out;
  }

  _niche(slug) {
    const niche = this.niches[slug];
    if (!niche) throw new Error(`неизвестная ниша: ${slug}`);
    return niche;
  }
}

function actorName(actor) {
  return actor ? actor.email || actor.id || null : null;
}

module.exports = { LeadsDesk, Runs };
