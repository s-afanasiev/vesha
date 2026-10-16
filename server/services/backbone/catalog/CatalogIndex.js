// Индекс каталога (docs/backbone-architecture.md §4, §6.5 п. 3): атрибуты из
// наименований — тип изделия, размеры, стандарт, класс, покрытие, остальные
// слова — один раз при загрузке каталога. Тем же разбором проходит строка заявки,
// поэтому «М10х50», «M10x50» и «м10 × 50» становятся одним «м10×50».
//
// Индекс решений не принимает: он отдаёт атрибуты и позиции по типу; кого
// выбрать и насколько уверенно — Match.

// Одна нормальная форма текста для индекса, синонимов и сверки цифр:
// кириллическая «х», латинская «x» и «*» между цифрами → «×», десятичная запятая → точка,
// латинская M перед цифрой → кириллическая, ½ → 1/2, дюймовые знаки → ″.
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4')
    .replace(/(\d)\s*(?:["“”″]|''|дюйм(?:а|ов)?)/g, '$1″')
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1×')
    .replace(/(^|[^a-zа-я])m(?=\d)/g, '$1м')
    .replace(/(\d)\s*[–—]\s*(?=\d)/g, '$1-')
    .replace(/(?<![a-zа-я])([a-zа-я]{1,2})\s*\/\s*([a-zа-я]{1,2})(?![a-zа-я])/g, '$1-$2') // вр/нр → вр-нр
    .replace(/\s+/g, ' ')
    .trim();
}

// Короткая основа слова: падежи и числа русских слов сходятся по первым буквам.
const stem = (word) => (word.length > 5 ? word.slice(0, 5) : word);

class CatalogIndex {
  constructor({ attributes }) {
    this.attributes = attributes;
    this.stop = new Set(attributes.stopWords || []);
    this.entries = null;
    this.byKindMap = null;
  }

  // Атрибуты наименования: { kind, dims, standard, grade, coating, words }.
  parse(name) {
    const a = this.attributes;
    let text = normalize(name);
    const take = (re) => {
      const m = text.match(re);
      if (m) text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
      return m;
    };

    const std = take(a.standard);
    const standard = std ? `${std[1]}${std[2]}` : null;

    let grade = null;
    const g = take(a.grade);
    if (g) grade = g[1];
    else {
      const bare = text.match(/(?<![\d.×-])(\d{1,2}\.\d)(?![\d×])/);
      if (bare && a.bareGrades.includes(bare[1])) { grade = bare[1]; take(/(?<![\d.×-])\d{1,2}\.\d(?![\d×])/); }
    }

    let coating = null;
    for (const [re, code] of a.coatings) {
      const m = take(re);
      if (m) { coating = code === 'ral' ? `ral${m[1]}` : code; break; }
    }
    // второе упоминание покрытия («оцинк.» после «жёлтый цинк») — не размер и не слово
    for (const [re] of a.coatings) take(re);

    const dims = [];
    text = text.replace(/(\d+)°/g, ' deg$1 ');                                  // угол 90° — слово, не размер
    text = text.replace(/(?<![a-zа-я])(pn)\s?(\d+)/g, ' $1$2 ');                  // PN20 — слово
    for (const m of text.matchAll(/(?<![a-zа-я\d])м?(\d+(?:\.\d+)?(?:[×/-]\d+(?:\.\d+)?)*)(″)?/g)) {
      const token = m[1];
      if (token.includes('/')) dims.push(token);              // дюймы: 1/2, 3/4
      else dims.push(...token.split(/[×-]/).map((n) => String(Number(n))));
    }
    text = text.replace(/(?<![a-zа-я\d])м?\d+(?:\.\d+)?(?:[×/-]\d+(?:\.\d+)?)*″?/g, ' ');

    let kind = null;
    const words = [];
    for (const raw of text.split(/[^a-zа-я0-9_-]+/)) {
      if (!raw) continue;
      // «дюбель-гвоздь» — два слова; «вр-вр», «г-ш» — одно, части по алфавиту
      const parts = raw.split('-').filter(Boolean);
      const tokens = parts.length > 1 && parts.every((p) => p.length >= 3) ? parts : [parts.length > 1 ? [...parts].sort().join('-') : raw];
      for (const w of tokens) {
        if (!kind) {
          const hit = a.kinds.find(([re]) => re.test(w));
          if (hit) { kind = hit[1]; continue; }
        }
        if (this.stop.has(w) || !/[a-zа-я]/.test(w)) continue;
        words.push(stem(w));
      }
    }
    return { kind, dims, standard, grade, coating, words: [...new Set(words)] };
  }

  // Индекс строится один раз, при первом обращении (П5): каталог читается однажды.
  build(items) {
    this.entries = items.map((item) => ({ item, attrs: this.parse(item.name) }));
    this.skuMap = new Map(items.map((item) => [item.sku, item]));
    this.byKindMap = new Map();
    for (const e of this.entries) {
      const list = this.byKindMap.get(e.attrs.kind) || [];
      list.push(e);
      this.byKindMap.set(e.attrs.kind, list);
    }
    return this;
  }

  bySku(sku) {
    return this.skuMap.get(sku) || null;
  }

  // Позиции, среди которых искать: того же типа или все, если тип не распознан.
  pool(kind) {
    if (!kind) return this.entries;
    return this.byKindMap.get(kind) || [];
  }
}

module.exports = { CatalogIndex, normalize };
