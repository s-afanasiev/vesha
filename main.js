const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const config = require('./server/config');
const { migrate } = require('./server/db');
const { identityMiddleware } = require('./server/middleware/identity');
const authRoutes = require('./server/routes/auth');
const looksRoutes = require('./server/routes/looks');
const summarizeRoutes = require('./server/routes/summarize');
const extractAudioRoutes = require('./server/routes/extractAudio');

const app = express();

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.summarizeDir, { recursive: true });
fs.mkdirSync(config.extractAudioDir, { recursive: true });

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', identityMiddleware);
app.use('/api/summarize', summarizeRoutes);
app.use('/api/extract-audio', extractAudioRoutes);
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
  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });

  try {
    await migrate();
    const {
      backfillImageHashes,
      cleanupDuplicateLooks,
    } = require('./server/services/imageHash');
    const hashed = await backfillImageHashes();
    if (hashed) console.log('Backfilled image hashes:', hashed);
    const removed = await cleanupDuplicateLooks();
    if (removed) console.log('Removed duplicate looks:', removed);
    try {
      const { ensureSummarizeJobsTable } = require('./server/services/summarizeHistory');
      await ensureSummarizeJobsTable();
      console.log('summarize_jobs table ready');
    } catch (histErr) {
      console.warn('summarize_jobs table missing/unavailable:', histErr.message);
    }
  } catch (err) {
    console.warn('DB migrate skipped/failed:', err.message);
    console.warn('API that needs Postgres will fail until DATABASE_URL is ready.');
  }

  try {
    const { ensureMediaBins } = require('./scripts/install-media-bins');
    await ensureMediaBins({ quietIfOk: true });
  } catch (err) {
    console.warn('media-bins skipped/failed:', err.message);
    console.warn(
      'На Linux нужны ELF-файлы bin/yt-dlp, bin/ffmpeg, bin/ffprobe. Windows .exe из WinSCP не подойдут.'
    );
  }
}

start();
