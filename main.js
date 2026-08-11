const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const config = require('./server/config');
const { migrate } = require('./server/db');
const { identityMiddleware } = require('./server/middleware/identity');
const authRoutes = require('./server/routes/auth');
const looksRoutes = require('./server/routes/looks');

const app = express();

fs.mkdirSync(config.uploadDir, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', identityMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/looks', looksRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Ошибка сервера' });
});

async function start() {
  try {
    await migrate();
  } catch (err) {
    console.warn('DB migrate skipped/failed:', err.message);
    console.warn('API that needs Postgres will fail until DATABASE_URL is ready.');
  }

  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });
}

start();
