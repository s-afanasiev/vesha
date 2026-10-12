// «Кому автоматизировать» (automation-leads) — точка сборки (П3): дерево
// целиком, читается как оглавление. Архитектура и решения —
// docs/automation-leads-architecture.md.
//
// Ниша × город → места → аудит каждого места (карточка, сайт, отзывы) → план
// лидов: кому из бизнеса предложить сайт с каталогом, умного ассистента или
// канбан-воронку и почему. Сейчас данные — файлы первого прогона (сквозной
// прогон без сети, П31); живые узлы встанут на место NicheFiles и
// RecordedMarking, не меняя дерева.

const path = require('node:path');
const config = require('../../config');
const { ProcessTreeStore } = require('../../process-tree');
const { NicheFiles, RecordedMarking } = require('./sources/nicheFiles');
const { CardFacts, SiteFacts, ReviewFailures } = require('./audits');
const { Places, PlaceAudit, EachPlace } = require('./places');
const { FailureCatalog, OfferCatalog } = require('./catalogs');
const { DigitalGaps, LeadRule } = require('./rules');
const { LeadPlan } = require('./LeadPlan');
const { NicheScan, Scans } = require('./NicheScan');
const { NICHES } = require('./niches');

const dataDir = path.resolve(config.automationLeadsDataDir);
const tree = new ProcessTreeStore({ keepRoots: 20 });              // вехи прогонов: что реально произошло

const scan = new NicheScan({
  worldOf: (niche) => ({                                            // внешний мир прогона: источник и разметка
    source: new NicheFiles(dataDir, niche.files),
    marking: new RecordedMarking(dataDir, niche.files),
  }),
  places: new Places(),                                             // места ниши: рубрика ≠ ниша
  each: new EachPlace(new PlaceAudit({                              // узел дерева на каждое место (П16)
    card: new CardFacts(),                                          // контакты, каналы, гигиена, масштаб
    site: new SiteFacts(),                                          // каталог, цены, заказ, чат
    reviews: new ReviewFailures({                                   // сбой процесса + цитата из свежих отзывов
      catalog: new FailureCatalog(),
      freshFrom: '2024-01-01',
    }),
  })),
  plan: new LeadPlan({                                              // чистое действие: кому, что, почему
    gaps: new DigitalGaps(),
    rule: new LeadRule({ maxBranches: 3 }),
    offers: new OfferCatalog(),
  }),
});

const scans = new Scans({ scan, tree, niches: NICHES });           // хозяин прогонов: start ↔ stop

module.exports = { scans, tree, NICHES };
