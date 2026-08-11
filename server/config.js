require('dotenv').config();

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: intEnv('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/vesha',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  serpapiApiKey: process.env.SERPAPI_API_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  guestUploadsPerDay: intEnv('GUEST_UPLOADS_PER_DAY', 3),
  userUploadsPerDay: intEnv('USER_UPLOADS_PER_DAY', 30),
  guestOfferLimit: intEnv('GUEST_OFFER_LIMIT', 5),
  userOfferLimit: intEnv('USER_OFFER_LIMIT', 30),
  sessionDays: intEnv('SESSION_DAYS', 30),
  uploadDir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
};

module.exports = config;
