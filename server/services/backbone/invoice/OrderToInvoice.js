// Инструмент «разбор заявки в счёт» (docs/backbone-architecture.md §6.5): первый
// жилец слота инструмента. Контракт слота (О26): accepts + run(input, ctx) →
// { draft, questions, facts, failures }; заявку и журнал ведёт дверь костяка.
//
// Правка менеджера — тоже здесь, в revise: только инструмент знает, как строка
// черновика пересчитывается от новой позиции или количества.

class OrderToInvoice {
  constructor(draft, { maxLines = 200 } = {}) {
    this.draft = draft; // InvoiceDraft
    this.maxLines = maxLines;
    this.accepts = ['text', 'xlsx', 'pdf'];
  }

  async run(input, ctx = {}) {
    const draft = await this.draft.of(input, { ...ctx, maxLines: this.maxLines });
    const t = draft.totals;
    return {
      draft,
      questions: draft.questions,
      facts: {
        summary: `${t.lines} строк: ${t.accepted} принято, ${t.ask} выбрать, ${t.missing} нет в каталоге, ${t.questions} вопросов`,
        source: draft.kind,
        ...draft.counts,
        ...t,
      },
      failures: draft.failures,
    };
  }

  // Строка после правки: новая позиция (sku) — количество клиента пересчитывается
  // к ней; новое количество (qty) — менеджер называет его в единице позиции.
  revise(line, change = {}) {
    const sku = change.sku ?? line.sku;
    const item = sku ? this.item(sku) : null;
    const next = { ...line, sku };
    if (change.qty != null) {
      next.qty = change.qty;
      next.unit = item ? item.unit : line.unit;
    }
    return { sku, qty: next.qty, unit: next.unit, ...this.draft.stock.of(next) };
  }

  item(sku) {
    return this.draft.stock.catalog.index.bySku(sku);
  }
}

module.exports = { OrderToInvoice };
