// Точка входа сайта магазина — то, что отдаём заказчику вместо всего Vesha
// (docs/backbone-handover.md). Запускается из сборки dist/shop (npm run build:shop):
// там только костяк, платформа (вход, шлюз моделей, каркас компонентов) и ядро
// chat-engine; кабинет public/cabinet/ кладёт сборка. Без плиток экспериментов,
// опроса лент радаров и media-bins.
//
//   /                       витрина магазина SHOP_HOME
//   /backbone/              витрина, окно статуса, политика ПДн, виджет ассистента
//   /cabinet/               кабинет: доска, черновики, замеры, каталог, ассистент, магазины
//   /api/auth               вход и регистрация (сотрудники магазина и админ)
//   /api/backbone           кабинет — за границей ShopAccess
//   /api/backbone-public    витрина — открыта покупателям

// Кабинет магазина живёт здесь, а не в каталоге экспериментов: адрес нужен статике
// ниже и ссылкам в письмах и сообщениях кабинета, поэтому — до чтения config.
const CABINET = '/cabinet/';
process.env.BACKBONE_CABINET_PATH = CABINET;
process.env.LOGIN_RETURN_PATH = CABINET;     // вошёл через Google — в кабинет

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./server/config');
const db = require('./server/db');
const { Accounts, bootAdmins } = require('./server/services/accounts');
const { identityMiddleware } = require('./server/middleware/identity');
const authRoutes = require('./server/routes/auth');
const backboneRoutes = require('./server/routes/backbone');
const backbonePublicRoutes = require('./server/routes/backbonePublic');

const PUBLIC = path.join(__dirname, 'public');

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', identityMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/backbone', backboneRoutes);
app.use('/api/backbone-public', backbonePublicRoutes); // витрина магазина: без границы входа

// Статика — только состав магазина: витрина, кабинет, UI-кит платформы, общие стиль,
// тема и окно входа.
app.use('/backbone', express.static(path.join(PUBLIC, 'backbone')));
app.use(CABINET, express.static(path.join(PUBLIC, 'cabinet')));
app.use('/c', express.static(path.join(PUBLIC, 'c')));
for (const file of ['style.css', 'theme.js', 'auth.js']) {
  // root, а не абсолютный путь: иначе папка с точкой выше сборки (/home/x/.apps) — 404
  app.get(`/${file}`, (_req, res) => res.sendFile(file, { root: PUBLIC }));
}

app.get('/', (_req, res) => {
  res.redirect(302, `/backbone/?shop=${encodeURIComponent(config.shopHome)}`);
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Ошибка сервера' });
});

// Подпись cookie гостя витрины — SESSION_SECRET: в бою со строкой по умолчанию или
// короткой cookie подделываются (чужой гость — его разговор и заявки у ассистента).
function refuseWeakSecret(env = process.env) {
  if (env.NODE_ENV === 'production' && String(env.SESSION_SECRET || '').length < 32) {
    throw new Error('SESSION_SECRET не задан или короче 32 символов — задайте в .env (openssl rand -hex 32)');
  }
}

async function start() {
  refuseWeakSecret();
  app.listen(config.port, config.host, () => {
    console.log(`Shop running at http://${config.host || 'localhost'}:${config.port} (витрина: ${config.shopHome})`);
  });

  try {
    await db.migrate();
    await bootAdmins(new Accounts(db), config); // админ — из .env: регистрация его почты закрыта
  } catch (err) {
    console.warn('DB migrate failed:', err.message);
    console.warn('API that needs Postgres will fail until DATABASE_URL is ready.');
  }
}

if (require.main === module) start();

module.exports = { app, start, refuseWeakSecret, CABINET };
