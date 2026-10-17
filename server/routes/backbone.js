// Костяк MVP (backbone): тонкий транспорт (П9). Всё API — компонентные экземпляры
// и спека страницы; сценарии — в BackboneDesk. Заявки несут контакты клиентов,
// поэтому целиком за requireAdmin: скрытие плитки — удобство, граница — здесь.
//
//   /c/pages/shops, /c/shops         кабинет: магазины, «Завести магазин»
//   /s/<slug>/c/pages/<экран>        экраны магазина: доска, черновики, замеры, каталог
//   /s/<slug>/c/<экземпляр>          компоненты магазина
//   /s/<slug>/files/invoice/<id>.xlsx  счёт для 1С

const express = require('express');
const experiments = require('../services/experiments');
const { backboneDesk } = require('../services/backbone');
const { forShop, cabinet } = require('../services/backbone/components');
const { pagesOf, cabinetPages } = require('../services/backbone/pages');

const router = express.Router();

router.use(experiments.requireAdmin);
router.use('/c/pages', cabinetPages);
router.use('/c', cabinet);

// Магазин по адресу — только известный (таблица или посев): чужой slug — 404 до сборки экземпляров.
router.use('/s/:slug', async (req, _res, next) => {
  try {
    await backboneDesk.shop(req.params.slug);
    next();
  } catch (err) {
    next(err);
  }
});
router.use('/s/:slug/c/pages', (req, res, next) => pagesOf(req.params.slug)(req, res, next));
router.use('/s/:slug/c', (req, res, next) => forShop(req.params.slug)(req, res, next));
router.use('/s/:slug/files', require('../services/backbone/files'));

module.exports = router;
