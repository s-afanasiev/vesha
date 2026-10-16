// Журнал событий (docs/backbone-architecture.md §6.1, О15): факты — кто, когда,
// почему. Общий кирпич для заявок костяка и лидов automation-leads: поток
// (stream) различает, scope — чей журнал, subject — о ком событие.
// Пишут в журнал только репозитории, в той же транзакции, что и изменение
// (appendIn); читают — проекции: доска, окно статуса, замеры.
//
// Событие: { stream, scope, subjectId, type, data, actor, cause }.

class Journal {
  constructor(db) {
    this.db = db;
  }

  async appendIn(client, events) {
    for (const e of events) {
      await client.query(
        `INSERT INTO journal_events (stream, scope, subject_id, type, data, actor, cause)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [e.stream, String(e.scope), String(e.subjectId), e.type, JSON.stringify(e.data || {}), e.actor, e.cause || 'manual']
      );
    }
  }

  async forSubject(stream, subjectId) {
    const { rows } = await this.db.query(
      'SELECT * FROM journal_events WHERE stream = $1 AND subject_id = $2 ORDER BY id',
      [stream, String(subjectId)]
    );
    return rows;
  }

  async forScope(scope, { limit = 200 } = {}) {
    const { rows } = await this.db.query(
      'SELECT * FROM journal_events WHERE scope = $1 ORDER BY id DESC LIMIT $2',
      [String(scope), limit]
    );
    return rows;
  }

  // Журнал магазина целиком, по порядку — вход замеров (шаг 3).
  async history(scope) {
    const { rows } = await this.db.query(
      'SELECT * FROM journal_events WHERE scope = $1 ORDER BY id',
      [String(scope)]
    );
    return rows;
  }
}

// Честный простой узел (О6): тот же контракт в памяти — для тестов и прогона без базы.
// clock — время событий: тесты замеров двигают его сами.
class MemoryJournal {
  constructor({ clock = () => new Date() } = {}) {
    this.events = [];
    this.clock = clock;
  }

  now() {
    return this.clock().toISOString();
  }

  async appendIn(_client, events) {
    for (const e of events) {
      this.events.push({
        id: this.events.length + 1,
        stream: e.stream,
        scope: String(e.scope),
        subject_id: String(e.subjectId),
        type: e.type,
        data: { ...(e.data || {}) },
        actor: e.actor,
        cause: e.cause || 'manual',
        at: this.now(),
      });
    }
  }

  async forSubject(stream, subjectId) {
    return this.events.filter((e) => e.stream === stream && e.subject_id === String(subjectId));
  }

  async forScope(scope, { limit = 200 } = {}) {
    return this.events.filter((e) => e.scope === String(scope)).reverse().slice(0, limit);
  }

  async history(scope) {
    return this.events.filter((e) => e.scope === String(scope));
  }
}

module.exports = { Journal, MemoryJournal };
