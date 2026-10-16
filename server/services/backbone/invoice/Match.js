// Сопоставление строки заявки с позицией каталога — без модели (docs/backbone-architecture.md
// §6.5 п. 3): синоним магазина, затем атрибуты наименования и похожесть слов.
//
// Правило отбора: тип изделия совпадает; размер, стандарт, класс и покрытие, если
// клиент их назвал, не противоречат позиции. Названное и совпавшее — полный вес;
// не названное — неполный: позиция может быть не той. Близкий второй кандидат
// снижает уверенность — это и есть «выбрать из 2–3».
//
// Уверенность от autoAccept — строка принята; от ask — показаны кандидаты;
// ниже — «нет в каталоге» (кандидаты, если есть, всё равно видны менеджеру).

const WEIGHTS = { dims: 0.45, standard: 0.15, grade: 0.1, coating: 0.1, words: 0.2 };

class Match {
  constructor(index, {
    autoAccept = 0.9,
    ask = 0.6,
    synonymConfidence = 0.97,  // синоним — решение менеджера, но фраза могла значить другое
    unspecified = 0.85,        // клиент не назвал атрибут, а у позиции он есть
    defaultCoating = null,     // покрытие «по умолчанию» магазина: не названо — скорее оно
    ambiguity = 0.3,           // штраф за второго кандидата вровень с первым
    gapWindow = 0.08,          // отрыв от второго, при котором штрафа нет
    unknownKind = 0.7,         // тип изделия не распознан — искали по всему каталогу
    maxCandidates = 3,
    weights = WEIGHTS,
  } = {}) {
    this.index = index;
    this.autoAccept = autoAccept;
    this.ask = ask;
    this.synonymConfidence = synonymConfidence;
    this.unspecified = unspecified;
    this.defaultCoating = defaultCoating;
    this.ambiguity = ambiguity;
    this.gapWindow = gapWindow;
    this.unknownKind = unknownKind;
    this.maxCandidates = maxCandidates;
    this.weights = weights;
  }

  stateOf(confidence) {
    if (confidence >= this.autoAccept) return 'accepted';
    if (confidence >= this.ask) return 'ask';
    return 'missing';
  }

  // строка { name } → { sku, confidence, state, candidates: [{ sku, score }], via }
  of(line, synonyms) {
    const known = synonyms && synonyms.lookup(line.name);
    if (known && this.index.bySku(known)) {
      const confidence = this.synonymConfidence;
      return { sku: known, confidence, state: this.stateOf(confidence), candidates: [{ sku: known, score: confidence }], via: 'synonym' };
    }
    const attrs = this.index.parse(line.name);
    const scored = [];
    for (const entry of this.index.pool(attrs.kind)) {
      const score = this.score(attrs, entry.attrs);
      if (score > 0) scored.push({ sku: entry.item.sku, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return { sku: null, confidence: 0, state: 'missing', candidates: [], via: 'attributes' };

    // второй кандидат ближе окна — уверенность падает вплоть до доли ambiguity
    const [top, second] = scored;
    const gap = second ? top.score - second.score : this.gapWindow;
    let confidence = top.score * (1 - this.ambiguity * Math.max(0, 1 - gap / this.gapWindow));
    if (!attrs.kind) confidence *= this.unknownKind;
    confidence = round(confidence);
    const state = this.stateOf(confidence);
    return {
      sku: state === 'missing' ? null : top.sku,
      confidence,
      state,
      candidates: scored.slice(0, state === 'accepted' ? 1 : this.maxCandidates).map((c) => ({ sku: c.sku, score: round(c.score) })),
      via: 'attributes',
    };
  }

  // 0 — позиция противоречит строке; иначе сумма весов совпадений.
  score(line, item) {
    const w = this.weights;
    const dims = dimsScore(line.dims, item.dims);
    if (dims === 0) return 0;
    let score = w.dims * dims;
    for (const key of ['standard', 'grade']) {
      if (line[key]) {
        if (line[key] !== item[key]) return 0;
        score += w[key];
      } else score += w[key] * (item[key] ? this.unspecified : 1);
    }
    if (line.coating) {
      if (line.coating !== item.coating) return 0;
      score += w.coating;
    } else if (!item.coating) score += w.coating;
    else score += w.coating * (item.coating === this.defaultCoating ? this.unspecified : this.unspecified * 0.7);
    score += w.words * wordsScore(line.words, item.words);
    return score;
  }
}

// Размер: совпал — 1; клиент назвал начало размера («М10» у «М10×50») — 0,6;
// не назвал — 0,3; противоречит — 0.
function dimsScore(line, item) {
  if (!line.length) return item.length ? 0.3 : 1;
  if (line.length === item.length && line.every((d, i) => d === item[i])) return 1;
  if (line.length < item.length && line.every((d, i) => d === item[i])) return 0.6;
  return 0;
}

// Слова: сколько слов клиента нашлось у позиции, и насколько наборы похожи.
// Сокращение совпадает с полным словом («алюм.» — «алюминий»).
// Клиент не написал ничего сверх типа и размера — половина: позиция может быть любой из вариантов.
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

function wordsScore(line, item) {
  if (!line.length) return item.length ? 0.5 : 1;
  const common = line.filter((w) => item.some((v) => sameWord(w, v))).length;
  const coverage = common / line.length;
  const dice = (2 * common) / (line.length + item.length);
  return 0.7 * coverage + 0.3 * dice;
}

const round = (x) => Math.round(x * 1000) / 1000;

// Повторитель (П16): строки → строки с позицией и уверенностью.
class Matches {
  constructor(match) {
    this.match = match;
  }

  of(lines, synonyms) {
    return lines.map((line) => (line.origin === 'raw'
      ? { ...line, sku: null, confidence: 0, state: 'missing', candidates: [], via: 'none' }
      : { ...line, ...this.capped(line, this.match.of(line, synonyms)) }));
  }

  // Цифры модели не нашлись в тексте — строку проверяет человек, даже если позиция нашлась.
  capped(line, m) {
    if (!line.verify || m.confidence < this.match.autoAccept) return m;
    const confidence = Math.min(m.confidence, round(this.match.autoAccept - 0.05));
    return { ...m, confidence, state: this.match.stateOf(confidence) };
  }
}

module.exports = { Match, Matches };
