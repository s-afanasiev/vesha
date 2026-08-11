const express = require('express');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const config = require('../config');
const {
  createSession,
  destroySession,
} = require('../middleware/identity');
const quota = require('../services/quota');

const router = express.Router();
const googleClient = config.googleClientId
  ? new OAuth2Client(
      config.googleClientId,
      config.googleClientSecret,
      config.googleCallbackUrl
    )
  : null;

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || user.displayName || null,
  };
}

router.get('/me', async (req, res, next) => {
  try {
    const usage = await quota.getUsage(req);
    res.json({
      user: req.user || null,
      guestId: req.guest ? req.guest.id : null,
      usage,
      googleEnabled: Boolean(config.googleClientId),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim() || null;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Укажите корректный email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль не короче 8 символов' });
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email, displayName, passwordHash]
    );
    const user = rows[0];
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, meta)
       VALUES ($1, 'password', $2, '{}'::jsonb)`,
      [user.id, email]
    );
    await createSession(res, user.id, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await db.query(
      `SELECT id, email, display_name, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    await createSession(res, user.id, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/google', (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: 'Google OAuth не настроен' });
  }
  const url = googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res, next) => {
  try {
    if (!googleClient) {
      return res.status(503).send('Google OAuth не настроен');
    }
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Нет кода авторизации');
    }

    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    const sub = payload.sub;
    const email = (payload.email || '').toLowerCase() || null;
    const displayName = payload.name || null;

    let userId;
    const byIdentity = await db.query(
      `SELECT user_id FROM auth_identities
       WHERE provider = 'google' AND provider_subject = $1`,
      [sub]
    );

    if (byIdentity.rows[0]) {
      userId = byIdentity.rows[0].user_id;
    } else {
      let user;
      if (email) {
        const byEmail = await db.query(
          `SELECT id, email, display_name FROM users WHERE email = $1`,
          [email]
        );
        user = byEmail.rows[0];
      }
      if (!user) {
        const created = await db.query(
          `INSERT INTO users (email, display_name)
           VALUES ($1, $2)
           RETURNING id, email, display_name`,
          [email, displayName]
        );
        user = created.rows[0];
      } else if (!user.display_name && displayName) {
        await db.query(
          `UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2`,
          [displayName, user.id]
        );
      }
      userId = user.id;
      await db.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, meta)
         VALUES ($1, 'google', $2, $3::jsonb)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [userId, sub, JSON.stringify({ email, picture: payload.picture || null })]
      );
    }

    await createSession(res, userId, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    res.redirect('/experiments/podborka/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
