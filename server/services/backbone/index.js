// Точка сборки костяка (docs/backbone-architecture.md §4, П3): по этому файлу
// видна система шагов 1–4 и кода шага 6 — доска с типами колонок (Board), путь
// заявки (Path), журнал (Journal), истина (BackboneRepository), дверь сценариев
// (BackboneDesk), магазины из таблицы (ShopForm — заведение из кабинета), каталог
// магазина из его выгрузки xlsx (CatalogFile, Catalogs) с индексом атрибутов,
// инструмент слота «разбор заявки в счёт» на каталоге магазина с выгрузкой в 1С,
// замеры из журнала и теневой режим; витрина: заявка с сайта, окно статуса по
// ссылке, квитанции клиенту — письмом (SMTP) или файлами .eml. Ассистент — шаг 5 §10.

const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const config = require('../../config');
const { Board, STAGE_TYPES } = require('./board/Board');
const { TEMPLATES, templateOf } = require('./board/templates');
const { Path } = require('./orders/Order');
const { Journal } = require('./orders/Journal');
const { BackboneRepository } = require('./BackboneRepository');
const { BackboneDesk } = require('./BackboneDesk');
const { ShopForm } = require('./shops/ShopForm');
const { Catalogs, CsvFeed } = require('./catalog/Catalog');
const { CatalogIndex } = require('./catalog/CatalogIndex');
const { CatalogFile } = require('./catalog/CatalogFile');
const hardwareAttributes = require('./catalog/hardwareAttributes');
const { OrderToInvoice } = require('./invoice/OrderToInvoice');
const { InvoiceDraft } = require('./invoice/InvoiceDraft');
const { StockCheck } = require('./invoice/StockCheck');
const { Match, Matches } = require('./invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('./invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('./invoice/RequestText');
const { GuardedLlm, RecordedLlm } = require('./invoice/models');
const { InvoiceExport } = require('./invoice/InvoiceExport');
const { FinalInvoice } = require('./invoice/FinalInvoice');
const { Measures } = require('./measures/Measures');
const { WorkingHours } = require('./measures/WorkingHours');
const { Baseline } = require('./measures/Baseline');
const { SiteIntake } = require('./site/SiteIntake');
const { StatusPage } = require('./site/StatusPage');
const { Receipts } = require('./receipts/Receipts');
const { FileMailbox } = require('./receipts/FileMailbox');
const { SmtpMailbox } = require('./receipts/SmtpMailbox');

// Посев: магазины, которые костяк знает из кода, — только демо. Остальные админ
// заводит в кабинете (backbone_shops, шаг 6); новый начинает с тени (14 дней базы
// «до»). Демо показывает помощь сразу, тень у него — без срока; каталог демо, пока
// выгрузку не загрузили, — фикстура на 300 позиций.
const SEEDS = {
  'demo-krepezh': {
    name: 'Крепёж и сантехника (демо)', niche: 'hardware',
    hours: { days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '19:00' },
    mode: 'help', shadowDays: 0,
    catalog: path.join(__dirname, 'catalog', 'fixtures', 'hardware-300.csv'),
  },
};
const DEMO_SHOP = 'demo-krepezh';
const FIXTURES = path.join(__dirname, 'invoice', 'fixtures');
// Словарь атрибутов наименований по нишам; у ниши без своего словаря — словарь крепежа.
const ATTRIBUTES = { hardware: hardwareAttributes };
const attributesOf = (niche) => ATTRIBUTES[niche] || hardwareAttributes;

const board = new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'], maxColumns: 12 });
const journal = new Journal(db);
const repository = new BackboneRepository(db, journal);                  // истина: магазины, заявки, доска, каталог, квитанции

// Каталог магазина — общее для сайта, ассистента и инструмента, строится один раз
// на версию выгрузки (П5): размер, стандарт, класс, покрытие — словарём ниши.
const catalogs = new Catalogs({
  repository,
  indexOf: (niche) => new CatalogIndex({ attributes: attributesOf(niche) }),
  fixtureOf: (shop) => (SEEDS[shop.slug] && SEEDS[shop.slug].catalog ? new CsvFeed(SEEDS[shop.slug].catalog) : null),
});
const catalogFile = new CatalogFile(new SheetRows({ maxEntryBytes: 64 * 1024 * 1024 }), { maxItems: 20_000, maxRejects: 300 });

// Разбор заявки в счёт — конвейер форм данных, названный по выходу (О1), на каталоге
// магазина; живёт, пока жив каталог: новая выгрузка — новый конвейер.
function invoiceTool(catalog, niche) {
  const match = new Match(catalog.index, {                                // без модели: синонимы, атрибуты, похожесть
    autoAccept: 0.9, ask: 0.6, defaultCoating: attributesOf(niche).defaultCoating,
  });
  return new OrderToInvoice(
    new InvoiceDraft(
      new StockCheck(catalog, { pack: 'ask' }),                           // 37 шт. при упаковке по 50 — вопрос клиенту
      new Matches(match),
      new Lines(
        new RuleLines(),                                                  // «наименование — количество ед.»
        new ModelLines({ verify: digitsInSource, maxLines: 60 }),         // остаток — модели; цифры сверяются с текстом (О18)
      ),
      new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }, { maxBytes: 5 * 1024 * 1024 }),
    ),
    {
      maxLines: 200,
      exporter: new InvoiceExport(catalog),                               // принятые строки → xlsx для загрузки в 1С
      finalInvoice: new FinalInvoice(catalog.index, match, new RuleLines()), // тень: итоговый счёт из 1С для сверки
    },
  );
}
const tools = new WeakMap(); // каталог → конвейер
async function toolOf(shop) {
  const catalog = await catalogs.of(shop);
  if (!tools.has(catalog)) tools.set(catalog, invoiceTool(catalog, shop.niche));
  return tools.get(catalog);
}

