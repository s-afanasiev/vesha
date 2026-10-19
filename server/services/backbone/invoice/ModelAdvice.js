// Подсказка «стоит распознать нейросетью» (решение пользователя 19.10.2026): разбор по
// умолчанию механический и бесплатный, модель — только по кнопке. Совет — когда механика
// справилась плохо: остались строки «не разобрано» или велика доля строк «нет в каталоге»
// и неуверенных «выбрать». Чисел здесь не придумываем: совет называет, что именно плохо.

class ModelAdvice {
  constructor({ rawLines = 1, weakShare = 0.2, weakConfidence = 0.7 } = {}) {
    this.rawLines = rawLines;             // столько «не разобрано» — уже повод
    this.weakShare = weakShare;           // доля слабых строк, с которой советуем
    this.weakConfidence = weakConfidence; // «выбрать» ниже этой уверенности — слабая строка
  }

  // строки механического черновика → { advise, reason, raw, missing, weak }
  of(lines) {
    if (!lines.length) return { advise: false, reason: null, raw: 0, missing: 0, weak: 0 };
    const raw = lines.filter((l) => l.origin === 'raw').length;
    const missing = lines.filter((l) => l.state === 'missing' && l.origin !== 'raw').length;
    const weak = lines.filter((l) => l.state === 'ask' && Number(l.confidence) < this.weakConfidence).length;
    const advise = raw >= this.rawLines || (raw + missing + weak) / lines.length >= this.weakShare;
    const what = [raw && `не разобрано строк — ${raw}`, missing && `нет в каталоге — ${missing}`, weak && `неуверенно — ${weak}`].filter(Boolean);
    return {
      advise,
      reason: advise ? `Заявка сложная для механики: ${what.join(', ')} из ${lines.length}. Стоит распознать нейросетью.` : null,
      raw,
      missing,
      weak,
    };
  }
}

module.exports = { ModelAdvice };
