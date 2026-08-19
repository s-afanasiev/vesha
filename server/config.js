require('dotenv').config();

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

const databaseUrl = process.env.DATABASE_URL || '';
const dbConfig = databaseUrl
  ? { connectionString: databaseUrl }
  : {
      host: process.env.PGHOST || 'localhost',
      port: intEnv('PGPORT', 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'vesha',
    };

if (process.env.DATABASE_SSL === 'true' || process.env.PGSSLMODE === 'require') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const config = {
  port: intEnv('PORT', 3000),
  databaseUrl: databaseUrl || `postgres://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
  dbConfig,
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  serpapiApiKey: process.env.SERPAPI_API_KEY || '',
  replicateApiToken: process.env.REPLICATE_API_TOKEN || '',
  replicateRemoveBgModel: process.env.REPLICATE_REMOVE_BG_MODEL || 'lucataco/remove-bg',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  guestUploadsPerDay: intEnv('GUEST_UPLOADS_PER_DAY', 3),
  userUploadsPerDay: intEnv('USER_UPLOADS_PER_DAY', 30),
  guestOfferLimit: intEnv('GUEST_OFFER_LIMIT', 5),
  userOfferLimit: intEnv('USER_OFFER_LIMIT', 30),
  sessionDays: intEnv('SESSION_DAYS', 30),
  uploadDir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
  mediaBinDir: process.env.MEDIA_BIN_DIR || require('path').join(__dirname, '..', 'bin'),
  ytdlpPath: process.env.YTDLP_PATH || '',
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ffprobePath: process.env.FFPROBE_PATH || '',
  summarizeDir:
    process.env.SUMMARIZE_DIR ||
    require('path').join(
      process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
      'summarize'
    ),
  summarizeMaxDurationSec: intEnv('SUMMARIZE_MAX_DURATION_SEC', 3 * 60 * 60),
  summarizeTimeoutMs: intEnv('SUMMARIZE_TIMEOUT_MS', 10 * 60 * 1000),
  summarizeMaxFilesize: process.env.SUMMARIZE_MAX_FILESIZE || '80M',
};

module.exports = config;
