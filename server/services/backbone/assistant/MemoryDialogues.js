// Честный простой узел (О6): контракт DialogueRepository ядра chat-engine в памяти —
// для тестов ассистента без базы. Те же правила, что у Postgres: один разговор на
// посетителя канала, дедуп по external_id, новое входящее гасит открытый черновик,
// не больше одного открытого черновика, ответ менеджера переводит new → in_work.

const crypto = require('node:crypto');

class MemoryDialogues {
  constructor({ persona = 'Ты — ассистент менеджера компании.', clock = () => new Date() } = {}) {
    this.rows = [];
    this.msgs = [];
    this.personaText = persona;
    this.clock = clock;
    this.seq = 0;
  }

  now() {
    // строго растущее время: порядок сообщений не зависит от скорости теста
    this.seq += 1;
    return new Date(this.clock().getTime() + this.seq).toISOString();
  }

  async dialogueById(id) {
    const d = this.rows.find((r) => r.id === id);
    return d ? { ...d } : null;
  }

  async receiveVisitorMessage({ channel, visitorKey, visitorName, text, externalId }) {
    if (externalId) {
      const dup = this.msgs.find((m) => m.external_id === externalId);
      if (dup) return { duplicate: true, dialogueId: dup.dialogue_id };
    }
    let dialogue = this.rows.find((r) => r.channel === channel && r.visitor_key === visitorKey);
    if (!dialogue) {
      dialogue = {
        id: crypto.randomUUID(), channel, visitor_key: visitorKey, visitor_name: visitorName || 'Гость',
        stage: 'new', notes: '', last_incoming_at: null, last_outgoing_at: null, created_at: this.now(),
      };
      this.rows.push(dialogue);
    }
    const message = this.push(dialogue.id, 'visitor', 'sent', text, externalId);
    dialogue.last_incoming_at = message.created_at;
    this.supersede(dialogue.id);
    return { duplicate: false, dialogue: { ...dialogue }, message: { ...message } };
  }

  push(dialogueId, role, state, text, externalId = null) {
    const m = { id: crypto.randomUUID(), dialogue_id: dialogueId, role, state, text, external_id: externalId || null, created_at: this.now(), resolved_at: null };
    this.msgs.push(m);
    return m;
  }

  supersede(dialogueId) {
    for (const m of this.msgs) {
      if (m.dialogue_id === dialogueId && m.role === 'draft' && m.state === 'open') Object.assign(m, { state: 'superseded', resolved_at: this.now() });
    }
  }

  async messagesOf(dialogueId, { limit, roles } = {}) {
    const own = this.msgs.filter((m) => m.dialogue_id === dialogueId && (!roles || roles.includes(m.role))).map((m) => ({ ...m }));
    return limit ? own.slice(-limit) : own;
  }

  async dialogues() {
    return this.rows.map((d) => {
      const talk = this.msgs.filter((m) => m.dialogue_id === d.id && (m.role === 'visitor' || m.role === 'manager'));
      const last = talk[talk.length - 1];
      return {
        ...d,
        last_text: last ? last.text : null,
        last_role: last ? last.role : null,
        open_drafts: String(this.msgs.filter((m) => m.dialogue_id === d.id && m.role === 'draft' && m.state === 'open').length),
      };
    }).sort((a, b) => String(b.last_incoming_at || '').localeCompare(String(a.last_incoming_at || '')));
  }

  async createDraft(dialogueId, text) {
    this.supersede(dialogueId);
    return { ...this.push(dialogueId, 'draft', 'open', text) };
  }

  async resolveDraft(messageId, { state, text }) {
    const m = this.msgs.find((x) => x.id === messageId && x.role === 'draft' && x.state === 'open');
    if (!m) throw Object.assign(new Error('Черновик уже обработан или устарел'), { status: 409 });
    Object.assign(m, { state, text: text || m.text, resolved_at: this.now() });
    return { ...m };
  }

  async addManagerMessage(dialogueId, text) {
    const d = this.rows.find((r) => r.id === dialogueId);
    if (!d) throw Object.assign(new Error('Диалог не найден'), { status: 404 });
    const message = this.push(dialogueId, 'manager', 'sent', text);
    d.last_outgoing_at = message.created_at;
    let moved = null;
    if (d.stage === 'new') { d.stage = 'in_work'; moved = 'in_work'; }
    return { message: { ...message }, stageMovedTo: moved };
  }

  async setStage(dialogueId, toStage) {
    const d = this.rows.find((r) => r.id === dialogueId);
    if (!d) throw Object.assign(new Error('Диалог не найден'), { status: 404 });
    const from = d.stage;
    d.stage = toStage;
    return { from, to: toStage, changed: from !== toStage };
  }

  async updateCard(dialogueId, { notes, visitorName }) {
    const d = this.rows.find((r) => r.id === dialogueId);
    if (!d) throw Object.assign(new Error('Диалог не найден'), { status: 404 });
    if (notes != null) d.notes = notes;
    if (visitorName != null) d.visitor_name = visitorName;
    return { ...d };
  }

  async persona() {
    return this.personaText;
  }

  async savePersona(value) {
    this.personaText = value;
  }
}

module.exports = { MemoryDialogues };
