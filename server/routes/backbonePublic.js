// Витрина костяка (docs/backbone-architecture.md §6.3, шаг 4): публичный тонкий
// транспорт (П9) — без requireAdmin, это сторона клиента магазина. Решения — в
// BackboneDesk и SiteIntake; здесь — форма, файл и защита от наплыва.
//
//   GET  /shops/:slug                 витрина: название, часы, группы каталога
//   GET  /shops/:slug/catalog?q=&group=  поиск по каталогу: цена, упаковка, наличие
//   POST /shops/:slug/orders          «заявка списком»: текст или файл, контакт, согласие
//   /c/status                         stages@1: окно статуса по токену ссылки
//
// Наружу не уходят ни остатки числом, ни контакты, ни текст заявки: окно статуса
// показывает номер, шаги и даты.

const express = require('express');
const multer = require('multer');
const config = require('../config');
const { Components } = require('../components');
const { Stages } = require('../components/stages');
const { backboneDesk, catalog, SHOPS } = require('../services/backbone');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// Не больше N заявок с одного адреса за окно: форма открыта всем (честный простой узел).
const windowMs = config.backboneSiteWindowMin * 60 * 1000;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= config.backboneSitePerIp) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function known(slug) {
  const spec = SHOPS[slug];
  if (!spec) throw Object.assign(new Error('Магазин не найден'), { status: 404 });
  return spec;
}

router.get('/shops/:slug', (req, res, next) => {
  try {
    const spec = known(req.params.slug);
    res.json({ ok: true, name: spec.name, hours: spec.hours || null, groups: catalog.groups() });
  } catch (err) { next(err); }
});

router.get('/shops/:slug/catalog', (req, res, next) => {
  try {
    known(req.params.slug);
    const { total, items } = catalog.search({
      q: String(req.query.q || '').slice(0, 100),
      group: String(req.query.group || ''),
      limit: 60,
    });
    res.json({
      ok: true,
      total,
      items: items.map((i) => ({
        sku: i.sku, name: i.name, group: i.group, unit: i.unit, pack: i.pack, price: i.price, inStock: i.stock > 0,
      })),
    });
  } catch (err) { next(err); }
});

router.post('/shops/:slug/orders', (req, res, next) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Слишком много заявок подряд — попробуйте через несколько минут' });
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
        throw Object.assign(new Error(tooBig ? 'Файл больше 5 МБ' : 'Файл не принят'), { status: 400 });
      }
      known(req.params.slug);
      const file = req.file ? { name: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), data: req.file.buffer } : null;
      const { order, duplicate, refusal } = await backboneDesk.receiveFromSite(req.params.slug, req.body || {}, file);
      res.json({
        ok: true,
        number: order.number,
        duplicate,
        status: `/backbone/status.html?t=${encodeURIComponent(order.status_token)}`,
        notice: refusal ? `${refusal.message} Заявку мы приняли — пришлите список текстом в ответ на письмо.` : null,
      });
    } catch (err) { next(err); }
  });
});

router.use('/c', Components({
  'status': Stages({
    title: 'Путь заявки',
    path: ({ key }) => backboneDesk.statusOf(key),
  }),
}));

module.exports = router;
