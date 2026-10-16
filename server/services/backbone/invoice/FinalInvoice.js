// Итоговый счёт из 1С для тени (docs/backbone-architecture.md §6.6, О25): менеджер
// копирует табличную часть счёта из 1С и вставляет — строки приходят через табуляцию
// («№ — Артикул — Номенклатура — Количество — Ед. — Цена — Сумма»). Позиция — по
// артикулу, если он есть в каталоге, иначе по наименованию тем же Match, но только
// уверенно принятая; остальное — «не узнано», а не догадка.
//
// Сверка: строка счёта совпала, если в черновике есть строка с той же позицией и
// тем же количеством. Точность — совпавшие / (строки черновика ∪ строки счёта):
// каждая лишняя или пропущенная строка — правка, которую менеджеру пришлось бы сделать.

const { splitText } = require('./RequestText');
const { BULLET } = require('./Lines');

const TOTAL = /^\s*(итого|всего|в том числе|ндс|сумма прописью)/i;

class FinalInvoice {
  constructor(index, match, rules) {
    this.index = index; // CatalogIndex
    this.match = match; // Match
    this.rules = rules; // RuleLines
  }

  // текст из 1С → { lines: [{ sku, qty, source }], unknown: [строки] }
  of(text) {
    const bySkuLower = new Map(this.index.entries.map((e) => [e.item.sku.toLowerCase(), e.item.sku]));
    const lines = [];
    const unknown = [];
    for (const source of splitText(text)) {
      if (TOTAL.test(source)) continue;
      const parsed = this.rules.parse(source.includes('\t') ? source.trim() : source.replace(BULLET, '').trim());
      if (!parsed || !(parsed.qty > 0) || !/[a-zа-яё]{3}/i.test(parsed.name)) continue; // шапка, итог, пустое
      const cell = source.split('\t').map((c) => c.trim().toLowerCase()).find((c) => bySkuLower.has(c));
      let sku = cell ? bySkuLower.get(cell) : null;
      if (!sku) {
        const m = this.match.of({ name: parsed.name });
        sku = m.state === 'accepted' ? m.sku : null;
      }
      if (sku) lines.push({ sku, qty: parsed.qty, source });
      else unknown.push(source);
    }
    return { lines, unknown };
  }
}

// черновик (строки backbone_order_lines) × строки счёта → сверка
function compareDraft(draftLines, finalLines) {
  const pool = draftLines.filter((l) => l.sku && l.invoice_qty != null).map((l) => ({ sku: l.sku, qty: Number(l.invoice_qty) }));
  let matched = 0;
  for (const f of finalLines) {
    const i = pool.findIndex((d) => d.sku === f.sku && Math.abs(d.qty - f.qty) < 1e-6);
    if (i >= 0) {
      matched += 1;
      pool.splice(i, 1);
    }
  }
  const base = draftLines.length + finalLines.length - matched;
  return { draft: draftLines.length, final: finalLines.length, matched, right: matched, base, accuracy: base ? matched / base : null };
}

module.exports = { FinalInvoice, compareDraft };
