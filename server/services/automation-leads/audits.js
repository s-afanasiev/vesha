// Работы аудита одного места — каждая собирает факты одного вида и сообщает о
// себе через свой узел дерева (ctx-узел приходит аргументом, хранилища работа не
// знает — П7, П37). Решений здесь нет: пробелы, вердикт и продукт выводит
// LeadPlan из фактов (П2, П15). Отрицательный исход назван с причиной (П38).

// Хост соцсети или агрегатора — не сайт места.
const SOCIAL_HOST = /(^|\.)(vk\.com|vk\.ru|instagram\.com|ok\.ru|t\.me|wa\.me|facebook\.com|youtube\.com|avito\.ru|2gis\.ru|yandex\.ru)$/i;
// Подпись вместо адреса («Перейти в Telegram-канал») — это канал связи, а не сайт.
const CHANNEL_LABEL = /telegram|канал|max|чат|whatsapp|viber/i;

function domainOf(value) {
  return String(value).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

// Карточка места: контакты, каналы, гигиена, масштаб.
class CardFacts {
  async run(place, world, node) {
    const card = await world.source.card(place.branch_id);
    if (!card) {
      node.skip('no_card', 'карточки нет в данных');
      return null;
    }
    const websites = card.websites || [];
    const labels = websites.filter((w) => /\s/.test(String(w).trim()));
    const sites = websites
      .filter((w) => !/\s/.test(String(w).trim()))
      .map(domainOf)
      .filter((d) => d && !SOCIAL_HOST.test(d));
    const facts = {
      phone: (card.phones || [])[0] || '',
      sites,
      channel: (card.messengers || []).length > 0 || labels.some((w) => CHANNEL_LABEL.test(w)),
      unconfirmed: !!card.unconfirmed,
      schedule: !!card.schedule,
      promoted: !!card.promoted,
      branches: card.branches || 1,
      rating: card.rating ?? null,
      reviewsCount: card.reviewsCount ?? null,
    };
    node.complete({
      summary: [
        facts.channel ? 'мессенджер есть' : 'мессенджера нет',
        facts.unconfirmed ? 'карточка не подтверждена' : null,
        facts.schedule ? null : 'часов нет',
        facts.promoted ? 'реклама в 2ГИС' : null,
        `${facts.branches} ${facts.branches === 1 ? 'точка' : 'точек'}`,
      ].filter(Boolean).join(' · '),
    });
    return facts;
  }
}

// Главная страница сайта: каталог, цены, заказ, чат. Только текст, без JS.
class SiteFacts {
  async run(card, world, node) {
    if (!card.sites.length) {
      node.skip('no_site', 'сайта нет в карточке');
      return { has: false };
    }
    let domain = card.sites[0];
    let audit = null;
    for (const d of card.sites) {
      audit = await world.source.site(d);
      if (audit) { domain = d; break; }
    }
    if (!audit) {
      node.skip('not_audited', `${domain}: сайт не проверяли`);
      return { has: true, audited: false, domain, url: `https://${domain}` };
    }
    const ok = !audit.error && Number(audit.status) < 400;
    const facts = {
      has: true,
      audited: true,
      ok,
      domain,
      url: audit.url || `https://${domain}`,
      status: audit.status || null,
      catalog: !!audit.catalog,
      prices: !!audit.prices,
      cart: !!audit.cart,
      leadForm: !!audit.leadForm,
      messengers: !!audit.messengers,
      chat: !!audit.chat,
      platform: audit.platform || '',
    };
    const has = [
      facts.catalog && 'каталог',
      facts.prices && 'цены',
      (facts.cart || facts.leadForm) && 'заказ',
      (facts.messengers || facts.chat) && 'чат',
    ].filter(Boolean);
    node.complete({
      summary: ok
        ? `${domain} · ${facts.platform || 'движок не опознан'} · ${has.join(', ') || 'витрина без цен и заказа'}`
        : `${domain} · не открывается (${audit.status || audit.error})`,
    });
    return facts;
  }
}

// Свежие отзывы клиентов: сбои процесса с цитатами и ответы владельца.
class ReviewFailures {
  constructor({ catalog, freshFrom = '2024-01-01' }) {
    this.catalog = catalog;
    this.freshFrom = freshFrom;
  }

  async run(place, world, node) {
    const reviews = (await world.source.reviews(place.branch_id)).filter((r) => r.date >= this.freshFrom);
    if (!reviews.length) {
      node.skip('no_fresh_reviews', `свежих отзывов нет (с ${this.freshFrom})`);
      return { fresh: 0, answered: 0, unmarked: 0, failures: [] };
    }
    const failures = [];
    let unmarked = 0;
    for (const review of reviews) {
      const mark = await world.marking.of(review);
      if (!mark) { unmarked += 1; continue; }
      if (mark.author !== 'client') continue;
      for (const signal of mark.signals) {
        const line = signal.polarity === 'missing' ? this.catalog.lineOf(signal.need) : null;
        if (!line) continue;
        failures.push({
          line,
          need: signal.need,
          quote: String(signal.quote || '').replace(/\s+/g, ' ').trim(),
          verified: !!signal.quoteVerified,
          date: review.date,
        });
      }
    }
    const answered = reviews.filter((r) => r.answered).length;
    const lines = [...new Set(failures.map((f) => f.line))];
    node.complete({
      summary: [
        `${reviews.length} свежих`,
        `ответов владельца ${answered}`,
        lines.length ? `сбои: ${lines.join(', ')}` : 'сбоев нет',
        unmarked ? `не размечено ${unmarked}` : null,
      ].filter(Boolean).join(' · '),
    });
    return { fresh: reviews.length, answered, unmarked, failures };
  }
}

module.exports = { CardFacts, SiteFacts, ReviewFailures, domainOf };
