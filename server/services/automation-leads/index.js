// «Кому автоматизировать» (automation-leads) — точка сборки (П3): дерево
// целиком, читается как оглавление. Архитектура и решения —
// docs/automation-leads-architecture.md.
//
// Два сценария над одним корпусом ниши и воронка после них:
//   сбор    — 2ГИС и сайты мест → корпус на диске (листинг, карточки, сайты, отзывы, разметка);
//   разбор  — корпус → кому из бизнеса предложить сайт с каталогом, умного ассистента
//             или канбан-воронку и почему → лиды в воронку владельца;
//   воронка — лид «я × компания × оффер» со своей судьбой и журналом в Postgres;
//             ведёт человек: пишет, звонит и переносит сам.

const path = require('node:path');
const config = require('../../config');
const db = require('../../db');
const { ProcessTreeStore } = require('../../process-tree');
const { TreeLog, PgTreeRows } = require('../../process-tree/persist');
const { Journal } = require('../backbone/orders/Journal');
const { Board, STAGE_TYPES } = require('../backbone/board/Board');
const { TwoGis } = require('../collectors/twogis');
const { WebPage } = require('../collectors/webPage');
const { Patience } = require('../collectors/patience');
const { NeedCatalog } = require('../radar/needCatalog');
const { NicheFiles, RecordedMarking } = require('./sources/nicheFiles');
const { Corpus } = require('./corpus');
const { PatientLlm } = require('./patientLlm');
const { CardFacts, SiteFacts, ReviewFailures } = require('./audits');
const { Places, PlaceAudit, EachPlace } = require('./places');
const { Listing, PlaceCorpus, CardPage, SitePage, FreshReviews, Marking, NicheCollect, SourceProbe } = require('./collect');
const { FailureCatalog, OfferCatalog } = require('./catalogs');
const { DigitalGaps, LeadRule } = require('./rules');
const { LeadPlan } = require('./LeadPlan');
const { NicheScan } = require('./NicheScan');
const { LeadsDesk } = require('./desk');
const { LeadPath, FUNNEL_TEMPLATE } = require('./funnel/Lead');
const { LeadFunnel, LeadIntake } = require('./funnel/LeadFunnel');
const { LeadRepository } = require('./funnel/LeadRepository');
const { NICHES } = require('./niches');

// общее: дерево прогонов, корпус на диске, внешний мир за обёртками терпения
const tree = new ProcessTreeStore({ keepRoots: 20 });                     // вехи: что реально произошло
new TreeLog(new PgTreeRows(db), {                                         // мост в Postgres: прогоны переживают рестарт
  tree: 'automation-leads', flushMs: 500, ready: db.migrated,
}).attach(tree);
const corpus = new Corpus(path.resolve(config.automationLeadsDataDir));   // niches/<slug>/ — одна раскладка
const twogis = new Patience(new TwoGis({ reviewsKey: config.twogisReviewsKey }), {
  gapMs: config.twogisGapMs,                                              // пауза между любыми обращениями
  cooldownMs: config.twogisCooldownMin * 60 * 1000,                       // после 403/429 — остываем
});
const web = new Patience(new WebPage({ timeoutMs: 12000 }), { gapMs: 300 }); // сайты мест: только публичные адреса
const llm = new PatientLlm({ selection: { provider: 'openai' } });          // серверный пресет шлюза, квота инициатора

// сбор: ниша × город → корпус
const collect = new NicheCollect({
  listing: new Listing({ maxPages: 7, quietPages: 2 }),                   // тематические запросы, рубрика ≠ ниша
  each: new EachPlace(new PlaceCorpus({                                   // узел дерева на каждое место
    card: new CardPage(),                                                 // карточка 2ГИС
    site: new SitePage(),                                                 // главная сайта, без JS
    reviews: new FreshReviews({ from: '2024-01-01', perOrg: 10 }),         // одинаковый «голос» у всех мест
  }), { nodeType: 'PlaceCorpus' }),
  marking: new Marking(),                                                 // справочник потребностей v2, батчами
  corpus,
});

// воронка: лиды владельца в Postgres, журнал — общий с костяком
const journal = new Journal(db);                                          // stream 'lead', scope — воронка владельца
const funnel = new LeadFunnel({
  repository: new LeadRepository(db, journal),
  journal,
  board: new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'], maxColumns: 12 }), // те же смысловые типы, что у заявок
  path: new LeadPath({ maxReason: 200, maxNote: 1000, maxWaitDays: 365 }), // отказ — с причиной, ожидание — со сроком
  template: FUNNEL_TEMPLATE,                                              // найден → отобран → предложение → … → договорились
});

// разбор: корпус → план лидов → воронка
const scan = new NicheScan({
  places: new Places(),                                                   // места ниши из корпуса
  each: new EachPlace(new PlaceAudit({
    card: new CardFacts(),                                                // каналы, гигиена, масштаб
    site: new SiteFacts(),                                                // каталог, цены, заказ, чат
    reviews: new ReviewFailures({ catalog: new FailureCatalog(), freshFrom: '2024-01-01' }),
  })),
  plan: new LeadPlan({                                                    // чистое действие: кому, что, почему
    gaps: new DigitalGaps(),
    rule: new LeadRule({ maxBranches: 3 }),
    offers: new OfferCatalog(),
  }),
  intake: new LeadIntake(funnel),                                         // лиды плана → воронка того, кто нажал «Разобрать»
});

const desk = new LeadsDesk({                                              // дверь: собрать, разобрать, проверить, остановить
  tree,
  niches: NICHES,
  corpus,
  scan,
  collect,
  probe: new SourceProbe(),                                               // три запроса: отдаёт ли 2ГИС данные этому серверу
  scanWorld: (niche) => ({
    source: new NicheFiles(corpus.dirOf(niche.slug)),
    marking: new RecordedMarking(path.join(corpus.dirOf(niche.slug), 'marks.jsonl')),
  }),
  collectWorld: (niche, actor, signal) => ({
    niche,
    twogis,
    web,
    llm: llm.forActor(actor),
    catalog: new NeedCatalog({ pack: niche.pack }),
    sites: new Map(),
    signal,
  }),
  twogis,
});

module.exports = { desk, tree, funnel, NICHES };
