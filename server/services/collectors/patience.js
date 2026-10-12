// Терпение источника — обёртка-способность каркаса (П19): тот же контракт, что у
// адаптера, плюс пауза между любыми вызовами и стоп, когда источник попросил
// остановиться (403/429). Один экземпляр на ресурс для всех потребителей
// (docs/collectors-architecture.md): два прогона не стучатся к ресурсу вдвое чаще.
// После отказа ресурс остывает: новые вызовы до конца остывания — сразу отказ
// с причиной, без обращения к источнику. Числа — в декларации (П6).

const { SourceHttpError } = require('./http');

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  const err = new Error('остановлено');
  err.name = 'AbortError';
  return err;
}

class Patience {
  constructor(target, { gapMs, cooldownMs = 30 * 60 * 1000, methods, clock = () => Date.now(), wait = sleep } = {}) {
    this.target = target;
    this.gapMs = gapMs;
    this.cooldownMs = cooldownMs;
    this.clock = clock;
    this.wait = wait;
    this.lastAt = -Infinity; // первый вызов — без паузы
    this.calls = 0;
    this.refused = null;
    this.queue = Promise.resolve();
    for (const name of methods || target.methods || []) {
      this[name] = (...args) => this._call(name, args);
    }
  }

  // Состояние для экрана: сколько обращений, когда и почему источник отказал.
  status() {
    const cooling = this.refused && this.clock() - this.refused.at < this.cooldownMs;
    return { calls: this.calls, refused: cooling ? this.refused : null };
  }

  // Вызовы встают в очередь: пауза отсчитывается от конца предыдущего вызова.
  _call(name, args) {
    const run = this.queue.then(() => this._run(name, args));
    this.queue = run.catch(() => {});
    return run;
  }

  async _run(name, args) {
    const opts = args[args.length - 1];
    const signal = opts && typeof opts === 'object' ? opts.signal : undefined;
    if (signal && signal.aborted) throw abortError(); // прогон остановлен — к источнику не идём
    if (this.refused && this.clock() - this.refused.at < this.cooldownMs) {
      throw new SourceHttpError('refused', `источник просил остановиться (${this.refused.reason}), остываем`, this.refused.status);
    }
    const left = this.lastAt + this.gapMs - this.clock();
    if (left > 0) await this.wait(left, signal); // отмена во время паузы — к источнику не ходили
    try {
      return await this.target[name](...args);
    } catch (err) {
      if (signal && signal.aborted) throw abortError(); // отмена — не поломка источника
      if (err && (err.status === 403 || err.status === 429)) {
        this.refused = { at: this.clock(), status: err.status, reason: `${err.status} на ${name}` };
        throw new SourceHttpError('refused', `источник ответил ${err.status} — стоп`, err.status);
      }
      throw err;
    } finally {
      this.calls += 1;
      this.lastAt = this.clock();
    }
  }
}

module.exports = { Patience, sleep, abortError };
