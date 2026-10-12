// Разбор ниши — сценарий «ниша × город → план лидов» (П1: композиция шагов) и
// хозяин прогонов Scans (П16: повторитель держит правило запуска, прогон —
// своё состояние). Каждый шаг виден в дереве процессов: узел едет в ctx.node,
// отмена — в ctx.signal (П37). У входа есть выход: start ↔ stop у одного
// хозяина и в одном канале (П39).

// В БД и вехах — UTC, человеку — Москва: перевод только здесь, на границе (П41).
const MOSCOW = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });

class NicheScan {
  constructor({ worldOf, places, each, plan }) {
    this.worldOf = worldOf;
    this.places = places;
    this.each = each;
    this.plan = plan;
  }

  async run(niche, ctx) {
    const world = this.worldOf(niche);
    const places = await ctx.node.step(
      { nodeType: 'Places', title: 'места ниши' },
      (n) => this.places.run(niche, world, n),
    );
    const audits = await ctx.node.step(
      { nodeType: 'EachPlace', title: 'аудит мест', payload: { summary: `${places.length} мест` } },
      (n) => this.each.run(places, world, { ...ctx, node: n }),
    );
    return ctx.node.step({ nodeType: 'LeadPlan', title: 'план лидов' }, (n) => {
      const plan = this.plan.decide(audits, niche);
      const c = plan.counts;
      n.complete({ summary: `лидов ${c.leads} (со сбоем ${c.strong}, по пробелам ${c.weak}) · отказ ${c.rejected}`, counts: c });
      return plan;
    });
  }
}

class Scans {
  constructor({ scan, tree, niches, clock = () => new Date() }) {
    this.scan = scan;
    this.tree = tree;
    this.niches = niches;
    this.clock = clock;
    this.running = new Map();
    this.plans = new Map();
  }

  // Один разбор ниши за раз: второй запуск — отказ с причиной, а не очередь.
  start(slug, { actor = null } = {}) {
    const niche = this.niches[slug];
    if (!niche) throw new Error(`неизвестная ниша: ${slug}`);
    if (this.running.has(slug)) throw new Error(`разбор ниши «${niche.title}» уже идёт`);
    const root = this.tree.createNode({
      nodeType: 'NicheScan',
      title: `${niche.title} · ${niche.city}`,
      payload: { niche: slug, actor },
    });
    const controller = new AbortController();
    const done = this._run(slug, niche, root, controller);
    this.running.set(slug, { root, controller, done });
    return { scanId: root.id, niche: slug };
  }

  stop(slug) {
    const run = this.running.get(slug);
    if (!run) return { stopping: false, reason: 'разбор не идёт' };
    run.controller.abort();
    return { stopping: true, scanId: run.root.id };
  }

  async _run(slug, niche, root, controller) {
    root.start();
    try {
      const plan = await this.scan.run(niche, { node: root, signal: controller.signal });
      this.plans.set(slug, { plan, at: this.clock().toISOString(), scanId: root.id });
      root.complete({ summary: `лидов ${plan.counts.leads} из ${plan.counts.places} мест` });
    } catch (err) {
      if (err && err.name === 'AbortError') root.cancel('остановлено человеком');
      else root.fail(err);
    } finally {
      this.running.delete(slug);
    }
  }

  // Ждать текущий прогон ниши — для тестов и для остановки процесса (П20).
  settle(slug) {
    const run = this.running.get(slug);
    return run ? run.done : Promise.resolve();
  }

  nicheRows() {
    return Object.values(this.niches).map((n) => {
      const last = this.plans.get(n.slug);
      return {
        slug: n.slug,
        title: n.title,
        city: n.city,
        state: this.running.has(n.slug) ? 'идёт разбор' : last ? 'разобрана' : 'не разбиралась',
        places: last ? last.plan.counts.places : null,
        leads: last ? last.plan.counts.leads : null,
        strong: last ? last.plan.counts.strong : null,
        at: last ? MOSCOW.format(new Date(last.at)) : '',
      };
    });
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
}

module.exports = { NicheScan, Scans };
