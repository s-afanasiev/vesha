// Дверь воронки лидов (П28): снаружи — сценарии владельца воронки, механику
// собирает сама. Лиды и колонки меняются только отсюда; правило пути — LeadPath,
// правило доски — Board (общее с костяком), истина — репозиторий, события —
// общий журнал (stream 'lead' и 'board', scope — воронка владельца).
//
// Ничего не отправляется автоматически: воронка готовит карточку с доводами,
// пишет и звонит человек — и сам переносит лид, а журнал помнит кто, когда, почему.

const { Lead } = require('./Lead');

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const ACTIONS = ['note', 'block', 'unblock'];

class LeadFunnel {
  constructor({ repository, journal, board, path, template }) {
    this.repository = repository;
    this.journal = journal;
    this.boardRule = board;
    this.path = path;
    this.template = template;
  }

  // «Я» воронки — владелец: email того, кто вошёл; без входа (проверочный сервер) — admin.
  static ownerOf(user) {
    return user && user.email ? String(user.email).toLowerCase() : 'admin';
  }

  static actorOf(user) {
    return (user && (user.email || user.id) && String(user.email || user.id)) || 'admin';
  }

  // Воронка владельца; при первом обращении — с колонками из шаблона.
  async funnel(owner, actor = 'system') {
    const known = await this.repository.funnelByOwner(owner);
    if (known) return known;
    const columns = this.boardRule.check(this.template.map((c) => ({ ...c, limit: null })));
    return this.repository.createFunnel(owner, columns, (f) => [{
      stream: 'board', scope: f.id, subjectId: f.id, type: 'board_created',
      data: { template: 'leads', columns: columns.map((c) => c.id) }, actor, cause: 'template',
    }]);
  }

  async board(owner) {
    const funnel = await this.funnel(owner);
    return { funnel, version: funnel.board_version, columns: await this.repository.columns(funnel.id) };
  }

  // Колонки — с тем, что правило пути спросит у человека при входе в колонку.
  async columns(owner) {
    return (await this.board(owner)).columns.map((c) => {
      const ask = this.path.asks(c);
      return ask.length ? { ...c, ask } : c;
    });
  }

  async leads(owner) {
    const funnel = await this.funnel(owner);
    return this.repository.leads(funnel.id);
  }

  async leadOf(funnel, id) {
    const lead = await this.repository.leadById(id);
    if (!lead || lead.funnel_id !== funnel.id) throw notFound('Лид не найден');
    return lead;
  }

  // Итог разбора → воронка владельца: новые компании — в колонку входа событием
  // found, известным — свежие доводы (evidence_changed, если сдвинулся балл).
  async intake({ owner, niche, plan, run, actor }) {
    const { funnel, columns } = await this.board(owner);
    const inbox = columns.find((c) => c.type === 'inbox');
    const drafts = plan.leads.map((row) => Lead.fromPlan(row, niche)).filter(Boolean);
    const sorted = Lead.sortOut(drafts, await this.repository.leads(funnel.id));
    const changed = sorted.refresh.filter(({ lead, draft }) => lead.evidence.score !== draft.evidence.score);
    const event = (subjectId, type, data) => ({ stream: 'lead', scope: funnel.id, subjectId, type, data: { ...data, run }, actor, cause: 'scan' });
    const created = await this.repository.intake(funnel.id, inbox.id, sorted, run, (rows) => [
      ...rows.map((l) => event(l.id, 'found', {
        company: l.company.name, offer: l.offer, offerTitle: (l.evidence.offers.find((o) => o.id === l.offer) || {}).title,
        column: inbox.id, columnType: inbox.type,
        score: l.evidence.score, strength: l.evidence.strength, niche: niche.slug,
      })),
      ...changed.map(({ lead, draft }) => event(lead.id, 'evidence_changed', {
        company: draft.company.name, from: lead.evidence.score, to: draft.evidence.score,
      })),
    ]);
    return {
      funnel: funnel.id,
      created: created.length,
      known: new Set(sorted.refresh.map(({ lead }) => lead.company_key)).size,
      changed: changed.length,
      blocked: sorted.blocked.length,
    };
  }

  // Единственная дверь переноса: доска, кнопки ←/→ и форма — все сюда.
  async move(owner, leadId, to, fields, { actor, cause = 'manual' } = {}) {
    const { funnel, columns } = await this.board(owner);
    const lead = await this.leadOf(funnel, leadId);
    const from = columns.find((c) => c.id === lead.column_id);
    const { event, patch } = this.path.transition(lead, from, columns.find((c) => c.id === to), fields || {});
    return this.repository.updateLead(lead.id, lead.column_id, patch, [this.event(funnel, lead, event, actor, cause)]);
  }

