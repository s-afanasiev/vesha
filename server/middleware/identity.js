const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

const GUEST_COOKIE = 'vesha_guest';
const SESSION_COOKIE = 'vesha_session';

function sign(value) {
  const h = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  return `${value}.${h}`;
}

function verifySigned(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const i = raw.lastIndexOf('.');
  if (i <= 0) return null;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function ensureGuest(req, res) {
  const signed = req.cookies[GUEST_COOKIE];
  const guestId = verifySigned(signed);

  if (guestId) {
    const { rows } = await db.query(
      `UPDATE guests SET last_seen_at = now() WHERE id = $1 RETURNING *`,
      [guestId]
    );
    if (rows[0]) {
      req.guest = rows[0];
      return;
    }
  }

  const { rows } = await db.query(
    `INSERT INTO guests DEFAULT VALUES RETURNING *`
  );
  req.guest = rows[0];
  res.cookie(GUEST_COOKIE, sign(req.guest.id), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

async function loadSession(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;

  const tokenHash = hashToken(token);
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash]
  );
  if (!rows[0]) return;
  req.user = {
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
  };
  req.sessionId = rows[0].session_id;
}

async function createSession(res, userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expires, meta.userAgent || null, meta.ip || null]
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  });
}

async function destroySession(req, res) {
  if (req.sessionId) {
    await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
  }
  res.clearCookie(SESSION_COOKIE);
}

async function identityMiddleware(req, res, next) {
  try {
    await loadSession(req);
    await ensureGuest(req, res);
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется вход' });
  }
  next();
}

module.exports = {
  identityMiddleware,
  createSession,
  destroySession,
  requireUser,
  GUEST_COOKIE,
  SESSION_COOKIE,
};
