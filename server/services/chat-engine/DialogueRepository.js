// Владелец истины chat_engine_* (docs/chat-engine-architecture.md): все SQL
// территории живут здесь. Время — UTC в БД; «чей мяч» (last_incoming/last_outgoing)
// пишется той же транзакцией, что и сообщение (урок Scout+Anna F6).
//
// db — исполнитель с query() / withClient() (server/db.js), инъектируется в
// конструкторе: репозиторий не импортирует инфраструктуру сам (П7).
//
// Территория: таблицы общие у демо chat-engine и ассистента магазинов (костяк), а
// граница — здесь: репозиторий видит и правит только разговоры своих каналов
// (channels) и читает свою персону (personaKey). Разговор чужого канала по id —
// «не найден», как несуществующий; id не в форме UUID — тоже, а не ошибка базы.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v) => UUID.test(String(v));

function notFound(message = 'Диалог не найден') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

class DialogueRepository {
  constructor(db, { channels = ['web'], personaKey = 'persona' } = {}) {
    this.db = db;
    this.channels = channels;     // каналы территории: только их разговоры видны и правятся
    this.personaKey = personaKey; // ключ персоны территории в chat_engine_settings
  }

  // Разговоры территории — для условий по dialogue_id; n — номер параметра со списком каналов.
  own(n) {
    return `(SELECT id FROM chat_engine_dialogues WHERE channel = ANY($${n}::text[]))`;
  }

  async dialogueById(id) {
    if (!isId(id)) return null;
    const { rows } = await this.db.query(
      'SELECT * FROM chat_engine_dialogues WHERE id = $1 AND channel = ANY($2::text[])',
      [id, this.channels]
    );
    return rows[0] || null;
  }

  async ensureDialogue(client, { channel, visitorKey, visitorName }) {
    if (!this.channels.includes(channel)) {
      const err = new Error(`Канал «${channel}» не этой территории`);
      err.status = 400;
      throw err;
    }
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
        // external_id уникален на всю базу; разговор чужой территории наружу не называем
        const dup = await client.query(
          `SELECT m.dialogue_id, d.channel FROM chat_engine_messages m
           JOIN chat_engine_dialogues d ON d.id = m.dialogue_id WHERE m.external_id = $1`,
          [externalId]
        );
        if (dup.rows[0]) {
          const { dialogue_id: id, channel } = dup.rows[0];
          return { duplicate: true, dialogueId: this.channels.includes(channel) ? id : null };
        }
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
    if (!isId(dialogueId)) return [];
    const filters = ['dialogue_id = $1', `dialogue_id IN ${this.own(2)}`];
    const params = [dialogueId, this.channels];
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
      WHERE d.channel = ANY($1::text[])
      ORDER BY d.last_incoming_at DESC NULLS LAST, d.created_at DESC
    `, [this.channels]);
    return rows;
  }

  async createDraft(dialogueId, text) {
    if (!(await this.dialogueById(dialogueId))) throw notFound();
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
    if (!isId(messageId)) throw notFound('Черновик не найден');
    const { rows } = await this.db.query(
      `UPDATE chat_engine_messages
       SET state = $2,
           text = COALESCE($3, text),
           resolved_at = now()
       WHERE id = $1 AND role = 'draft' AND state = 'open' AND dialogue_id IN ${this.own(4)}
       RETURNING *`,
      [messageId, state, text || null, this.channels]
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
    if (!isId(dialogueId)) throw notFound();
    return this.db.withClient(async (client) => {
      const locked = await client.query(
        'SELECT * FROM chat_engine_dialogues WHERE id = $1 AND channel = ANY($2::text[]) FOR UPDATE',
        [dialogueId, this.channels]
      );
      const dialogue = locked.rows[0];
      if (!dialogue) throw notFound();

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
    if (!isId(dialogueId)) throw notFound();
    return this.db.withClient(async (client) => {
      const locked = await client.query(
        'SELECT stage FROM chat_engine_dialogues WHERE id = $1 AND channel = ANY($2::text[]) FOR UPDATE',
        [dialogueId, this.channels]
      );
      const from = locked.rows[0] && locked.rows[0].stage;
      if (!from) throw notFound();
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
    if (!isId(dialogueId)) throw notFound();
    const { rows } = await this.db.query(
      `UPDATE chat_engine_dialogues
       SET notes = COALESCE($2, notes),
           visitor_name = COALESCE($3, visitor_name)
       WHERE id = $1 AND channel = ANY($4::text[])
       RETURNING *`,
      [dialogueId, notes ?? null, visitorName ?? null, this.channels]
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  // Забыть разговоры посетителей (удаление их персональных данных): разговор, сообщения
  // и журнал этапов — каскадом. Только своя территория и только ключи с prefix — ключ
  // владельца (у магазинов костяка — «<id магазина>:»); пустой prefix — отказ, а не «всё».
  // Какие: по ключу посетителя, по id или без движения с idleBefore. → id забытых.
  async forget({ prefix, visitorKeys = [], ids = [], idleBefore = null }) {
    if (!prefix) throw new Error('forget: нужен prefix ключей посетителей');
    const { rows } = await this.db.query(
      `DELETE FROM chat_engine_dialogues
       WHERE channel = ANY($1::text[]) AND starts_with(visitor_key, $2)
         AND (visitor_key = ANY($3::text[]) OR id = ANY($4::uuid[])
              OR ($5::timestamptz IS NOT NULL AND GREATEST(created_at, last_incoming_at, last_outgoing_at) < $5))
       RETURNING id`,
      [this.channels, prefix, visitorKeys, ids.filter(isId), idleBefore]
    );
    return rows.map((r) => r.id);
  }

  async persona() {
    const { rows } = await this.db.query(
      'SELECT value FROM chat_engine_settings WHERE key = $1',
      [this.personaKey]
    );
    return rows[0] ? rows[0].value : '';
  }

  async savePersona(value) {
    await this.db.query(
      `INSERT INTO chat_engine_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [this.personaKey, value]
    );
  }
}

module.exports = { DialogueRepository };
