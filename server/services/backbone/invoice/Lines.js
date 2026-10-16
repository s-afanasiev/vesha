// Строки заявки (docs/backbone-architecture.md §6.5 п. 2): сначала правила
// («наименование — количество единица»), потом модель — для того, что правила
// не разобрали. Каждая цифра ответа модели должна найтись в исходной строке,
// иначе строка помечается «проверить» (О18: модель не придумывает фактов).
//
// Строка: { ref, source, name, qty, unit, origin: rule | model | raw, verify }.
// raw — строка с цифрами, которую не разобрал никто: она видна менеджеру, а не теряется.

const { normalize } = require('../catalog/CatalogIndex');

const UNITS = [
  [/^(шт|штук[аи]?|штуки)$/, 'шт'],
  [/^(уп|упак|упаковк[аи]|упаковок|пач|пачк[аи]|пачек)$/, 'уп'],
  [/^(кг|килограмм(а|ов)?)$/, 'кг'],
  [/^(м|метр(а|ов)?|п\.?\s?м|пог\.?\s?м)$/, 'м'],
  [/^(компл|комплект(а|ов)?)$/, 'компл'],
  [/^(пар[аы]?)$/, 'пара'],
  [/^(рул|рулон(а|ов)?)$/, 'рулон'],
];
const UNIT_RE = '(шт|штук[аи]?|штуки|уп|упак|упаковк[аи]|упаковок|пач|пачк[аи]|пачек|кг|килограмм(?:а|ов)?|м|метр(?:а|ов)?|п\\.?\\s?м|пог\\.?\\s?м|компл|комплект(?:а|ов)?|пар[аы]?|рул|рулон(?:а|ов)?)';
const NUM_RE = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+(?:[.,]\\d+)?)';
const SEP = '(?:\\s*[:;|]\\s*|\\s+[—–-]\\s*|\\s+[xх×*]\\s*|\\s+)';   // с единицей хватит пробела
const SEP_STRICT = '(?:\\s*[:;|]\\s*|\\s+[—–-]\\s*)';                 // без единицы — только явный разделитель
const NAME = '(.*?[^\\s—–:;|,-])';

const TAIL_WITH_UNIT = new RegExp(`^${NAME}${SEP}${NUM_RE}\\s*${UNIT_RE}\\.?$`, 'i');
const TAIL_NO_UNIT = new RegExp(`^${NAME}${SEP_STRICT}${NUM_RE}$`, 'i');
const HEAD_WITH_UNIT = new RegExp(`^${NUM_RE}\\s*${UNIT_RE}(?![a-zа-яё])\\.?${SEP_STRICT}?\\s*(.+)$`, 'i');
// «Болт М10х50 — 100 шт., гайка М10 — 100 шт.» — две строки в одной
const AFTER_UNIT_COMMA = new RegExp(`(?<=\\d\\s*(?:${UNIT_RE.slice(1, -1)})\\.?)\\s*,\\s+(?=[a-zа-яё])`, 'i'); // без захвата: split не вставит единицу
const BULLET = /^\s*(?:[-•*·–—]+\s+|№?\s*\d{1,3}\s*[.)]\s+|\d{1,3}\t)/;
// не товар: приветствие и подпись — если в строке нет цифр; реквизиты и контакты — всегда
const CHATTER = /^(здравствуй|добрый|привет|спасибо|с уважением|уважаем|прошу|просим|нужен сч|нужно сч|выставьте|выставить|сч[её]т на|доставк|оплат)/i;
const REQUISITES = /^(реквизит|инн|кпп|огрн|бик|р\/?с|к\/?с|тел|моб|e-?mail|почта|адрес|сайт)|\+?\d[\d\s()-]{9,}\d/i;

function unitOf(raw) {
  if (raw == null || raw === '') return null;
  const u = String(raw).toLowerCase().replace(/\.$/, '').trim();
  const hit = UNITS.find(([re]) => re.test(u));
  return hit ? hit[1] : u.slice(0, 12);
}

