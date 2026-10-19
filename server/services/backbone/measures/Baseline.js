// «Сравнение» (тень) — база «до» без риска (docs/backbone-architecture.md §6.6, О25, О19).
// Первые shadowDays дней инструмент разбирает заявки, но менеджер черновик не видит;
// к заявке он прикладывает итоговый счёт из 1С — так известны время до счёта при
// ручной работе и точность черновика против настоящего счёта.
//
// Мера для «Помощи»: сравнение шло не меньше shadowDays, сравнено не меньше minLines
// строк, точность от accuracy. С 18.10.2026 мера — не запрет, а предупреждение: без
// неё помощь включают подтверждением, событие помечает «без меры» (решение пользователя).
// Вердикт — с причиной; решение и снимок «до» — событие. Вернуться в сравнение можно
// всегда: это новая база.

const { DAY_MS } = require('./WorkingHours');

const fmt = (x) => (x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));

class Baseline {
  constructor({ shadowDays = 14, accuracy = 0.8, minLines = 20 } = {}) {
    this.shadowDays = shadowDays;
    this.accuracy = accuracy;
    this.minLines = minLines;
  }

  daysOf(shop, now) {
    return Math.floor((now - new Date(shop.mode_since).getTime()) / DAY_MS);
  }

  // metrics — замеры заявок текущего сравнения (с shop.mode_since). → { ok, reason }
  decide({ shop, metrics, now, shadowDays = this.shadowDays }) {
    if (shop.mode === 'help') return { ok: false, reason: 'помощь уже включена' };
    if (shop.mode !== 'shadow') return { ok: false, reason: 'сравнение не шло — замера «до» нет' };
    const days = this.daysOf(shop, now);
    if (days < shadowDays) return { ok: false, reason: `сравнение идёт ${days} дн. из ${shadowDays} — база «до» ещё не набрана` };
    const { value, base } = metrics.shadowAccuracy;
    if (base < this.minLines) {
      return { ok: false, reason: `сравнено строк: ${base} из нужных ${this.minLines} — приложите итоговые счета из 1С к заявкам` };
    }
    if (value < this.accuracy) return { ok: false, reason: `точность черновика ${fmt(value)} — ниже порога ${fmt(this.accuracy)}` };
    return { ok: true, reason: `точность ${fmt(value)} на ${base} строках за ${days} дн. сравнения` };
  }

  // Снимок «до» — в событие смены режима: с ним сравниваются недели помощи.
  snapshot(metrics, days) {
    return {
      days,
      orders: metrics.orders,
      replyWithinHour: metrics.replyWithinHour,
      replyMinutes: metrics.replyMinutes,
      invoiceMinutes: metrics.invoiceMinutes,
      conversion: metrics.conversion.value,
      accuracy: metrics.shadowAccuracy.value,
      comparedLines: metrics.shadowAccuracy.base,
      helperMs: metrics.helperMs,
    };
  }
}

module.exports = { Baseline };
