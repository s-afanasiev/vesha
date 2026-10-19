// «Не больше N за окно» по ключу (адрес, почта): честный простой узел (О6) для
// защиты открытых ручек от перебора и наплыва — вход, форма заявки, чат витрины.
// Счёт — в памяти процесса: один экземпляр сервера, рестарт счёт обнуляет (это
// допустимо: окно — минуты). Ключей без свежих отметок больше maxKeys не держим.

class RateWindow {
  constructor({ max, windowMs, maxKeys = 50_000, clock = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.clock = clock;
    this.hits = new Map(); // ключ → моменты отметок в окне
  }

  recent(key) {
    const now = this.clock();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  full(key) {
    return this.recent(key).length >= this.max;
  }

  hit(key) {
    const list = this.recent(key);
    list.push(this.clock());
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.sweep();
  }

  // Отметить, если окно не полно: true — прошло, false — отказ.
  take(key) {
    if (this.full(key)) return false;
    this.hit(key);
    return true;
  }

  reset(key) {
    this.hits.delete(key);
  }

  // Через сколько секунд освободится место — для Retry-After.
  retryAfterSec(key) {
    const [first] = this.recent(key);
    return first == null ? 0 : Math.max(1, Math.ceil((first + this.windowMs - this.clock()) / 1000));
  }

  sweep() {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

module.exports = { RateWindow };
