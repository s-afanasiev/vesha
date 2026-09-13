require('dotenv').config();

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name) {
  return String(process.env[name] || '').trim();
}

function boolEnv(name, fallback = false) {
  const value = envStr(name).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function listEnv(name) {
  return envStr(name)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function pandocPathForThisOs() {
  const byOs =
    process.platform === 'win32' ? envStr('PANDOC_PATH_WINDOWS') : envStr('PANDOC_PATH_LINUX');
  return byOs || envStr('PANDOC_PATH');
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
  isProduction: process.env.NODE_ENV === 'production',
  port: intEnv('PORT', 3000),
  trustProxy: boolEnv('TRUST_PROXY', false),
  databaseUrl: databaseUrl || `postgres://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
  dbConfig,
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiApiBase: (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  geminiHttpsProxy: process.env.GEMINI_HTTPS_PROXY || process.env.HTTPS_PROXY || '',
  geminiModel: envStr('GEMINI_MODEL') || 'gemini-2.5-flash',
  yandexApiKey: envStr('YANDEX_API_KEY') || envStr('YANDEX_GPT_API_KEY'),
  yandexIamToken: envStr('YANDEX_IAM_TOKEN'),
  yandexFolderId: envStr('YANDEX_FOLDER_ID'),
  yandexModel: envStr('YANDEX_GPT_MODEL') || 'yandexgpt-lite/latest',
  yandexBaseUrl: (envStr('YANDEX_GPT_BASE_URL') || 'https://llm.api.cloud.yandex.net').replace(
    /\/$/,
    ''
  ),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiAllowKeyless: boolEnv('OPENAI_ALLOW_KEYLESS', false),
  llmDefaultProvider: envStr('LLM_DEFAULT_PROVIDER') || 'gemini',
  llmTimeoutMs: intEnv('LLM_TIMEOUT_MS', 3 * 60 * 1000),
  llmMaxInputChars: intEnv('LLM_MAX_INPUT_CHARS', 300000),
  llmMaxResponseBytes: intEnv('LLM_MAX_RESPONSE_BYTES', 4 * 1024 * 1024),
  llmMaxTokens: intEnv('LLM_MAX_TOKENS', 32768),
  llmServerMaxTokens: intEnv('LLM_SERVER_MAX_TOKENS', 16384),
  llmEnableCustomEndpoints: boolEnv(
    'LLM_ENABLE_CUSTOM_ENDPOINTS',
    process.env.NODE_ENV !== 'production'
  ),
  llmAllowPrivateEndpoints: boolEnv('LLM_ALLOW_PRIVATE_ENDPOINTS', false),
  llmAllowedOpenaiHosts: listEnv('LLM_ALLOWED_OPENAI_HOSTS'),
  llmGuestRequestsPerHour: intEnv('LLM_GUEST_REQUESTS_PER_HOUR', 10),
  llmUserRequestsPerHour: intEnv('LLM_USER_REQUESTS_PER_HOUR', 60),
  llmMaxConcurrent: intEnv('LLM_MAX_CONCURRENT', 4),
  pandocPath: pandocPathForThisOs(),
  notesExportDir:
    process.env.NOTES_EXPORT_DIR ||
    require('path').join(
      process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
      'notes-export'
    ),
  notesExportTimeoutMs: intEnv('NOTES_EXPORT_TIMEOUT_MS', 5 * 60 * 1000),
  notesExportLlmTimeoutMs: intEnv('NOTES_EXPORT_LLM_TIMEOUT_MS', 3 * 60 * 1000),
  notesExportMaxChars: intEnv('NOTES_EXPORT_MAX_CHARS', 200000),
  notesExportMaxTokens: intEnv('NOTES_EXPORT_MAX_TOKENS', 16384),
  notesExportMock: ['1', 'true', 'yes'].includes(String(process.env.NOTES_EXPORT_MOCK || '').toLowerCase()),
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
  summarizeMock: ['1', 'true', 'yes'].includes(String(process.env.SUMMARIZE_MOCK || '').toLowerCase()),
  extractAudioDir:
    process.env.EXTRACT_AUDIO_DIR ||
    require('path').join(
      process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
      'extract-audio'
    ),
  extractAudioTimeoutMs: intEnv('EXTRACT_AUDIO_TIMEOUT_MS', 30 * 60 * 1000),
  extractAudioMaxFilesize: intEnv('EXTRACT_AUDIO_MAX_FILESIZE', 2 * 1024 * 1024 * 1024),
};

module.exports = config;
