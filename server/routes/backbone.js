// Костяк MVP (backbone): тонкий транспорт (П9). Всё API — компонентные экземпляры
// и спека страницы; сценарии — в BackboneDesk. Заявки несут контакты клиентов,
// поэтому граница — здесь, на каждом запросе и до чтения данных: кто куда входит,
// решает правило ShopAccess через дверь (без входа — 401, не ваше — 403). Скрытие
// вкладок в UI — удобство.
//
//   /me                              кто вошёл: админ ли, какие магазины ему открыты
//   POST /invite {token}             сотрудник принимает приглашение: магазин — за его аккаунтом
//   /c/pages/shops, /c/shops, /c/staff  кабинет: магазины и сотрудники — только админ
//   /s/<slug>/c/pages/<экран>        экраны магазина: доска, черновики, замеры, каталог
//   /s/<slug>/c/<экземпляр>          компоненты магазина — админ или сотрудник магазина
//   /s/<slug>/files/invoice/<id>.xlsx  счёт для 1С

const express = require('express');
const { backboneDesk } = require('../services/backbone');
const { forShop, cabinet } = require('../services/backbone/components');
const { pagesOf, cabinetPages } = require('../services/backbone/pages');

const router = express.Router();

// Отказ двери (4xx) — ответ с причиной; сбой сервера — общему обработчику.
function fail(err, res, next) {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  next(err);
}

// Вопрос двери перед экранами: ответила без отказа — дальше.
const entry = (ask) => async (req, res, next) => {
  try {
    await ask(req);
  } catch (err) {
    return fail(err, res, next);
  }
  next();
};

router.use(entry((req) => backboneDesk.signedIn(req.user))); // без входа — 401 на любой адрес

router.get('/me', async (req, res, next) => {
  try {
    const { admin, shops } = await backboneDesk.shopsFor(req.user);
    res.json({ email: req.user.email, admin, shops: shops.map((s) => ({ slug: s.slug, name: s.name })) });
  } catch (err) {
    fail(err, res, next);
  }
});

// Ссылка приглашения из «Добавить сотрудника»: открыл и вошёл — сотрудник этого магазина.
router.post('/invite', async (req, res, next) => {
  try {
    const shop = await backboneDesk.joinStaff((req.body || {}).token, req.user);
    res.json({ ok: true, slug: shop.slug, name: shop.name });
  } catch (err) {
    fail(err, res, next);
  }
});

router.use('/c', entry((req) => backboneDesk.enterCabinet(req.user)));
router.use('/c/pages', cabinetPages);
router.use('/c', cabinet);

// Магазин по адресу: админ — любой известный (таблица или посев, иначе 404), сотрудник —
// только свой; чужой — 403 до сборки экземпляров.
router.use('/s/:slug', entry((req) => backboneDesk.enter(req.params.slug, req.user)));
router.use('/s/:slug/c/pages', (req, res, next) => pagesOf(req.params.slug)(req, res, next));
router.use('/s/:slug/c', (req, res, next) => forShop(req.params.slug)(req, res, next));
router.use('/s/:slug/files', require('../services/backbone/files'));

module.exports = router;
