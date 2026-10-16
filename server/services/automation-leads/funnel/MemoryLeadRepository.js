// Честный простой узел (О6): контракт LeadRepository в памяти — для тестов и
// прогона без базы. Те же отказы, что у Postgres: версия доски, перенос из чужой
// колонки, тройка «воронка × компания × оффер» уникальна.

const crypto = require('node:crypto');

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

const copy = (v) => JSON.parse(JSON.stringify(v));

class MemoryLeadRepository {
  constructor(journal) {
    this.journal = journal;
    this.funnels = [];
    this.boards = new Map(); // funnelId → колонки
    this.rows = [];           // лиды
  }

  async funnelByOwner(owner) {
    const funnel = this.funnels.find((f) => f.owner === owner);
    return funnel ? { ...funnel } : null;
  }

  async createFunnel(owner, columns, makeEvents) {
    const existing = await this.funnelByOwner(owner);
    if (existing) return existing;
    const funnel = { id: crypto.randomUUID(), owner, board_version: 1, created_at: new Date().toISOString() };
    this.funnels.push(funnel);
    this.boards.set(funnel.id, columns.map((c, position) => ({ ...c, position })));
    await this.journal.appendIn(null, makeEvents(funnel));
    return { ...funnel };
  }

  async columns(funnelId) {
    return (this.boards.get(funnelId) || []).map((c) => ({ ...c }));
  }

  async leads(funnelId) {
    return this.rows.filter((l) => l.funnel_id === funnelId).map(copy);
  }

  async leadById(id) {
    const lead = this.rows.find((l) => l.id === id);
    return lead ? copy(lead) : null;
  }

  async intake(funnelId, columnId, { create, refresh }, run, makeEvents) {
    const now = new Date().toISOString();
    const created = [];
    for (const d of create) {
      if (this.rows.some((l) => l.funnel_id === funnelId && l.company_key === d.companyKey && l.offer === d.offer)) continue;
      const lead = {
        id: crypto.randomUUID(), funnel_id: funnelId, column_id: columnId, niche: d.niche,
        company_key: d.companyKey, company: copy(d.company), offer: d.offer, evidence: copy(d.evidence),
        until: null, reason: null, do_not_contact: null, found_run: run, seen_run: run, seen_at: now,
        created_at: now, updated_at: now,
      };
      this.rows.push(lead);
      created.push(copy(lead));
    }
    for (const { lead, draft } of refresh) {
      const row = this.rows.find((l) => l.id === lead.id);
      Object.assign(row, { company: copy(draft.company), evidence: copy(draft.evidence), seen_run: run, seen_at: now });
    }
    await this.journal.appendIn(null, makeEvents(created));
    return created;
  }

  async updateLead(leadId, seenColumnId, patch, events) {
    const lead = this.rows.find((l) => l.id === leadId && l.column_id === seenColumnId);
    if (!lead) throw conflict('Лид уже переместился — обновите воронку');
    for (const k of ['column_id', 'until', 'reason', 'do_not_contact']) {
      if (k in patch) lead[k] = patch[k];
    }
    lead.updated_at = new Date().toISOString();
    await this.journal.appendIn(null, events);
    return copy(lead);
  }

  async appendEvents(events) {
    await this.journal.appendIn(null, events);
  }

  async saveBoard(funnelId, version, columns, moves, events, movedEvent) {
    const funnel = this.funnels.find((f) => f.id === funnelId);
    if (!funnel || funnel.board_version !== version) throw conflict('Воронка изменилась — обновите и повторите');
    const moveEvents = [];
    for (const move of moves) {
      for (const lead of this.rows.filter((l) => l.funnel_id === funnelId && l.column_id === move.from)) {
        lead.column_id = move.to;
        moveEvents.push(movedEvent(copy(lead), move));
      }
    }
    if (this.rows.some((l) => l.funnel_id === funnelId && !columns.some((c) => c.id === l.column_id))) {
      throw conflict('Колонка изменилась — обновите воронку');
    }
    this.boards.set(funnelId, columns.map((c, position) => ({ ...c, position })));
    funnel.board_version += 1;
    await this.journal.appendIn(null, [...events, ...moveEvents]);
    return funnel.board_version;
  }
}

module.exports = { MemoryLeadRepository };
