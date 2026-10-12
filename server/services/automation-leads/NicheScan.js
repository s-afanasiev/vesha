// Разбор ниши — сценарий «корпус ниши → план лидов» (П1: композиция шагов).
// Каждый шаг виден в дереве процессов: узел едет в ctx.node, отмена — в
// ctx.signal (П37). Запуском и остановкой владеет LeadsDesk (desk.js).

class NicheScan {
  constructor({ places, each, plan }) {
    this.places = places;
    this.each = each;
    this.plan = plan;
  }

  async run(niche, world, ctx) {
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

module.exports = { NicheScan };
