// Точка сборки костяка (docs/backbone-architecture.md §4, П3): по этому файлу
// видна система шагов 1–2 — доска с типами колонок (Board), путь заявки (Path),
// журнал (Journal), истина (BackboneRepository), дверь сценариев (BackboneDesk),
// каталог-фикстура с индексом атрибутов и инструмент слота «разбор заявки в счёт».
// Сайт, ассистент, замеры и выгрузка счёта — следующие шаги §10.

const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const config = require('../../config');
const { Board, STAGE_TYPES } = require('./board/Board');
const { templateOf } = require('./board/templates');
const { Path } = require('./orders/Order');
const { Journal } = require('./orders/Journal');
const { BackboneRepository } = require('./BackboneRepository');
const { BackboneDesk } = require('./BackboneDesk');
const { Catalog, CsvFeed } = require('./catalog/Catalog');
const { CatalogIndex } = require('./catalog/CatalogIndex');
const hardwareAttributes = require('./catalog/hardwareAttributes');
const { OrderToInvoice } = require('./invoice/OrderToInvoice');
const { InvoiceDraft } = require('./invoice/InvoiceDraft');
const { StockCheck } = require('./invoice/StockCheck');
const { Match, Matches } = require('./invoice/Match');
const { Lines, RuleLines, ModelLines, digitsInSource } = require('./invoice/Lines');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('./invoice/RequestText');
const { GuardedLlm, RecordedLlm } = require('./invoice/models');

// Магазины, которые знает костяк. Один демо-магазин ниши крепежа;
// заведение магазинов владельцами — вместе с витриной (шаг 4).
const SHOPS = {
  'demo-krepezh': { name: 'Крепёж и сантехника (демо)', niche: 'hardware' },
};
const DEMO_SHOP = 'demo-krepezh';
const FIXTURES = path.join(__dirname, 'invoice', 'fixtures');

const board = new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'], maxColumns: 12 });
const journal = new Journal(db);

const catalog = new Catalog(                                              // общее — один раз (П5)
  new CsvFeed(path.join(__dirname, 'catalog', 'fixtures', 'hardware-300.csv')), // до шага 6 — фикстура (О6)
  new CatalogIndex({ attributes: hardwareAttributes }),                   // размер, стандарт, класс, покрытие
);

// Разбор заявки в счёт — конвейер форм данных, названный по выходу (О1)
const orderToInvoice = new OrderToInvoice(
  new InvoiceDraft(
    new StockCheck(catalog, { pack: 'ask' }),                             // 37 шт. при упаковке по 50 — вопрос клиенту
    new Matches(new Match(catalog.index, {                                // без модели: синонимы, атрибуты, похожесть
      autoAccept: 0.9, ask: 0.6, defaultCoating: hardwareAttributes.defaultCoating,
    })),
    new Lines(
      new RuleLines(),                                                    // «наименование — количество ед.»
      new ModelLines({ verify: digitsInSource, maxLines: 60 }),           // остаток — модели; цифры сверяются с текстом (О18)
    ),
    new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() }, { maxBytes: 5 * 1024 * 1024 }),
  ),
  { maxLines: 200 },
);

const llm = config.backboneModel === 'recorded'
  ? new RecordedLlm(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'recorded-llm.json'), 'utf8')))
  : new GuardedLlm({ selection: { provider: 'openai' }, timeoutMs: 20_000 }); // серверный пресет шлюза, квота инициатора

const backboneDesk = new BackboneDesk({
  repository: new BackboneRepository(db, journal),
  journal,
  board,
  path: new Path(STAGE_TYPES),
  templateOf,
  shops: SHOPS,
  tool: orderToInvoice,
  llm,
});

const demoRequest = () => fs.readFileSync(path.join(FIXTURES, 'request-20.txt'), 'utf8');

module.exports = { backboneDesk, board, catalog, orderToInvoice, demoRequest, DEMO_SHOP };
