const test = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTreeStore } = require('../server/process-tree');
const { DigitalGaps, LeadRule, RubricFit } = require('../server/services/automation-leads/rules');
const { FailureCatalog, OfferCatalog } = require('../server/services/automation-leads/catalogs');
const { CardFacts, SiteFacts, ReviewFailures } = require('../server/services/automation-leads/audits');
const { Places, PlaceAudit, EachPlace } = require('../server/services/automation-leads/places');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LeadPlan } = require('../server/services/automation-leads/LeadPlan');
const { NicheScan } = require('../server/services/automation-leads/NicheScan');
const { LeadsDesk } = require('../server/services/automation-leads/desk');
const { Listing, PlaceCorpus, CardPage, SitePage, FreshReviews, Marking, NicheCollect, SourceProbe } = require('../server/services/automation-leads/collect');
const { Corpus } = require('../server/services/automation-leads/corpus');
const { PatientLlm } = require('../server/services/automation-leads/patientLlm');
const { NicheFiles, RecordedMarking } = require('../server/services/automation-leads/sources/nicheFiles');
const { NeedCatalog } = require('../server/services/radar/needCatalog');
const { Patience } = require('../server/services/collectors/patience');
const { SourceHttpError } = require('../server/services/collectors/http');

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
  // таймаут или защита от ботов — «проверить не дали», пробела сайта нет
  assert.deepEqual(gaps.of({ ...CARD, unconfirmed: false }, { has: true, audited: true, ok: false, unverifiable: true }).map((g) => g.label), ['нет мессенджера']);
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

const NICHE = {
  slug: 'test',
  title: 'Тест',
  city: 'Курск',
  citySlug: 'kursk',
  queries: ['крепёж', 'сантехника'],
  rubrics: ['Крепёж', 'Сантехника'],
  pack: 'hardware',
  hooks: { fastener_pick: ['Крепёж'] },
};

// Дверь с настоящими работами и подставным внешним миром.
function deskOf({ world = fakeWorld(), corpus = null, collectWorld = null } = {}) {
  const tree = new ProcessTreeStore();
  const desk = new LeadsDesk({
    tree,
    niches: { test: NICHE },
    corpus: corpus || { info: async () => null },
    scan: new NicheScan({
      places: new Places(),
      each: new EachPlace(new PlaceAudit({
        card: new CardFacts(),
        site: new SiteFacts(),
        reviews: new ReviewFailures({ catalog: new FailureCatalog(), freshFrom: '2024-01-01' }),
      })),
      plan: new LeadPlan(),
    }),
    collect: new NicheCollect({
      listing: new Listing({ maxPages: 7, quietPages: 2 }),
      each: new EachPlace(new PlaceCorpus({
        card: new CardPage(),
        site: new SitePage(),
        reviews: new FreshReviews({ from: '2024-01-01', perOrg: 10 }),
      }), { nodeType: 'PlaceCorpus' }),
      marking: new Marking(),
      corpus,
    }),
    probe: new SourceProbe(),
    scanWorld: corpus
      ? (niche) => ({
        source: new NicheFiles(corpus.dirOf(niche.slug)),
        marking: new RecordedMarking(path.join(corpus.dirOf(niche.slug), 'marks.jsonl')),
      })
      : () => world,
    collectWorld: collectWorld || (() => { throw new Error('мира сбора нет'); }),
  });
  return { desk, tree };
}

