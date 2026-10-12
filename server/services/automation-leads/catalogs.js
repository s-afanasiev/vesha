// Справочники лидов автоматизации — правила-владельцы словаря (П14): какие
// потребности из разметки отзывов считаются сбоем процесса, который закрывает
// софт, и какой из наших продуктов закрывает пробел или сбой.
//
// Коды потребностей — справочник «Радара спроса» v2 (ядро): один язык разметки
// на оба эксперимента (П41), интерпретация — своя. Продукты — три базовых
// инструмента почти для любого слабо автоматизированного бизнеса (решение
// 13.10.2026) плюс модуль ниши: подбор крепежа в каталоге и ассистенте.
// Определитель резьбы по фото (docs/bolt_thread_measure_pwa_plan.md) сюда не
// входит: это отдельное приложение для маркетплейсов, а магазину нужен простой
// подбор по параметрам и совместимости.

// Потребность «не получил» → линия сбоя. Отношение персонала, уровень цен и
// брак товара — не сбой процесса: софт их не чинит, в линии не попадают.
const FAILURE_LINES = {
  'access.booking': 'очередь и выдача',
  'access.slots': 'очередь и выдача',
  'access.walk_in': 'очередь и выдача',
  'time.queue': 'очередь и выдача',
  'time.start': 'очередь и выдача',
  'access.phone': 'связь и статусы',
  'info.status': 'связь и статусы',
  'info.explain': 'консультация и подбор',
  'price.upfront': 'цены',
  'price.promo': 'цены',
  'access.maps': 'карточка на картах',
  'price.goods_match': 'склад и наличие',
  'offer.stock': 'склад и наличие',
  'time.supply': 'склад и наличие',
  'info.documents': 'доставка и сроки',
  'time.deadline': 'доставка и сроки',
};

class FailureCatalog {
  constructor(lines = FAILURE_LINES) {
    this.lines = lines;
  }

  lineOf(need) {
    return this.lines[need] || null;
  }
}

const PRODUCTS = {
  site: {
    title: 'Сайт с каталогом',
    pitch: 'каталог с ценами и наличием, заказ или резерв с самовывозом',
  },
  assistant: {
    title: 'Умный ассистент',
    pitch: 'отвечает в чате сайта и в мессенджере: наличие, цены, часы, подбор, статус заказа',
  },
  funnel: {
    title: 'Канбан-воронка',
    pitch: 'заявки и заказы на доске со статусами, клиент по ссылке видит этап своей заявки: ничего не теряется в тишине',
  },
  fastener_pick: {
    title: 'Подбор крепежа',
    pitch: 'модуль каталога и ассистента: подбор по параметрам и совместимости (дюбель → саморез, болт → гайка и шайба), линейка 1:1 на экране',
    hook: true,
  },
};

// Модуль ниши предлагается всем местам с рубрикой ниши; довод у него — сбои,
// которые он закрывает.
const HOOK_COVERS = {
  fastener_pick: ['консультация и подбор', 'склад и наличие'],
};

// Пробел или сбой → продукты, которые его закрывают.
const COVERS = {
  'нет сайта': ['site'],
  'сайт не открывается': ['site'],
  'на сайте нет цен': ['site'],
  'нельзя заказать онлайн': ['site'],
  'нет мессенджера': ['assistant'],
  'склад и наличие': ['site'],
  'цены': ['site'],
  'карточка на картах': ['site'],
  'консультация и подбор': ['assistant'],
  'связь и статусы': ['assistant', 'funnel'],
  'очередь и выдача': ['funnel'],
  'доставка и сроки': ['funnel'],
};

class OfferCatalog {
  constructor({ products = PRODUCTS, covers = COVERS, hookCovers = HOOK_COVERS } = {}) {
    this.products = products;
    this.covers = covers;
    this.hookCovers = hookCovers;
  }

  // Продукты места с доказательствами: сильное — сбой из отзывов, слабое — только
  // цифровой пробел. Модуль ниши идёт отдельно: сильный, если место страдает тем,
  // что он закрывает, иначе — предложение по рубрике без довода.
  productsFor({ gaps, failures, hooks = [] }) {
    const found = new Map();
    const add = (evidence, strong) => {
      for (const id of this.covers[evidence] || []) {
        if (!found.has(id)) found.set(id, { id, title: this.products[id].title, evidence: [], strong: false, hook: false });
        const entry = found.get(id);
        entry.evidence.push(evidence);
        entry.strong = entry.strong || strong;
      }
    };
    for (const gap of gaps) add(gap.label, false);
    for (const line of failures) add(line, true);
    const products = [...found.values()];
    for (const id of hooks) {
      if (!this.products[id]) continue;
      const evidence = failures.filter((line) => (this.hookCovers[id] || []).includes(line));
      products.push({ id, title: this.products[id].title, evidence, strong: evidence.length > 0, hook: true });
    }
    return products;
  }
}

module.exports = { FailureCatalog, OfferCatalog, FAILURE_LINES, PRODUCTS, COVERS, HOOK_COVERS };
