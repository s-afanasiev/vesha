// Владелец истины lead_* (миграция 021): все SQL воронки лидов живут здесь.
// Каждое изменение и его события журнала — одна транзакция: факт без события
// или событие без факта невозможны (журнал — общий, backbone/orders/Journal.js).
//
// Репозиторий решений не принимает: путь лида — LeadPath, доска — Board,
// кого создать, а кого обновить при разборе — Lead.sortOut, сценарии — LeadFunnel.
// Здесь — атомарность и конкурентность: версия доски для конструктора, перенос
// лида только из той колонки, где его видел человек.

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

const COLUMN_SQL = 'SELECT id, title, type, color, wip_limit AS "limit", position FROM lead_funnel_columns';
// DATE — строкой: день по Москве, без сдвига часовым поясом драйвера
const LEAD_SQL = `SELECT id, funnel_id, column_id, niche, company_key, company, offer, evidence,
  until::text AS until, reason, do_not_contact, found_run, seen_run, seen_at, created_at, updated_at FROM leads`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATCHABLE = ['column_id', 'until', 'reason', 'do_not_contact'];

class LeadRepository {
  constructor(db, journal) {
    this.db = db;
    this.journal = journal;
  }

  async tx(fn) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23503') throw conflict('Колонка изменилась — обновите воронку');
        throw err;
      }
    });
  }

  async funnelByOwner(owner) {
    const { rows } = await this.db.query('SELECT * FROM lead_funnels WHERE owner = $1', [owner]);
    return rows[0] || null;
  }

  // Воронка с колонками шаблона; если она уже есть — вернуть как есть.
  async createFunnel(owner, columns, makeEvents) {
    return this.tx(async (client) => {
      const inserted = await client.query(
        'INSERT INTO lead_funnels (owner) VALUES ($1) ON CONFLICT (owner) DO NOTHING RETURNING *',
        [owner]
      );
      if (!inserted.rows[0]) {
        const { rows } = await client.query('SELECT * FROM lead_funnels WHERE owner = $1', [owner]);
        return rows[0];
      }
      const funnel = inserted.rows[0];
      await this.writeColumns(client, funnel.id, columns);
      await this.journal.appendIn(client, makeEvents(funnel));
      return funnel;
    });
  }

  async columns(funnelId) {
    const { rows } = await this.db.query(`${COLUMN_SQL} WHERE funnel_id = $1 ORDER BY position`, [funnelId]);
    return rows;
  }

  async leads(funnelId) {
    const { rows } = await this.db.query(`${LEAD_SQL} WHERE funnel_id = $1 ORDER BY created_at, id`, [funnelId]);
    return rows;
  }

  async leadById(id) {
    if (!UUID.test(String(id))) return null;
    const { rows } = await this.db.query(`${LEAD_SQL} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  // Итог разбора: новые лиды — в колонку входа, известным — свежие доводы.
  // Встречный разбор того же владельца не задвоит лид: тройка уникальна.
  async intake(funnelId, columnId, { create, refresh }, run, makeEvents) {
    return this.tx(async (client) => {
      await client.query('SELECT 1 FROM lead_funnels WHERE id = $1 FOR UPDATE', [funnelId]);
      const created = [];
      for (const d of create) {
        const { rows } = await client.query(
          `INSERT INTO leads (funnel_id, column_id, niche, company_key, company, offer, evidence, found_run, seen_run, seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, now())
           ON CONFLICT (funnel_id, company_key, offer) DO NOTHING
           RETURNING id, column_id, company, offer, evidence`,
          [funnelId, columnId, d.niche, d.companyKey, JSON.stringify(d.company), d.offer, JSON.stringify(d.evidence), run]
        );
        if (rows[0]) created.push(rows[0]);
      }
      for (const { lead, draft } of refresh) {
        await client.query(
          'UPDATE leads SET company = $2, evidence = $3, seen_run = $4, seen_at = now() WHERE id = $1',
          [lead.id, JSON.stringify(draft.company), JSON.stringify(draft.evidence), run]
        );
      }
      await this.journal.appendIn(client, makeEvents(created));
      return created;
    });
  }

  // Перенос, запрет и его снятие: лид меняется, только если он там, где его видел человек.
  async updateLead(leadId, seenColumnId, patch, events) {
    const keys = Object.keys(patch).filter((k) => PATCHABLE.includes(k));
    return this.tx(async (client) => {
      const sets = keys.map((k, i) => `${k} = $${i + 3}`);
      const { rows: [lead] } = await client.query(
        `UPDATE leads SET ${[...sets, 'updated_at = now()'].join(', ')}
         WHERE id = $1 AND column_id = $2 RETURNING id`,
        [leadId, seenColumnId, ...keys.map((k) => patch[k])]
      );
      if (!lead) throw conflict('Лид уже переместился — обновите воронку');
      await this.journal.appendIn(client, events);
      return this.leadIn(client, leadId);
    });
  }

  async appendEvents(events) {
    return this.tx((client) => this.journal.appendIn(client, events));
  }

  // Новая доска целиком: колонки, переносы лидов из удалённых колонок, события.
  // version — та версия доски, которую видел человек (оптимистичная блокировка).
  async saveBoard(funnelId, version, columns, moves, events, movedEvent) {
    return this.tx(async (client) => {
      const { rows: [funnel] } = await client.query(
        'SELECT board_version FROM lead_funnels WHERE id = $1 FOR UPDATE',
        [funnelId]
      );
      if (!funnel || funnel.board_version !== version) throw conflict('Воронка изменилась — обновите и повторите');
      await this.writeColumns(client, funnelId, columns);
      const moveEvents = [];
      for (const move of moves) {
        const { rows } = await client.query(
          `UPDATE leads SET column_id = $3, updated_at = now()
           WHERE funnel_id = $1 AND column_id = $2 RETURNING id, company`,
          [funnelId, move.from, move.to]
        );
        for (const lead of rows) moveEvents.push(movedEvent(lead, move));
      }
      await client.query(
        'DELETE FROM lead_funnel_columns WHERE funnel_id = $1 AND NOT (id = ANY($2::text[]))',
        [funnelId, columns.map((c) => c.id)]
      );
      await client.query('UPDATE lead_funnels SET board_version = board_version + 1 WHERE id = $1', [funnelId]);
      await this.journal.appendIn(client, [...events, ...moveEvents]);
      return version + 1;
    });
  }

  async leadIn(client, id) {
    const { rows } = await client.query(`${LEAD_SQL} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async writeColumns(client, funnelId, columns) {
    for (const [position, c] of columns.entries()) {
      await client.query(
        `INSERT INTO lead_funnel_columns (funnel_id, id, title, type, position, color, wip_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (funnel_id, id) DO UPDATE
           SET title = EXCLUDED.title, type = EXCLUDED.type, position = EXCLUDED.position,
               color = EXCLUDED.color, wip_limit = EXCLUDED.wip_limit`,
        [funnelId, c.id, c.title, c.type, position, c.color || null, c.limit || null]
      );
    }
  }
}

module.exports = { LeadRepository };