const qtyOf = (raw) => Number(String(raw).replace(/[  ]/g, '').replace(',', '.'));
const cleanName = (s) => String(s).replace(/[\s—–:;|,-]+$/, '').replace(/^[\s—–:;|,-]+/, '').trim();
const hasDigits = (s) => /\d/.test(s);
const lettersIn = (s) => (String(s).match(/[a-zа-яё]/gi) || []).length;

// Строка листа xlsx: ячейки через табуляцию — наименование, количество, единица в любом порядке.
function cellsLine(text) {
  const cells = text.split('\t').map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  const nameAt = cells.reduce((best, c, i) => (lettersIn(c) > lettersIn(cells[best]) ? i : best), 0);
  const qtyAt = cells.findIndex((c, i) => i > nameAt && /^\d+(?:[.,]\d+)?$/.test(c.replace(/[  ]/g, '')));
  if (qtyAt < 0) return null;
  const unitCell = cells.find((c, i) => i > nameAt && i !== qtyAt && UNITS.some(([re]) => re.test(c.toLowerCase().replace(/\.$/, ''))));
  return { name: cleanName(cells[nameAt]), qty: qtyOf(cells[qtyAt]), unit: unitOf(unitCell) };
}

class RuleLines {
  // строки текста → { lines, rest, skipped }
  of(textLines) {
    const lines = [];
    const rest = [];
    const skipped = [];
    textLines.forEach((whole, ref) => {
      const pieces = whole.includes('\t') ? [whole] : whole.split(AFTER_UNIT_COMMA);
      for (const piece of pieces) {
        const source = pieces.length > 1 ? piece.trim() : whole;
        const text = source.replace(BULLET, '').trim();
        if (!text || lettersIn(text) === 0 || REQUISITES.test(text) || (!hasDigits(text) && (CHATTER.test(text) || /[:?!]$/.test(text)))) {
          skipped.push({ ref, source });
          continue;
        }
        const parsed = this.parse(text);
        if (parsed && lettersIn(parsed.name) >= 3 && parsed.qty > 0) lines.push({ ref, source, ...parsed, origin: 'rule', verify: null });
        else rest.push({ ref, source });
      }
    });
    return { lines, rest, skipped };
  }

  parse(text) {
    if (text.includes('\t')) return cellsLine(text);
    let m = text.match(TAIL_WITH_UNIT);
    if (m) return { name: cleanName(m[1]), qty: qtyOf(m[2]), unit: unitOf(m[3]) };
    m = text.match(TAIL_NO_UNIT);
    if (m) return { name: cleanName(m[1]), qty: qtyOf(m[2]), unit: null };
    m = text.match(HEAD_WITH_UNIT);
    if (m) return { name: cleanName(m[3]), qty: qtyOf(m[1]), unit: unitOf(m[2]) };
    return null;
  }
}