test('niche scan runs end to end: named skips in the tree, leads with evidence in the plan', async () => {
  const { desk, tree } = deskOf();
  desk.scan('test');
  await desk.settle('test');

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

  const { plan } = desk.plans.get('test');
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

test('desk: one run per lane at a time, and stop cancels the run in the tree', async () => {
  const { desk, tree } = deskOf({ world: fakeWorld({ slow: true }) });
  desk.scan('test');
  assert.throws(() => desk.scan('test'), /сейчас идёт разбор/);
  assert.equal(desk.stop('test').stopping.length, 1);
  await desk.settle('test');
  assert.equal(tree.roots()[0].status, 'cancelled');
  assert.equal(desk.plans.has('test'), false);
  assert.equal(desk.stop('test').stopping.length, 0);
  assert.throws(() => desk.scan('nope'), /неизвестная ниша/);
});

// Подставной 2ГИС, сайты и модель: тот же контракт, что у TwoGis, WebPage и PatientLlm.
function fakeSources({ refuseFirmAfter = Infinity, slowMs = 0 } = {}) {
  const P1 = { branch_id: '1', name: 'Метизы у дома', address: 'ул. Ленина, 1', rubrics: ['Крепёж'] };
  const P2 = { branch_id: '2', name: 'Сантехника плюс', address: 'ул. Мира, 2', rubrics: ['Сантехника'] };
  const P3 = { branch_id: '3', name: 'Мебельная фурнитура', address: 'ул. Садовая, 3', rubrics: ['Мебельная фурнитура'] };
  const pages = { 'крепёж': [[P1, P3], [P1], [P3]], 'сантехника': [[P2]] };
  const cards = {
    1: { branch_id: '1', name: P1.name, rubrics: P1.rubrics, phones: ['+7 000'], websites: [], messengers: [], schedule: true, unconfirmed: false, promoted: false, branches: 1 },
    2: { branch_id: '2', name: P2.name, rubrics: P2.rubrics, phones: ['+7 111'], websites: ['santeh.example'], messengers: ['wa'], schedule: true, unconfirmed: false, promoted: true, branches: 1 },
  };
  const reviews = {
    1: [
      { review_id: 'a', rating: 1, date_created: '2025-03-01T10:00:00+03:00', text: 'Продавцы не знают ассортимент, ничего не подсказали', has_official_answer: true },
      { review_id: 'b', rating: 5, date_created: '2020-01-01T10:00:00+03:00', text: 'старый отзыв', has_official_answer: false },
    ],
  };
  let firms = 0;
  const twogis = {
    methods: ['listing', 'firm', 'reviews'],
    listing: async (_city, query, page) => {
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      return (pages[query] || [])[page - 1] || [];
    },
    firm: async (_city, id) => {
      firms += 1;
      if (firms > refuseFirmAfter) throw new SourceHttpError('http_403', 'Источник ответил 403', 403);
      return cards[id] || null;
    },
    reviews: async (id) => reviews[id] || [],
  };
  const web = { page: async (url) => (url.startsWith('https://santeh.example') ? { finalUrl: url, status: 200, text: '<a>Каталог</a>' } : { error: 'нет' }) };
  const llm = {
    complete: async (messages) => {
      const ids = [...messages[1].content.matchAll(/\[id (\w+)\]/g)].map((m) => m[1]);
      return {
        text: JSON.stringify({ reviews: ids.map((id) => ({
          id,
          author: 'client',
          signals: id === 'a' ? [{ need: 'info.explain', polarity: 'missing', service: 'fasteners', quote: 'не знают ассортимент' }] : [],
        })) }),
        usage: { cost_rub: 0.5 },
      };
    },
  };
  return (niche, _actor, signal) => ({
    niche,
    twogis: new Patience(twogis, { gapMs: 0 }),
    web,
    llm,
    catalog: new NeedCatalog({ pack: niche.pack }),
    sites: new Map(),
    signal,
  });
}

async function tempCorpus() {
  return new Corpus(await fs.mkdtemp(path.join(os.tmpdir(), 'leads-corpus-')));
}

test('collect writes the corpus that scan reads: from 2GIS to leads end to end', async () => {
  const corpus = await tempCorpus();
  const { desk, tree } = deskOf({ corpus, collectWorld: fakeSources() });
  desk.collect('test', { actor: { id: 'u1', email: 'admin@example.com' } });
  await desk.settle('test');

  const root = tree.roots()[0];
  assert.equal(root.status, 'completed');
  assert.equal(root.payload.actor, 'admin@example.com');
  const nodes = tree.nodesOf(root.nodeId);
  const status = (type) => nodes.filter((n) => n.nodeType === type).map((n) => [n.status, n.outcome && n.outcome.code]);
  assert.deepEqual(status('ListingQuery'), [['completed', undefined], ['completed', undefined]]);
  assert.deepEqual(status('SitePage'), [['skipped', 'no_site'], ['completed', undefined]]);
  assert.deepEqual(status('FreshReviews'), [['completed', undefined], ['skipped', 'no_fresh_reviews']]);
  assert.deepEqual(status('MarkBatch'), [['completed', undefined]]);

  const info = await corpus.info('test');
  assert.deepEqual(info.counts, { listed: 3, places: 2, cards: 2, sites: 1, reviews: 1, marked: 1, costRub: 0.5 });

  desk.scan('test');
  await desk.settle('test');
  const { plan } = desk.plans.get('test');
  assert.deepEqual(plan.counts, { places: 2, leads: 2, strong: 1, weak: 1, rejected: 0, unaudited: 0 });
  assert.equal(plan.leads[0].quote, '«не знают ассортимент» (2025-03)');
  assert.equal(plan.leads[1].gaps, 'на сайте нет цен, нельзя заказать онлайн');
  const [row] = await desk.nicheRows();
  assert.match(row.corpus, /мест 2 · отзывов 1 · размечено 1/);
});

test('a source refusal mid-collect stops the run and keeps the previous corpus intact', async () => {
  const corpus = await tempCorpus();
  const first = deskOf({ corpus, collectWorld: fakeSources() });
  first.desk.collect('test');
  await first.desk.settle('test');
  const before = await fs.readFile(path.join(corpus.dirOf('test'), 'meta.json'), 'utf8');

  const second = deskOf({ corpus, collectWorld: fakeSources({ refuseFirmAfter: 1 }) });
  second.desk.collect('test');
  await second.desk.settle('test');
  const root = second.tree.roots()[0];
  assert.equal(root.status, 'failed');
  assert.equal(root.outcome.code, 'refused');
  assert.equal(await fs.readFile(path.join(corpus.dirOf('test'), 'meta.json'), 'utf8'), before);
  await assert.rejects(fs.access(`${corpus.dirOf('test')}.collecting`));
});

test('lanes: a 2GIS probe blocks a collect but not a scan; stop cancels the probe', async () => {
  const corpus = await tempCorpus();
  const { desk, tree } = deskOf({ corpus, collectWorld: fakeSources({ slowMs: 30 }) });
  desk.probe('test');
  assert.throws(() => desk.collect('test'), /сейчас идёт проверка 2ГИС/);
  assert.deepEqual(desk.stop('test').stopping, ['2ГИС · Курск']);
  await desk.settle('test');
  assert.equal(tree.roots()[0].status, 'cancelled');
});

test('patient llm waits out the quota as a named waiting state and gives up past its ceiling', async () => {
  const store = new ProcessTreeStore();
  const node = store.createNode({ nodeType: 'MarkBatch' });
  node.start();
  let attempts = 0;
  let seenUser = null;
  let statusWhileWaiting = null;
  const llm = new PatientLlm({
    guard: async (req, task) => {
      seenUser = req.user;
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('лимит'), { code: 'llm_rate_limit', retryAfterSec: 2 });
      return task();
    },
    complete: async () => ({ text: 'ok' }),
    wait: async () => { statusWhileWaiting = store.nodesOf(node.id)[0].status; },
  });
  const result = await llm.forActor({ id: 'u1' }).complete([], { node });
  assert.equal(result.text, 'ok');
  assert.equal(statusWhileWaiting, 'waiting');
  assert.deepEqual(seenUser, { id: 'u1' });
  const [raw] = store.nodesOf(node.id);
  assert.equal(raw.status, 'running');
  assert.equal(raw.outcome, null);

  const stuck = new PatientLlm({
    guard: async () => { throw Object.assign(new Error('лимит'), { code: 'llm_rate_limit', retryAfterSec: 3600 }); },
    wait: async () => {},
    maxWaitMs: 60 * 1000,
  });
  await assert.rejects(stuck.forActor(null).complete([], {}), (err) => err.code === 'llm_quota');
});
