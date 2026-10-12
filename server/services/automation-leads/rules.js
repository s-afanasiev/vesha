// Правила лидов автоматизации — объекты-политики с вердиктом и причиной (П14).
// Ни одно не ходит в сеть и не пишет: факты им приносят работы аудита (П2).

// Рубрика карт ≠ ниша: место входит в нишу, если у него есть хоть одна рубрика ниши.
class RubricFit {
  constructor(rubrics) {
    this.rubrics = new Set(rubrics);
  }

  check(place) {
    const hit = (place.rubrics || []).find((r) => this.rubrics.has(r));
    if (hit) return { fit: true, rubric: hit };
    return { fit: false, reason: `рубрики вне ниши: ${(place.rubrics || []).slice(0, 3).join(', ') || 'нет рубрик'}` };
  }
}

// Цифровые пробелы из фактов карточки и сайта. Вес — вклад в балл: «нет сайта»
// тяжелее прочих, гигиена карточки (не подтверждена, нет часов) видна, но балла
// не даёт — её чинят не наши продукты. Не проверенный сайт пробелов не даёт:
// «не знаем» ≠ «нет» (П38).
class DigitalGaps {
  of(card, site) {
    const gaps = [];
    const add = (code, label, weight) => gaps.push({ code, label, weight });
    if (!site.has) add('no_site', 'нет сайта', 2);
    else if (site.audited && !site.ok) add('site_down', 'сайт не открывается', 1);
    else if (site.audited) {
      if (!site.prices) add('no_prices', 'на сайте нет цен', 1);
      if (!site.cart && !site.leadForm) add('no_order', 'нельзя заказать онлайн', 1);
    }
    const siteChannel = site.ok && (site.messengers || site.chat);
    if (!card.channel && !siteChannel) add('no_messenger', 'нет мессенджера', 1);
    if (card.unconfirmed) add('unconfirmed', 'карточка не подтверждена', 0);
    if (!card.schedule) add('no_hours', 'нет часов в карточке', 0);
    return gaps;
  }
}

// Кто лид. Сеть отсекается первой: у неё своя IT-служба. Сеть видна по числу
// точек в городе или по описанию 2ГИС («сеть магазинов…»): у федеральной сети в
// одном городе бывает одна точка. Дальше нужен хоть один довод — сбой из отзывов
// (сильный лид) или пробел, который закрывает наш продукт (слабый). Числа
// поведения — в декларации (П6).
class LeadRule {
  constructor({ maxBranches = 3, chainName = /(^|[\s,])сеть\s/i } = {}) {
    this.maxBranches = maxBranches;
    this.chainName = chainName;
  }

  check({ place = {}, card, gaps, failures }) {
    if (card.branches > this.maxBranches) {
      return { lead: false, strength: null, reason: `сеть: ${card.branches} точек — своя IT-служба` };
    }
    if (this.chainName.test(place.name || '')) {
      return { lead: false, strength: null, reason: 'сеть по описанию 2ГИС — своя IT-служба' };
    }
    const priced = gaps.filter((g) => g.weight > 0).map((g) => g.label);
    if (failures.length) {
      return { lead: true, strength: 'strong', reason: `сбой в отзывах: ${failures.join(', ')}` };
    }
    if (priced.length) {
      return { lead: true, strength: 'weak', reason: `только пробелы: ${priced.join(', ')}` };
    }
    return { lead: false, strength: null, reason: 'доводов нет: сайт и связь в порядке, сбоев в свежих отзывах нет' };
  }
}

module.exports = { RubricFit, DigitalGaps, LeadRule };