// Числа строки в нормальной форме: «4,2х19» → 4.2, 19; «2 000» → и 2000, и 2, 0.
function numbersOf(text) {
  const norm = normalize(text);
  const joined = norm.replace(/(\d{1,3})((?:[  ]\d{3})+)(?!\d)/g, (_, a, b) => a + b.replace(/[  ]/g, ''));
  const out = new Set();
  for (const s of [norm, joined]) for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

// Сверка (О18): цифры наименования и количества из ответа модели — в исходной строке.
function digitsInSource(line, source) {
  const known = numbersOf(source);
  const claimed = [...numbersOf(line.name)];
  if (line.qty != null) claimed.push(String(Number(line.qty)));
  const strange = [...new Set(claimed.filter((n) => !known.has(n)))];
  return strange.length ? `цифры не из текста: ${strange.join(', ')}` : null;
}

const SYSTEM = [
  'Ты разбираешь заявку покупателя магазина крепежа и сантехники на товарные строки.',
  'Тебе дают пронумерованные строки текста. Верни только JSON без пояснений:',
  '{"lines":[{"ref":<номер строки>,"name":"<наименование с размерами, как в тексте>","qty":<число или null>,"unit":"<шт|уп|кг|м|компл или null>"}]}',
  'Правила: не придумывай товаров и чисел — бери только то, что написано; число словами переведи в цифры;',
  'если в одной строке несколько товаров — верни несколько записей с одним ref; строки без товара пропусти.',
].join('\n');

class ModelLines {
  constructor({ verify = digitsInSource, maxLines = 60 } = {}) {
    this.verify = verify;
    this.maxLines = maxLines;
  }

  // rest: [{ ref, source }] → { lines, raw, skipped, failures, calls }
  async of(rest, { llm, signal } = {}) {
    if (!rest.length) return { lines: [], raw: [], skipped: [], failures: [], calls: 0 };
    const unparsed = (failure, calls = 0) => ({
      lines: [],
      raw: rest.filter((r) => hasDigits(r.source)),
      skipped: rest.filter((r) => !hasDigits(r.source)),
      failures: [failure],
      calls,
    });
    if (!llm) return unparsed({ code: 'model_off', detail: 'модель не подключена' });
    if (rest.length > this.maxLines) return unparsed({ code: 'model_too_many', detail: `строк для модели больше ${this.maxLines}` });

    const prompt = rest.map((r) => `[${r.ref}] ${r.source.replace(/\t/g, ' | ')}`).join('\n');
    let answer;
    try {
      answer = await llm.complete([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { signal });
    } catch (err) {
      return unparsed({ code: err.code || 'model_failed', detail: String(err.message || err) });
    }
    let items;
    try {
      const raw = String(answer && answer.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      items = JSON.parse(raw).lines;
      if (!Array.isArray(items)) throw new Error('нет массива lines');
    } catch (err) {
      return unparsed({ code: 'model_bad_answer', detail: `ответ модели не разобран: ${err.message}` }, 1);
    }

    const byRef = new Map(rest.map((r) => [r.ref, r]));
    const lines = [];
    const failures = [];
    for (const item of items) {
      const src = byRef.get(Number(item && item.ref));
      const name = cleanName(String((item && item.name) || '')).slice(0, 200);
      if (!src || lettersIn(name) < 3) {
        failures.push({ code: 'model_foreign_line', detail: `строка модели без опоры в тексте: ${JSON.stringify(item).slice(0, 120)}` });
        continue;
      }
      const qty = item.qty == null || item.qty === '' ? null : qtyOf(item.qty);
      const line = { ref: src.ref, source: src.source, name, qty: Number.isFinite(qty) && qty > 0 ? qty : null, unit: unitOf(item.unit), origin: 'model' };
      lines.push({ ...line, verify: this.verify(line, src.source) });
    }
    const answered = new Set(lines.map((l) => l.ref));
    const left = rest.filter((r) => !answered.has(r.ref));
    return {
      lines,
      raw: left.filter((r) => hasDigits(r.source)),
      skipped: left.filter((r) => !hasDigits(r.source)),
      failures,
      calls: 1,
    };
  }
}

// Строки целиком: правила, затем модель для остатка; порядок — как в заявке.
class Lines {
  constructor(rules, model) {
    this.rules = rules;
    this.model = model;
  }

  async of(textLines, ctx = {}) {
    const ruled = this.rules.of(textLines);
    const modeled = await this.model.of(ruled.rest, ctx);
    const raw = modeled.raw.map((r) => ({ ref: r.ref, source: r.source, name: cleanName(r.source.replace(BULLET, '').replace(/\t/g, ' ')), qty: null, unit: null, origin: 'raw', verify: null }));
    const lines = [...ruled.lines, ...modeled.lines, ...raw]
      .sort((a, b) => a.ref - b.ref)
      .map((l, i) => ({ position: i + 1, ...l }));
    return {
      lines,
      skipped: [...ruled.skipped, ...modeled.skipped].length,
      failures: modeled.failures,
      counts: {
        rule: ruled.lines.length,
        model: modeled.lines.length,
        raw: raw.length,
        verify: modeled.lines.filter((l) => l.verify).length,
        modelCalls: modeled.calls,
      },
    };
  }
}

module.exports = { Lines, RuleLines, ModelLines, digitsInSource, unitOf };
