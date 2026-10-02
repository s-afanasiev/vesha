// Владелец истины chat_engine_* (docs/chat-engine-architecture.md): все SQL
// территории живут здесь. Время — UTC в БД; «чей мяч» (last_incoming/last_outgoing)
// пишется той же транзакцией, что и сообщение (урок Scout+Anna F6).
//
// db — исполнитель с query() / withClient() (server/db.js), инъектируется в
// конструкторе: репозиторий не импортирует инфраструктуру сам (П7).

class DialogueRepository {
  constructor(db) {
    this.db = db;
  }

  async dialogueById(id) {
    const { rows } = await this.db.query(
      'SELECT * FROM chat_engine_dialogues WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async ensureDialogue(client, { channel, visitorKey, visitorName }) {
    const existing = await client.query(
      'SELECT * FROM chat_engine_dialogues WHERE channel = $1 AND visitor_key = $2 FOR UPDATE',
      [channel, visitorKey]
    );
    if (existing.rows[0]) return existing.rows[0];

    const created = await client.query(
      `INSERT INTO chat_engine_dialogues (channel, visitor_key, visitor_name)
       VALUES ($1, $2, $3) RETURNING *`,
      [channel, visitorKey, visitorName || 'Гость']
    );
    return created.rows[0];
  }

  // Входящее сообщение посетителя: диалог, дедуп, запись, «чей мяч», гашение
  // открытых черновиков — одна транзакция (урок F4: новое входящее устаревает черновик).
  async receiveVisitorMessage({ channel, visitorKey, visitorName, text, externalId }) {
    return this.db.withClient(async (client) => {
      if (externalId) {
        const dup = await client.query(
          'SELECT dialogue_id FROM chat_engine_messages WHERE external_id = $1',
          [externalId]
        );
        if (dup.rows[0]) return { duplicate: true, dialogueId: dup.rows[0].dialogue_id };
      }

      const dialogue = await this.ensureDialogue(client, { channel, visitorKey, visitorName });

      const inserted = await client.query(
        `INSERT INTO chat_engine_messages (dialogue_id, role, state, text, external_id)
         VALUES ($1, 'visitor', 'sent', $2, $3) RETURNING *`,
        [dialogue.id, text, externalId || null]
      );
      await client.query(
        'UPDATE chat_engine_dialogues SET last_incoming_at = now() WHERE id = $1',
        [dialogue.id]
      );
      await client.query(
        `UPDATE chat_engine_messages SET state = 'superseded', resolved_at = now()
         WHERE dialogue_id = $1 AND role = 'draft' AND state = 'open'`,
        [dialogue.id]
      );

      return { duplicate: false, dialogue, message: inserted.rows[0] };
    });
  }

  async messagesOf(dialogueId, { limit, roles } = {}) {
    const filters = ['dialogue_id = $1'];
    const params = [dialogueId];
    if (roles) {
      params.push(roles);
      filters.push(`role = ANY($${params.length})`);
    }
    const where = filters.join(' AND ');
    const order = limit ? 'DESC' : 'ASC';
    const sql = `SELECT * FROM chat_engine_messages WHERE ${where} ORDER BY created_at ${order}, id ${order}`;
    const { rows } = limit
      ? await this.db.query(`SELECT * FROM (${sql}) recent ORDER BY created_at ASC, id ASC`, params)
      : await this.db.query(sql, params);
    return rows;
  }

  // Доска: диалоги + последний содержательный ход + число открытых черновиков.
  async dialogues() {
    const { rows } = await this.db.query(`
      SELECT d.*,
        (SELECT text FROM chat_engine_messages m
          WHERE m.dialogue_id = d.id AND m.role IN ('visitor', 'manager')
          ORDER BY created_at DESC, id DESC LIMIT 1) AS last_text,
        (SELECT role FROM chat_engine_messages m
          WHERE m.dialogue_id = d.id AND m.role IN ('visitor', 'manager')
          ORDER BY created_at DESC, id DESC LIMIT 1) AS last_role,
        (SELECT count(*) FROM chat_engine_messages m
          WHERE m.dialogue_id = d.id AND m.role = 'draft' AND m.state = 'open') AS open_drafts
      FROM chat_engine_dialogues d
      ORDER BY d.last_incoming_at DESC NULLS LAST, d.created_at DESC
    `);
    return rows;
  }

  async createDraft(dialogueId, text) {
    return this.db.withClient(async (client) => {
      // Инвариант территории: не больше одного открытого черновика на диалог.
      await client.query(
        `UPDATE chat_engine_messages SET state = 'superseded', resolved_at = now()
         WHERE dialogue_id = $1 AND role = 'draft' AND state = 'open'`,
        [dialogueId]
      );
      const { rows } = await client.query(
        `INSERT INTO chat_engine_messages (dialogue_id, role, state, text)
         VALUES ($1, 'draft', 'open', $2) RETURNING *`,
        [dialogueId, text]
      );
      return rows[0];
    });
  }

  async resolveDraft(messageId, { state, text }) {
    const { rows } = await this.db.query(
      `UPDATE chat_engine_messages
       SET state = $2,
           text = COALESCE($3, text),
           resolved_at = now()
       WHERE id = $1 AND role = 'draft' AND state = 'open'
       RETURNING *`,
      [messageId, state, text || null]
    );
    if (!rows[0]) {
      const err = new Error('Черновик уже обработан или устарел');
      err.status = 409;
      throw err;
    }
    return rows[0];
  }

  // Ответ менеджера: запись, «чей мяч», авто-переход new → in_work — одна транзакция.
  async addManagerMessage(dialogueId, text) {
    return this.db.withClient(async (client) => {
      const locked = await client.query(
        'SELECT * FROM chat_engine_dialogues WHERE id = $1 FOR UPDATE',
        [dialogueId]
      );
      const dialogue = locked.rows[0];
      if (!dialogue) {
        const err = new Error('Диалог не найден');
        err.status = 404;
        throw err;
      }

      const { rows } = await client.query(
        `INSERT INTO chat_engine_messages (dialogue_id, role, state, text)
         VALUES ($1, 'manager', 'sent', $2) RETURNING *`,
        [dialogueId, text]
      );
      await client.query(
        'UPDATE chat_engine_dialogues SET last_outgoing_at = now() WHERE id = $1',
        [dialogueId]
      );

      let moved = null;
      if (dialogue.stage === 'new') {
        await client.query(
          'UPDATE chat_engine_dialogues SET stage = $2 WHERE id = $1',
          [dialogueId, 'in_work']
        );
        await client.query(
          `INSERT INTO chat_engine_stage_log (dialogue_id, from_stage, to_stage, actor, cause)
           VALUES ($1, 'new', 'in_work', $2, 'manager_reply')`,
          [dialogueId, 'system']
        );
        moved = 'in_work';
      }

      return { message: rows[0], stageMovedTo: moved };
    });
  }

  // Единственная дверь смены этапа: переход + журнал одной транзакцией (урок F1).
  async setStage(dialogueId, toStage, { actor, cause }) {
    return this.db.withClient(async (client) => {
      const locked = await client.query(
        'SELECT stage FROM chat_engine_dialogues WHERE id = $1 FOR UPDATE',
        [dialogueId]
      );
      const from = locked.rows[0] && locked.rows[0].stage;
      if (!from) {
        const err = new Error('Диалог не найден');
        err.status = 404;
        throw err;
      }
      if (from === toStage) return { from, to: toStage, changed: false };

      await client.query('UPDATE chat_engine_dialogues SET stage = $2 WHERE id = $1', [
        dialogueId,
        toStage,
      ]);
      await client.query(
        `INSERT INTO chat_engine_stage_log (dialogue_id, from_stage, to_stage, actor, cause)
         VALUES ($1, $2, $3, $4, $5)`,
        [dialogueId, from, toStage, actor, cause || 'manual']
      );
      return { from, to: toStage, changed: true };
    });
  }

  async updateCard(dialogueId, { notes, visitorName }) {
    const { rows } = await this.db.query(
      `UPDATE chat_engine_dialogues
       SET notes = COALESCE($2, notes),
           visitor_name = COALESCE($3, visitor_name)
       WHERE id = $1
       RETURNING *`,
      [dialogueId, notes ?? null, visitorName ?? null]
    );
    if (!rows[0]) {
      const err = new Error('Диалог не найден');
      err.status = 404;
      throw err;
    }
    return rows[0];
  }

  async persona() {
    const { rows } = await this.db.query(
      'SELECT value FROM chat_engine_settings WHERE key = $1',
      ['persona']
    );
    return rows[0] ? rows[0].value : '';
  }

  async savePersona(value) {
    await this.db.query(
      `INSERT INTO chat_engine_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      ['persona', value]
    );
  }
}

module.exports = { DialogueRepository };
