// Терпеливый вызов LLM для фоновой работы: каждый вызов — один запрос квоты
// платформы (runGuarded) от имени того, кто запустил прогон. Упёрлись в квоту или
// заняты слоты — узел дерева переходит в «ожидание» с причиной и сроком (П38) и
// продолжает сам; ждать дольше потолка — честный отказ с кодом. Слот LLM
// держится только на время одного вызова, а не всего сбора.

const { runGuarded } = require('../llmGuard');
const { completeChat } = require('../llm');
const { sleep } = require('../collectors/patience');

const WAITABLE = new Set(['llm_rate_limit', 'llm_busy', 'llm_cooldown']);

class PatientLlm {
  constructor({
    guard = runGuarded,
    complete = completeChat,
    selection = { provider: 'openai' },
    maxWaitMs = 20 * 60 * 1000,
    busyWaitMs = 5000,
    wait = sleep,
    clock = () => Date.now(),
  } = {}) {
    this.guard = guard;
    this.complete = complete;
    this.selection = selection;
    this.maxWaitMs = maxWaitMs;
    this.busyWaitMs = busyWaitMs;
    this.wait = wait;
    this.clock = clock;
  }

  // Вызов от имени инициатора: actor — req.user того, кто нажал кнопку (П37).
  forActor(actor) {
    return { complete: (messages, ctx) => this._complete(actor, messages, ctx) };
  }

  async _complete(actor, messages, { node, signal } = {}) {
    const started = this.clock();
    for (;;) {
      try {
        return await this.guard({ user: actor }, () => this.complete({ selection: this.selection, messages, temperature: 0.2 }));
      } catch (err) {
        if (!WAITABLE.has(err.code)) throw err;
        const waitMs = err.retryAfterSec ? err.retryAfterSec * 1000 : this.busyWaitMs;
        if (this.clock() - started + waitMs > this.maxWaitMs) {
          const quota = new Error(`квота LLM: ждать дольше ${Math.round(this.maxWaitMs / 60000)} мин`);
          quota.code = 'llm_quota';
          throw quota;
        }
        if (node) node.wait(`${err.code === 'llm_busy' ? 'слоты LLM заняты' : 'квота LLM'} — повтор через ${Math.ceil(waitMs / 1000)} с`);
        await this.wait(waitMs, signal);
        if (node) node.start();
      }
    }
  }
}

module.exports = { PatientLlm };
