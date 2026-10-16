// Черновик счёта (docs/backbone-architecture.md §4, §6.5 п. 5) — выход конвейера
// форм данных, названного по выходу (О1): текст заявки → строки → позиции с
// уверенностью → остаток и упаковка → позиции, суммы, вопросы, «нет в каталоге».
// Каждая ступень — своя форма данных; черновик только складывает их.

const { Refusal } = require('./RequestText');

class InvoiceDraft {
  constructor(stock, matches, lines, text) {
    this.stock = stock;     // StockCheck
    this.matches = matches; // Matches
    this.lines = lines;     // Lines: RuleLines + ModelLines
    this.text = text;       // RequestText
  }

  // input: { text } | { file }; ctx: { llm, synonyms, maxLines, signal }
  async of(input, ctx = {}) {
    const request = await this.text.read(input);
    if (ctx.maxLines && request.lines.length > ctx.maxLines) {
      throw new Refusal('too_many_lines', `В заявке ${request.lines.length} строк — больше ${ctx.maxLines}: разделите на части`);
    }
    const parsed = await this.lines.of(request.lines, ctx);
    if (!parsed.lines.length) throw new Refusal('no_lines', 'В тексте не нашлось ни одной товарной строки');
    const lines = this.matches.of(parsed.lines, ctx.synonyms).map((line) => ({ ...line, ...this.stock.of(line) }));

    const count = (state) => lines.filter((l) => l.state === state).length;
    return {
      kind: request.kind,
      lines,
      totals: {
        lines: lines.length,
        accepted: count('accepted'),
        ask: count('ask'),
        missing: count('missing'),
        questions: lines.filter((l) => l.question).length,
        sum: Math.round(lines.reduce((s, l) => s + (l.sum || 0), 0) * 100) / 100,
      },
      questions: lines.filter((l) => l.question).map((l) => ({ position: l.position, text: l.question })),
      missing: lines.filter((l) => l.state === 'missing').map((l) => ({ position: l.position, source: l.source })),
      counts: { ...parsed.counts, skipped: parsed.skipped },
      failures: parsed.failures,
    };
  }
}

module.exports = { InvoiceDraft };
