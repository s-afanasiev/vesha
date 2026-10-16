// Точка сборки костяка (docs/backbone-architecture.md §4, П3): по этому файлу
// видна система шага 1 — доска с типами колонок (Board), путь заявки (Path),
// журнал (Journal), истина (BackboneRepository), дверь сценариев (BackboneDesk),
// каталог-фикстура. Сайт, ассистент, слот инструмента и замеры — следующие шаги §10.

const path = require('node:path');
const db = require('../../db');
const { Board, STAGE_TYPES } = require('./board/Board');
const { templateOf } = require('./board/templates');
const { Path } = require('./orders/Order');
const { Journal } = require('./orders/Journal');
const { BackboneRepository } = require('./BackboneRepository');
const { BackboneDesk } = require('./BackboneDesk');
const { Catalog, CsvFeed } = require('./catalog/Catalog');

// Магазины, которые знает костяк. Шаг 1 — один демо-магазин ниши крепежа;
// заведение магазинов владельцами — вместе с витриной (шаг 4).
const SHOPS = {
  'demo-krepezh': { name: 'Крепёж и сантехника (демо)', niche: 'hardware' },
};
const DEMO_SHOP = 'demo-krepezh';

const board = new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'], maxColumns: 12 });
const journal = new Journal(db);

const backboneDesk = new BackboneDesk({
  repository: new BackboneRepository(db, journal),
  journal,
  board,
  path: new Path(STAGE_TYPES),
  templateOf,
  shops: SHOPS,
});

const catalog = new Catalog(new CsvFeed(path.join(__dirname, 'catalog', 'fixtures', 'hardware-300.csv')));

module.exports = { backboneDesk, board, catalog, DEMO_SHOP };
