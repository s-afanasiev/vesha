// Работа «предложи ответ» (один глагол, П12): собирает промпт из персоны,
// карточки и истории, зовёт LLM один раз, кладёт черновик в диалог.
// БД трогает только через DialogueRepository, про HTTP не знает (П30).
//
// Сбой LLM — результат { ok: false, code, message }, а не исключение (П24):
// конвейер не падает, менеджер видит честную причину (урок Scout+Anna F3).

const CHANNEL_LABELS = { web: 'сайт', vk: 'ВКонтакте', telegram: 'Telegram' };

class ReplySuggester {
  constructor({ repository, completeChat, funnel, historyLimit = 30 }) {
    this.repository = repository;
    this.completeChat = completeChat;
    this.funnel = funnel;
    this.historyLimit = historyLimit;
  }

  async run(dialogueId, selection) {
    const dialogue = await this.repository.dialogueById(dialogueId);
    if (!dialogue) {
      return { ok: false, code: 'no_dialogue', message: 'Диалог не найден' };
    }

    const history = await this.repository.messagesOf(dialogueId, {
      limit: this.historyLimit,
      roles: ['visitor', 'manager'],
    });
    if (!history.length) {
      return { ok: false, code: 'nothing_to_answer', message: 'В диалоге ещё нет сообщений' };
    }

    const persona = await this.repository.persona();
    const messages = this.buildMessages(dialogue, persona, history);

    try {
      const result = await this.completeChat({
        selection: selection || undefined,
        messages,
        temperature: 0.4,
      });
      const text = String(result.text || '').trim();
      if (!text) {
        return { ok: false, code: 'empty_reply', message: 'Модель вернула пустой ответ' };
      }
      const draft = await this.repository.createDraft(dialogueId, text);
      return { ok: true, draft, provider: result.provider, model: result.model };
    } catch (err) {
      return {
        ok: false,
        code: err.code || 'llm_error',
        message: err.message || 'Не удалось получить ответ от модели',
      };
    }
  }

  buildMessages(dialogue, persona, history) {
    const now = new Date();
    const dateLine = `Сегодня: ${now.toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC).`;
    const channel = CHANNEL_LABELS[dialogue.channel] || dialogue.channel;
    const notes = (dialogue.notes || '').trim() || 'нет';

    const system = [
      dateLine,
      'Персона и правила ассистента:',
      persona,
      'Контекст диалога:',
      `- Клиент: ${dialogue.visitor_name}`,
      `- Канал: ${channel}`,
      `- Этап воронки: ${this.funnel.labelOf(dialogue.stage)}`,
      `- Заметки менеджера: ${notes}`,
      'История переписки — ниже. Предложи ОДИН ответ на последнее сообщение клиента.',
      'Верни только текст ответа: без пояснений, кавычек и разметки.',
    ].join('\n\n');

    return [
      { role: 'system', content: system },
      ...history.map((m) => ({
        role: m.role === 'visitor' ? 'user' : 'assistant',
        content: m.text,
      })),
      { role: 'user', content: 'Предложи ответ клиенту прямо сейчас. Только текст ответа.' },
    ];
  }
}

module.exports = { ReplySuggester };
