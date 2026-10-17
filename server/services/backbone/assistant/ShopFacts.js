// Факты магазина для ассистента (docs/backbone-architecture.md §4, §6.4): ответы —
// только из них (О18). Каталог — тот же, что у витрины и разбора заявки (Catalogs.of:
// каталог по версии выгрузки магазина); заявки — только собеседника (дверь
// BackboneDesk.clientOrders, О20); часы — из описания магазина. Факты не решают, что
// ответить: это делают автоответы (AutoAnswers).

const { hoursText } = require('../shops/ShopForm');

// Размер в вопросе написан как размер: «М10», «4,2х19», «1/2″» — а не «10 км».
const SIZE = /(^|[^a-zа-я\d])[мm]\d|\d\s*[xх×*]\s*\d|\d\s*\/\s*\d|\d\s*(?:″|"|дюйм)/i;
const METRIC = /(^|[^a-zа-я\d])[мm]\d/i; // метрическая резьба: «М10»

class ShopFacts {
  constructor({ shop, catalog, match, orders, hours, clock = () => new Date() }) {
    this.shop = shop;
    this.catalog = catalog; // каталог магазина: позиции и индекс атрибутов
    this.match = match;     // правило «позиция не противоречит строке» — то же, что у разбора
    this.ordersOf = orders; // () → заявки собеседника: [{ number, step, note, at, token }]
    this.hoursRule = hours; // WorkingHours магазина
    this.clock = clock;
  }

  // Позиции каталога, о которых спрашивают: тип изделия или размер названы — иначе null.
  // Отбор — правилом Match: размер, стандарт, класс и покрытие, если названы, не
  // противоречат позиции; лучшие совпадения первыми.
  positions(phrase, { limit = 5 } = {}) {
    const attrs = this.catalog.index.parse(phrase);
    if (!attrs.kind && !(attrs.dims.length && SIZE.test(phrase))) return null;
    const metric = METRIC.test(phrase); // «М10×50» — резьба: дюбель 10×50 подходит, но идёт после болтов
    const scored = [];
    for (const entry of this.catalog.index.pool(attrs.kind)) {
      const score = this.match.score(attrs, entry.attrs);
      if (score > 0) scored.push({ item: entry.item, score, thread: METRIC.test(entry.item.name) === metric });
    }
    scored.sort((a, b) => (b.thread - a.thread) || (b.score - a.score));
    return {
      total: scored.length,
      items: scored.slice(0, limit).map(({ item }) => ({
        sku: item.sku, name: item.name, unit: item.unit, pack: item.pack, price: item.price,
        inStock: item.stock == null ? null : item.stock > 0, // остаток наружу — только «есть / нет», как на витрине
      })),
    };
  }

  async orders() {
    return this.ordersOf();
  }

  // Заявка собеседника по номеру; чужая и несуществующая неразличимы — null.
  async order(number) {
    return (await this.ordersOf()).find((o) => o.number === number) || null;
  }

  // Часы работы: строка «пн–сб 09:00–19:00», открыто ли сейчас, когда откроемся.
  hours() {
    const now = this.clock().getTime();
    const opensAt = this.hoursRule.deadline(now, 0); // ближайший рабочий момент; сейчас — если открыто
    return { text: hoursText(this.shop.hours), tz: this.shop.tz, open: opensAt === now, opensAt };
  }
}

module.exports = { ShopFacts };
