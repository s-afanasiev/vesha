// Дверь территории chat-engine (П28): снаружи — сценарии домена, механику
// собирает сама. Все записи в диалоги/сообщения/этапы идут только отсюда,
// правила воронки проверяются здесь же (П27: у инварианта есть дом).

const MAX_TEXT_LENGTH = 4000;

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanText(value, what) {
  const text = String(value || '').trim();
  if (!text) throw bad(`${what}: пустой текст`);
  if (text.length > MAX_TEXT_LENGTH) throw bad(`${what}: не длиннее ${MAX_TEXT_LENGTH} символов`);
  return text;
}

class ChatDesk {
  constructor({ repository, suggester, funnel }) {
    this.repository = repository;
    this.suggester = suggester;
    this.funnel = funnel;
  }

  // Точка входа адаптера платформы: web-виджет сейчас, vk/telegram — те же аргументы.
  async receiveVisitorMessage({ channel, visitorKey, visitorName, text, externalId }) {
    if (!visitorKey) throw bad('visitorKey обязателен');
    return this.repository.receiveVisitorMessage({
      channel: channel || 'web',
      visitorKey,
      visitorName,
      text: cleanText(text, 'Сообщение'),
      externalId,
    });
  }

  async board() {
    const dialogues = await this.repository.dialogues();
    return { stages: this.funnel.snapshot(), dialogues };
  }

  async history(dialogueId) {
    const dialogue = await this.repository.dialogueById(dialogueId);
    if (!dialogue) throw bad('Диалог не найден', 404);
    const messages = await this.repository.messagesOf(dialogueId);
    return { dialogue, messages };
  }

  async visitorDialogue({ channel, visitorKey }) {
    const dialogues = await this.repository.dialogues();
    const dialogue = dialogues.find(
      (d) => d.channel === (channel || 'web') && d.visitor_key === visitorKey
    );
    if (!dialogue) return { dialogue: null, messages: [] };
    const messages = await this.repository.messagesOf(dialogue.id, { roles: ['visitor', 'manager'] });
    return { dialogue, messages };
  }

  async managerSends(dialogueId, text, actor) {
    return this.repository.addManagerMessage(dialogueId, cleanText(text, 'Ответ'));
  }

  async proposeReply(dialogueId, selection) {
    return this.suggester.run(dialogueId, selection);
  }

  // Отправить черновик как есть (text не задан) или с правкой менеджера.
  async approveDraft(messageId, { text, actor } = {}) {
    const draft = await this.repository.resolveDraft(messageId, {
      state: text ? 'edited' : 'approved',
      text: text ? cleanText(text, 'Правка') : null,
    });
    await this.repository.addManagerMessage(draft.dialogue_id, draft.text);
    return draft;
  }

  async rejectDraft(messageId, actor) {
    return this.repository.resolveDraft(messageId, { state: 'rejected' });
  }

  async setStage(dialogueId, stage, { actor, cause } = {}) {
    if (!this.funnel.isKnown(stage)) throw bad(`Неизвестный этап: ${stage}`);
    return this.repository.setStage(dialogueId, stage, {
      actor: actor || 'guest',
      cause: cause || 'manual',
    });
  }

  async updateCard(dialogueId, { notes, visitorName }) {
    const patch = {};
    if (notes !== undefined) patch.notes = String(notes || '').slice(0, 2000);
    if (visitorName !== undefined && String(visitorName).trim()) {
      patch.visitorName = String(visitorName).trim().slice(0, 120);
    }
    return this.repository.updateCard(dialogueId, patch);
  }

  async persona() {
    return this.repository.persona();
  }

  async savePersona(value) {
    const text = String(value || '').trim();
    if (!text) throw bad('Персона не может быть пустой');
    await this.repository.savePersona(text);
  }
}

module.exports = { ChatDesk };
