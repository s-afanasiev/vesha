const test = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTreeStore } = require('../server/process-tree');
const { DigitalGaps, LeadRule, RubricFit } = require('../server/services/automation-leads/rules');
const { FailureCatalog, OfferCatalog } = require('../server/services/automation-leads/catalogs');
const { CardFacts, SiteFacts, ReviewFailures } = require('../server/services/automation-leads/audits');
const { Places, PlaceAudit, EachPlace } = require('../server/services/automation-leads/places');
const { LeadPlan } = require('../server/services/automation-leads/LeadPlan');
const { NicheScan, Scans } = require('../server/services/automation-leads/NicheScan');

const CARD = { channel: false, unconfirmed: true, schedule: true, promoted: false, branches: 1 };

test('digital gaps: no site weighs two, an unaudited site says nothing, a site chat counts as a channel', () => {
  const gaps = new DigitalGaps();
  assert.deepEqual(gaps.of(CARD, { has: false }).map((g) => [g.label, g.weight]), [
    ['нет сайта', 2], ['нет мессенджера', 1], ['карточка не подтверждена', 0],
  ]);
  assert.deepEqual(gaps.of({ ...CARD, unconfirmed: false }, { has: true, audited: false }).map((g) => g.label), ['нет мессенджера']);
  assert.deepEqual(
    gaps.of({ ...CARD, unconfirmed: false }, { has: true, audited: true, ok: true, prices: false, cart: false, leadForm: true, chat: true }).map((g) => g.label),
    ['на сайте нет цен'],
  );
  assert.deepEqual(gaps.of({ ...CARD, unconfirmed: false }, { has: true, audited: true, ok: false }).map((g) => g.label), ['сайт не открывается', 'нет мессенджера']);
});

test('lead rule: chains first, then a review failure is strong and a priced gap is weak', () => {
  const rule = new LeadRule({ maxBranches: 3 });
  const noSite = [{ label: 'нет сайта', weight: 2 }];
  assert.match(rule.check({ card: { branches: 4 }, gaps: noSite, failures: ['цены'] }).reason, /4 точек/);
  assert.equal(rule.check({ place: { name: 'Aquanet, сеть магазинов сантехники' }, card: { branches: 1 }, gaps: noSite, failures: [] }).lead, false);
  assert.equal(rule.check({ place: { name: 'Алькера, гипермаркет плитки' }, card: { branches: 1 }, gaps: noSite, failures: [] }).strength, 'weak');
  assert.equal(rule.check({ card: { branches: 1 }, gaps: [], failures: ['цены'] }).strength, 'strong');
  const none = rule.check({ card: { branches: 1 }, gaps: [{ label: 'карточка не подтверждена', weight: 0 }], failures: [] });
  assert.equal(none.lead, false);
  assert.match(none.reason, /доводов нет/);
});

test('offer catalog maps evidence to products; the niche module is strong only on its own failures', () => {
  const offers = new OfferCatalog();
  const products = offers.productsFor({
    gaps: [{ label: 'нет мессенджера', weight: 1 }],
    failures: ['консультация и подбор'],
    hooks: ['fastener_pick'],
  });
  assert.deepEqual(products.map((p) => [p.id, p.strong, p.hook]), [['assistant', true, false], ['fastener_pick', true, true]]);
  const byRubric = offers.productsFor({ gaps: [], failures: ['цены'], hooks: ['fastener_pick'] });
  assert.deepEqual(byRubric.map((p) => [p.id, p.strong]), [['site', true], ['fastener_pick', false]]);
  assert.equal(new RubricFit(['Крепёж']).check({ rubrics: ['Мебельная фурнитура'] }).fit, false);
});

// Подставной мир прогона: тот же контракт, что у NicheFiles и RecordedMarking.
function fakeWorld({ slow = false } = {}) {
  const places = [
    { branch_id: '1', name: 'Метизы у дома', address: 'ул. Ленина, 1', rubrics: ['Крепёж'] },
    { branch_id: '2', name: 'Сантехника плюс', address: 'ул. Мира, 2', rubrics: ['Сантехника'] },
    { branch_id: '3', name: 'Мебельная фурнитура', address: 'ул. Садовая, 3', rubrics: ['Мебельная фурнитура'] },
    { branch_id: '4', name: 'Без карточки', address: '', rubrics: ['Крепёж'] },
  ];
  const cards = {
    1: { phones: ['+7 000'], websites: [], messengers: [], schedule: {}, branches: 1 },
    2: { phones: ['+7 111'], websites: ['santeh.example'], messengers: ['wa'], schedule: {}, branches: 1, promoted: true },
  };
  const reviews = {
    1: [
      { review_id: 'a', rating: 1, date: '2025-03-01', text: '…', answered: true },
      { review_id: 'b', rating: 2, date: '2025-04-01', text: '…', answered: false },
      { review_id: 'c', rating: 1, date: '2020-01-01', text: '…', answered: false },
      { review_id: 'd', rating: 3, date: '2025-05-01', text: '…', answered: false },
    ],
  };
  const marks = {
    a: { author: 'client', signals: [{ need: 'info.explain', polarity: 'missing', quote: 'не знают ассортимент', quoteVerified: true }] },
    b: { author: 'employee', signals: [{ need: 'time.queue', polarity: 'missing', quote: 'очередь' }] },
    c: { author: 'client', signals: [{ need: 'time.queue', polarity: 'missing', quote: 'старое' }] },
  };
  const later = () => (slow ? new Promise((r) => setImmediate(r)) : Promise.resolve());
  return {
    source: {
      places: async () => places,
      card: async (id) => { await later(); return cards[id] || null; },
      site: async (domain) => (domain === 'santeh.example' ? { url: 'https://santeh.example/', status: 200, catalog: true, prices: false, cart: false, leadForm: false } : null),
      reviews: async (id) => reviews[id] || [],
    },
    marking: { of: async (review) => marks[review.review_id] || null },
  };
}

