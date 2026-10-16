// Синонимы магазина (docs/backbone-architecture.md §4, §6.5 п. 6): фраза клиента →
// позиция. Растут из правок менеджера: замена позиции или подтверждение кандидата.
// Хранит их репозиторий (backbone_synonyms); здесь — ключ фразы и поиск.
//
// Ключ — нормальная форма наименования без знаков препинания: «Шуруп по дереву
// 3,5х35 желт.» и «шуруп по дереву 3.5x35 желт» — одна фраза.
// Рост-точка: синоним-шаблон без размеров («шуруп по дереву {размер}» → тип и
// слова позиции), когда фразовых наберётся достаточно, чтобы его проверить.

const { normalize } = require('./CatalogIndex');

class Synonyms {
  static phrase(name) {
    return normalize(name)
      .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
      .replace(/[^a-zа-я0-9×./″ -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  constructor(rows = []) {
    this.map = new Map(rows.map((r) => [r.phrase, r.sku]));
  }

  lookup(name) {
    return this.map.get(Synonyms.phrase(name)) || null;
  }

  get size() {
    return this.map.size;
  }
}

module.exports = { Synonyms };