  // Действия карточки: заметка, «не беспокоить» и снятие запрета.
  actionsFor(lead) {
    return ['note', lead.do_not_contact ? 'unblock' : 'block'];
  }

  async act(owner, leadId, action, fields, actor) {
    if (!ACTIONS.includes(action)) throw bad(`Неизвестное действие: ${action}`);
    const { funnel, columns } = await this.board(owner);
    const lead = await this.leadOf(funnel, leadId);
    if (!this.actionsFor(lead).includes(action)) throw bad('Это действие лиду сейчас недоступно');
    if (action === 'note') {
      await this.repository.appendEvents([this.event(funnel, lead, this.path.note(fields), actor, 'manual')]);
      return lead;
    }
    const from = columns.find((c) => c.id === lead.column_id);
    const step = action === 'block'
      ? this.path.block(lead, from, columns.find((c) => c.type === 'refused'), fields)
      : this.path.unblock(lead, fields);
    return this.repository.updateLead(lead.id, lead.column_id, step.patch, [this.event(funnel, lead, step.event, actor, 'manual')]);
  }

  // Операция конструктора: правило — Board, атомарность и версия — репозиторий.
  async configure(owner, op, actor) {
    const { funnel, version, columns } = await this.board(owner);
    const counts = {};
    for (const l of await this.repository.leads(funnel.id)) counts[l.column_id] = (counts[l.column_id] || 0) + 1;
    const next = this.boardRule.apply(columns, op, counts);
    const byId = new Map(columns.map((c) => [c.id, c]));
    await this.repository.saveBoard(
      funnel.id, version, next.columns, next.moves,
      [{ stream: 'board', scope: funnel.id, subjectId: funnel.id, ...next.event, actor, cause: 'configure' }],
      (lead, move) => ({
        stream: 'lead', scope: funnel.id, subjectId: lead.id, type: 'moved',
        data: {
          company: lead.company.name, from: move.from, to: move.to,
          fromType: byId.get(move.from).type, toType: next.columns.find((c) => c.id === move.to).type,
        },
        actor, cause: 'column_removed',
      }),
    );
    return this.columns(funnel.owner);
  }

  // Лид с колонками и его журналом — сырьё для подробностей и окна статуса.
  async history(owner, leadId) {
    const { funnel, columns } = await this.board(owner);
    const lead = await this.leadOf(funnel, leadId);
    const [events, boardEvents] = await Promise.all([
      this.journal.forSubject('lead', lead.id),
      this.journal.forSubject('board', funnel.id),
    ]);
    return { funnel, lead, columns, events, boardEvents };
  }

  // Журнал воронки: события новыми первыми; события доски — целиком, чтобы
  // удалённая колонка осталась своим названием.
  async journalOf(owner, { limit = 300 } = {}) {
    const { funnel, columns } = await this.board(owner);
    const [events, boardEvents] = await Promise.all([
      this.journal.forScope(funnel.id, { limit }),
      this.journal.forSubject('board', funnel.id),
    ]);
    return { columns, events, boardEvents };
  }

  event(funnel, lead, { type, data }, actor, cause) {
    return { stream: 'lead', scope: funnel.id, subjectId: lead.id, type, data: { company: lead.company.name, ...data }, actor, cause };
  }
}

// Шаг разбора (узел дерева LeadIntake): лиды плана → воронка того, кто нажал
// «Разобрать» (П37: владелец едет в контексте запуска). Сбой записи — исход
// узла, а не авария разбора: план уже готов (П24).
class LeadIntake {
  constructor(funnel) {
    this.funnel = funnel;
  }

  async run(plan, niche, ctx) {
    const owner = LeadFunnel.ownerOf(ctx.user);
    const r = await this.funnel.intake({ owner, niche, plan, run: ctx.run, actor: LeadFunnel.actorOf(ctx.user) });
    ctx.node.complete({
      summary: [
        `новых ${r.created}`,
        `уже в воронке ${r.known}${r.changed ? ` (балл сдвинулся у ${r.changed})` : ''}`,
        r.blocked ? `не беспокоить ${r.blocked}` : null,
      ].filter(Boolean).join(' · '),
      owner,
    });
    return r;
  }
}

module.exports = { LeadFunnel, LeadIntake };
