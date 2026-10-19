// Неоднозначная позиция (docs/backbone-architecture.md §6.5 п. 3, решение пользователя
// 19.10.2026): «шуруп 2.5» подходит к десятку артикулов. Менеджеру — до shown лучших
// с тем, чем они отличаются друг от друга, остальное — «ещё N вариантов» (не больше max);
// клиенту — вопрос из этого отличия: «какое покрытие — оцинк. или нерж. A2?». Без модели:
// перебор — Match, отличие — слова наименований и атрибуты индекса каталога.

const ROUND = (x) => Math.round(x * 1000) / 1000;

// Что именно различается у кандидатов — о том и вопрос; несколько признаков — «какой вариант».
const ASK = { coating: 'какое покрытие', grade: 'какой класс прочности', standard: 'какой стандарт', dims: 'какой размер' };
// У варианта нет признака, который есть у других («Гвоздь 3×70» рядом с «… оцинк.») — так и говорим.
const NONE = { coating: 'без покрытия', grade: 'без класса прочности', standard: 'без стандарта' };

const tokens = (name) => String(name).split(/\s+/).filter(Boolean);
const key = (t) => t.toLowerCase().replace(/[.,]$/, '');

function joinOr(values) {
  if (values.length < 2) return values.join('');
  return `${values.slice(0, -1).join(', ')} или ${values.at(-1)}`;
}

class Alternatives {
  constructor(match, { shown = 3, max = 50 } = {}) {
    this.match = match; // Match: перебор позиций и индекс каталога
    this.shown = shown;
    this.max = max;
  }

  attrsOf(sku) {
    if (!this.byAttrs) this.byAttrs = new Map(this.match.index.entries.map((e) => [e.item.sku, e.attrs]));
    return this.byAttrs.get(sku) || {};
  }

  // строка черновика { name, sku } → { top: [вариант], more: [вариант], total, question }
  // вариант: { sku, name, score, differs } — differs: слова наименования сверх общих у лучших вариантов
  of(line) {
    const { scored } = this.match.scored(line.name);
    // позиция строки — первой, даже если она пришла синонимом или заменой
    const order = line.sku && !scored.some((c) => c.sku === line.sku) ? [{ sku: line.sku, score: line.confidence || 1 }, ...scored] : scored;
    const list = order.slice(0, this.max)
      .map((c) => ({ sku: c.sku, score: ROUND(c.score), item: this.match.index.bySku(c.sku) }))
      .filter((c) => c.item);
    if (line.sku) list.sort((a, b) => (b.sku === line.sku) - (a.sku === line.sku));
    // общее — у лучших вариантов; отличие любого варианта — его слова сверх общего
    const best = list.slice(0, this.shown);
    const common = list.length > 1
      ? new Set(tokens(best[0].item.name).map(key).filter((k) => best.every((c) => tokens(c.item.name).some((t) => key(t) === k))))
      : new Set();
    const lacking = this.differing(best).find((k) => NONE[k]); // отличие «нет признака» — словами
    const variants = list.map((c) => {
      const own = list.length > 1 ? tokens(c.item.name).filter((t) => !common.has(key(t))).join(' ') : '';
      const none = !own && lacking && this.attrsOf(c.sku)[lacking] == null ? NONE[lacking] : '';
      return { sku: c.sku, name: c.item.name, score: c.score, differs: own || none };
    });
    const top = variants.slice(0, this.shown);
    return { top, more: variants.slice(this.shown), total: order.length, question: this.question(line, top) };
  }

  // признаки индекса (ASK), которые у вариантов разные
  differing(list) {
    const attrs = list.map((c) => this.attrsOf(c.sku));
    return Object.keys(ASK).filter((k) => new Set(attrs.map((a) => JSON.stringify(a[k] ?? null))).size > 1);
  }

  // Вопрос клиенту из отличия лучших вариантов; один вариант — спрашивать не о чем.
  question(line, top) {
    if (top.length < 2) return null;
    const differ = this.differing(top);
    const values = [...new Set(top.map((c) => c.differs || c.name))];
    return `«${line.name}»: ${differ.length === 1 ? ASK[differ[0]] : 'какой вариант'} — ${joinOr(values)}?`;
  }
}

module.exports = { Alternatives };
