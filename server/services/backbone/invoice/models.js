// Модель для разбора строк (docs/backbone-architecture.md §4: Guarded(llm, { timeoutMs })).
//
// GuardedLlm — вызов через шлюз платформы: квота и слоты runGuarded от имени того,
// кто нажал «Разобрать» (П37), серверный пресет провайдера; ключи — не здесь, а в
// окружении шлюза. Упёрлись в квоту — ошибка с кодом, ModelLines делает из неё
// результат «не разобрано» (П24); ждать квоту в запросе менеджера не будем.
//
// RecordedLlm — заместитель для тестов и прогонов без сети (О6): записанные ответы,
// незаписанный запрос — именованный отказ, а не выдумка.

const { runGuarded } = require('../../llmGuard');
const { completeChat } = require('../../llm');

class GuardedLlm {
  constructor({ guard = runGuarded, complete = completeChat, selection = { provider: 'openai' }, timeoutMs = 20_000 } = {}) {
    this.guard = guard;
    this.complete = complete;
    this.selection = selection;
    this.timeoutMs = timeoutMs;
  }

  forActor(user) {
    return {
      complete: (messages) => this.guard({ user: user || null }, () => this.complete({
        selection: this.selection, messages, temperature: 0, timeoutMs: this.timeoutMs,
      })),
    };
  }
}

class RecordedLlm {
  // records: [{ match: 'подстрока запроса', text: 'ответ' | object, error?: { code, message } }]
  constructor(records = []) {
    this.records = records;
    this.prompts = [];
  }

  forActor() {
    return this;
  }

  async complete(messages) {
    const prompt = String((messages.filter((m) => m.role === 'user').pop() || {}).content || '');
    this.prompts.push(prompt);
    const record = this.records.find((r) => prompt.includes(r.match));
    if (!record) throw Object.assign(new Error('нет записанного ответа модели на этот запрос'), { code: 'not_recorded' });
    if (record.error) throw Object.assign(new Error(record.error.message || 'сбой модели'), { code: record.error.code });
    return { text: typeof record.text === 'string' ? record.text : JSON.stringify(record.text) };
  }
}

module.exports = { GuardedLlm, RecordedLlm };
