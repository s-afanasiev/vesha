// Остаток и кратность (docs/backbone-architecture.md §6.5 п. 4): нехватка или
// некратное упаковке количество — вопрос клиенту, а не молчаливая правка.
// 37 шт. при упаковке по 50 остаются в черновике 37 шт. с вопросом «50 (1 уп.)?».
//
// Единица клиента приводится к единице позиции только явно: «2 уп» при упаковке
// по 200 — 400 шт.; «5 кг» на штучную позицию — вопрос, а не догадка.

const fmt = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');

class StockCheck {
  constructor(catalog, { pack = 'ask' } = {}) {
    this.catalog = catalog;
    this.pack = pack; // ask — некратное упаковке спросить; any — магазин продаёт поштучно
  }

  // строка с позицией → { invoiceQty, price, sum, question }
  of(line) {
    const item = line.sku ? this.catalog.index.bySku(line.sku) : null;
    if (!item) return { invoiceQty: null, price: null, sum: null, question: null };
    const price = item.price;
    if (line.qty == null) return { invoiceQty: null, price, sum: null, question: 'количество не указано' };

    let qty = line.qty;
    const questions = [];
    if (line.unit && line.unit !== item.unit) {
      if (line.unit === 'уп' && item.pack >= 1) qty = line.qty * item.pack;
      else {
        questions.push(`в заявке ${fmt(line.qty)} ${line.unit}, позиция продаётся в ${item.unit} — уточнить количество`);
        return { invoiceQty: null, price, sum: null, question: questions.join('; ') };
      }
    }
    if (this.pack === 'ask' && item.pack > 1 && qty % item.pack !== 0) {
      const up = Math.ceil(qty / item.pack) * item.pack;
      questions.push(`${fmt(qty)} ${item.unit} — упаковка по ${item.pack}: отгрузить ${fmt(up)} ${item.unit} (${up / item.pack} уп.)?`);
    }
    if (item.stock < qty) {
      questions.push(item.stock > 0
        ? `в наличии ${fmt(item.stock)} ${item.unit} из ${fmt(qty)} — отгрузить наличие или ждать поставку?`
        : 'нет в наличии — ждать поставку или замена?');
    }
    return {
      invoiceQty: qty,
      price,
      sum: Math.round(qty * price * 100) / 100,
      question: questions.length ? questions.join('; ') : null,
    };
  }
}

module.exports = { StockCheck };
