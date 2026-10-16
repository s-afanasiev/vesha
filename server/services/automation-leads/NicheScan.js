// Разбор ниши — сценарий «корпус ниши → план лидов → воронка» (П1: композиция
// шагов). Каждый шаг виден в дереве процессов: узел едет в ctx.node, отмена — в
// ctx.signal, кто нажал — в ctx.user (П37). Запуском и остановкой владеет LeadsDesk.
//
// Последний шаг — LeadIntake: лиды плана ложатся в воронку владельца в Postgres.
// Его сбой — исход узла, а не авария разбора: план уже готов (П24).

class NicheScan {
  constructor({ places, each, plan, intake = null }) {
    this.places = places;
    this.each = each;
    this.plan = plan;
    this.intake = intake;
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
    const plan = await ctx.node.step({ nodeType: 'LeadPlan', title: 'план лидов' }, (n) => {
      const decided = this.plan.decide(audits, niche);
      const c = decided.counts;
      n.complete({ summary: `лидов ${c.leads} (со сбоем ${c.strong}, по пробелам ${c.weak}) · отказ ${c.rejected}`, counts: c });
      return decided;
    });
    if (this.intake) {
      plan.intake = await ctx.node.step(
        { nodeType: 'LeadIntake', title: 'в воронку' },
        (n) => this.intake.run(plan, niche, { ...ctx, node: n, run: ctx.node.id }),
      ).catch((err) => {
        if (err && err.name === 'AbortError') throw err;
        return { error: err.message };
      });
    }
    return plan;
  }
}

module.exports = { NicheScan };