const NICHE = { slug: 'test', title: 'Тест', city: 'Курск', rubrics: ['Крепёж', 'Сантехника'], hooks: { fastener_pick: ['Крепёж'] } };

function scanOf(world) {
  return new NicheScan({
    worldOf: () => world,
    places: new Places(),
    each: new EachPlace(new PlaceAudit({
      card: new CardFacts(),
      site: new SiteFacts(),
      reviews: new ReviewFailures({ catalog: new FailureCatalog(), freshFrom: '2024-01-01' }),
    })),
    plan: new LeadPlan(),
  });
}

test('niche scan runs end to end: named skips in the tree, leads with evidence in the plan', async () => {
  const tree = new ProcessTreeStore();
  const scans = new Scans({ scan: scanOf(fakeWorld()), tree, niches: { test: NICHE } });
  scans.start('test');
  await scans.settle('test');

  const nodes = tree.nodesOf(tree.roots()[0].nodeId);
  const status = (type, title) => nodes.filter((n) => n.nodeType === type && (!title || n.title === title)).map((n) => [n.status, n.outcome && n.outcome.code]);
  assert.deepEqual(status('NicheScan'), [['completed', undefined]]);
  assert.match(nodes.find((n) => n.nodeType === 'Places').payload.summary, /4 найдено → 3 в нише/);
  assert.deepEqual(status('PlaceAudit', 'Без карточки'), [['skipped', 'no_card']]);
  assert.deepEqual(status('SiteFacts'), [['skipped', 'no_site'], ['completed', undefined]]);
  assert.deepEqual(status('ReviewFailures'), [['completed', undefined], ['skipped', 'no_fresh_reviews']]);
  const reviewsNode = nodes.find((n) => n.nodeType === 'ReviewFailures' && n.status === 'completed');
  // отзыв сотрудника не довод, отзыв 2020 года не свежий, не размеченный — «не знаем», а не «сбоев нет»
  assert.equal(reviewsNode.payload.summary, '3 свежих · ответов владельца 1 · сбои: консультация и подбор · не размечено 1');

  const { plan } = scans.plans.get('test');
  assert.deepEqual(plan.counts, { places: 3, leads: 2, strong: 1, weak: 1, rejected: 0, unaudited: 1 });
  const [first, second] = plan.leads;
  assert.equal(first.name, 'Метизы у дома');
  assert.equal(first.verdict, 'лид: сбой');
  assert.equal(first.quote, '«не знают ассортимент» (2025-03)');
  assert.match(first.hooks, /Подбор крепежа \(довод: консультация и подбор\)/);
  assert.equal(first.score, 2 + 3 + 1); // боль 2 · пробелы: нет сайта 2 + нет мессенджера 1 · ответ владельца 1
  assert.equal(second.verdict, 'лид: пробелы');
  assert.equal(second.gaps, 'на сайте нет цен, нельзя заказать онлайн');
  const site = plan.products.find((p) => p.id === 'site');
  assert.deepEqual([site.places, site.strong, site.weak], [2, 0, 2]);
});

test('scans: one run per niche at a time, and stop cancels the run in the tree', async () => {
  const tree = new ProcessTreeStore();
  const scans = new Scans({ scan: scanOf(fakeWorld({ slow: true })), tree, niches: { test: NICHE } });
  scans.start('test');
  assert.throws(() => scans.start('test'), /уже идёт/);
  assert.equal(scans.stop('test').stopping, true);
  await scans.settle('test');
  assert.equal(tree.roots()[0].status, 'cancelled');
  assert.equal(scans.plans.has('test'), false);
  assert.equal(scans.stop('test').stopping, false);
  assert.throws(() => scans.start('nope'), /неизвестная ниша/);
});
