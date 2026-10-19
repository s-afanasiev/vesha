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
const { RateWindow } = require('../services/rateWindow');
const { Accounts } = require('../services/accounts');

const router = express.Router();
const accounts = new Accounts(db);

// Перебор пароля: неудачные входы считаются на почту и на адрес; окно полно — 429
// до его конца, даже с верным паролем. Удачный вход обнуляет счёт почты.
const loginWindowMs = config.loginWindowMin * 60 * 1000;
const failedLogins = {
  email: new RateWindow({ max: config.loginFailuresPerEmail, windowMs: loginWindowMs }),
  ip: new RateWindow({ max: config.loginFailuresPerIp, windowMs: loginWindowMs }),
};
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
    let usage = {};
    if (req.guest || req.user) {
      try {
        usage = await quota.getUsage(req);
      } catch (err) {
        usage = {};
      }
    }
    res.json({
      user: req.user || null,
      guestId: req.guest ? req.guest.id : null,
      usage,
      googleEnabled: Boolean(config.googleClientId),
      registrationOpen: config.registrationOpen,
    });
  } catch (err) {
    next(err);
  }
});

// Регистрация почту не подтверждает: почта админа (ADMIN_EMAILS) ею не заводится —
// её учётка приходит из .env (ADMIN_PASSWORD) или через Google; закрытая регистрация
// (сборка магазина) — учётки выдаёт админ.
router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!config.registrationOpen) {
      return res.status(403).json({ error: 'Регистрация на этом сайте закрыта — учётку выдаёт админ' });
    }
    if (config.adminEmails.includes(email)) {
      return res.status(403).json({ error: 'Эта почта — админ сайта: учётка заводится из .env (ADMIN_PASSWORD) или входом через Google' });
    }
    const user = await accounts.create({
      email,
      password: String(req.body.password || ''),
      displayName: String(req.body.displayName || '').trim() || null,
    });
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
    const blocked = [[failedLogins.email, email], [failedLogins.ip, req.ip]].find(([w, key]) => w.full(key));
    if (blocked) {
      const wait = blocked[0].retryAfterSec(blocked[1]);
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Слишком много неудачных попыток входа — попробуйте через ${Math.ceil(wait / 60)} мин.` });
    }
    const refuse = () => {
      failedLogins.email.hit(email);
      failedLogins.ip.hit(req.ip);
      return res.status(401).json({ error: 'Неверный email или пароль' });
    };
    const { rows } = await db.query(
      `SELECT id, email, display_name, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || !user.password_hash) return refuse();
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return refuse();
    failedLogins.email.reset(email);
    await createSession(res, user.id, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// Смена пароля: вошедший, с текущим паролем; остальные сессии учётки закрываются.
// Неверный текущий пароль считается в тот же счёт неудач, что и вход.
router.post('/password', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Войдите, чтобы сменить пароль' });
    const email = String(req.user.email || '').toLowerCase();
    if (failedLogins.email.full(email)) {
      const wait = failedLogins.email.retryAfterSec(email);
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Слишком много неудачных попыток — попробуйте через ${Math.ceil(wait / 60)} мин.` });
    }
    const body = req.body || {};
    try {
      await accounts.changePassword(req.user.id, { current: body.current, next: body.password }, { keepSession: req.sessionId || null });
    } catch (err) {
      if (err.status === 401) failedLogins.email.hit(email);
      throw err;
    }
    res.json({ ok: true });
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
  const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//')
    ? req.query.returnTo
    : config.loginReturnPath;
  const url = googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state: returnTo,
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
    // почта без подтверждения Google — не почта: по ней не связываем учётки и не даём ролей по почте
    const email = (payload.email_verified !== false && (payload.email || '').toLowerCase()) || null;
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

    const state = req.query.state;
    const returnTo = typeof state === 'string' && state.startsWith('/') && !state.startsWith('//')
      ? state
      : config.loginReturnPath;
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