// Витрина: тот же разбор файлов, что у инструмента, — форматы и отказы одни (§6.3).
const siteIntake = new SiteIntake(
  new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }, { maxBytes: 5 * 1024 * 1024 }),
);

// Квитанции: проекция журнала в исходящие. Почта — SMTP, если он задан в .env,
// иначе файлы .eml (О6); контракт send один.
const mailbox = config.backboneSmtp
  ? new SmtpMailbox({ ...config.backboneSmtp, from: config.backboneMailFrom })
  : new FileMailbox({ dir: config.backboneMailDir, from: config.backboneMailFrom });
const hoursOf = (shop) => new WorkingHours({ tz: shop.tz, ...(shop.hours || {}) });
const receipts = new Receipts({
  repository,
  journal,
  mailbox,
  statusUrl: (token) => `${config.backbonePublicUrl}/backbone/status.html?t=${encodeURIComponent(token)}`,
  deadlineOf: (shop, ms) => {                                             // «ответим в течение часа» — рабочего часа
    const until = hoursOf(shop).deadline(ms, 60);
    return until && new Intl.DateTimeFormat('ru-RU', {
      timeZone: shop.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(until)).replace(', ', ' в ');
  },
});

const llm = config.backboneModel === 'recorded'
  ? new RecordedLlm(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-llm.json'), 'utf8')))
  : new GuardedLlm({ selection: { provider: 'openai' }, timeoutMs: 20_000 }); // серверный пресет шлюза, квота инициатора

const backboneDesk = new BackboneDesk({
  repository,
  journal,
  board,
  path: new Path(STAGE_TYPES),
  templateOf,
  shops: SEEDS,
  shopForm: new ShopForm({ niches: Object.keys(TEMPLATES) }),             // магазин из кабинета, без правки кода
  catalogs,
  catalogFile,                                                            // выгрузка 1С / МойСклад / прайс → каталог (О17)
  toolOf,
  llm,
  measuresOf: (shop, spec) => new Measures(                               // замеры из журнала (§6.6)
    new WorkingHours({ tz: shop.tz, ...spec.hours }),                     // «час» — рабочий час магазина
    { replyWithin: 60, silence: { inbox: 60, waitingClientDays: 2 }, sessionGap: 10, b2bLines: 5 },
  ),
  baseline: new Baseline({ shadowDays: 14, accuracy: 0.8, minLines: 20 }), // помощь — решением с мерой (О19)
  intake: siteIntake,                                                     // заявка с витрины (§6.3)
  statusPage: new StatusPage(),                                           // окно статуса клиента (stages@1)
  receipts,                                                               // квитанции после переходов (§6.1)
});

const demoRequest = () => fs.readFileSync(path.join(FIXTURES, 'request-20.txt'), 'utf8');

module.exports = { backboneDesk, board, catalogFile, invoiceTool, demoRequest, DEMO_SHOP, SEEDS, TEMPLATES };
