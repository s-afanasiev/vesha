// Учётки входа паролем (users + auth_identities): одна дверь для регистрации, учётки,
// которую заводит админ, стартового админа из .env и смены пароля. Регистрация почту
// не подтверждает, поэтому роль по почте даётся только учётке, которую завёл не
// посторонний: админу — из .env (ADMIN_PASSWORD) или через Google, сотруднику
// магазина — админом («Добавить сотрудника»: пароль показывают ему один раз).

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const COST = 12;
const MIN_PASSWORD = 8;
// без похожих знаков: 0/O, 1/l/I — пароль диктуют и переписывают руками
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function refusal(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Пароль, который выдаёт сайт: 3 группы по 4 знака (~70 бит), например «Kp7x-m3Qa-9Wte».
function generatePassword() {
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let part = '';
    for (let i = 0; i < 4; i++) part += ALPHABET[crypto.randomInt(ALPHABET.length)];
    groups.push(part);
  }
  return groups.join('-');
}

const normalize = (email) => String(email ?? '').trim().toLowerCase();

class Accounts {
  constructor(db) {
    this.db = db;
  }

  async tx(fn) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async byEmail(email) {
    const { rows } = await this.db.query('SELECT id, email, display_name FROM users WHERE email = $1', [normalize(email)]);
    return rows[0] || null;
  }

  // Новая учётка с паролем; почта занята — 409 (учётку не подменяем).
  async create({ email, password, displayName = null }) {
    const address = normalize(email);
    if (!address || !address.includes('@')) throw refusal('Укажите корректный email', 400);
    if (String(password || '').length < MIN_PASSWORD) throw refusal(`Пароль не короче ${MIN_PASSWORD} символов`, 400);
    const hash = await bcrypt.hash(String(password), COST);
    return this.tx(async (client) => {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING RETURNING id, email, display_name`,
        [address, displayName, hash]
      );
      if (!user) throw refusal('Email уже зарегистрирован', 409);
      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, meta) VALUES ($1, 'password', $2, '{}'::jsonb)`,
        [user.id, address]
      );
      return user;
    });
  }

  // Учётка, которую заводит админ: пароль выдаёт сайт, видит его только админ (один раз).
  async issue({ email, displayName = null }) {
    const password = generatePassword();
    const user = await this.create({ email, password, displayName });
    return { user, password };
  }

  // Стартовый админ: почте из ADMIN_EMAILS без учётки — учётка с паролем из .env.
  // Уже есть — не трогаем (пароль сменён в кабинете). Ответ — почты заведённых и
  // почты, которые остались без учётки (войти им — только через Google).
  async ensureAdmins(emails, password) {
    const created = [];
    const missing = [];
    for (const email of emails) {
      if (await this.byEmail(email)) continue;
      if (String(password || '').length < MIN_PASSWORD) { missing.push(email); continue; }
      try {
        await this.create({ email, password });
        created.push(email);
      } catch (err) {
        if (err.status !== 409) throw err; // завели параллельно — уже есть
      }
    }
    return { created, missing };
  }

  // Смена пароля вошедшим: прежний пароль (если он был) обязателен; остальные сессии
  // учётки закрываются — потерянный ноутбук или подсмотренный пароль больше не входят.
  async changePassword(userId, { current, next }, { keepSession = null } = {}) {
    if (String(next || '').length < MIN_PASSWORD) throw refusal(`Новый пароль не короче ${MIN_PASSWORD} символов`, 400);
    const { rows: [user] } = await this.db.query('SELECT id, email, password_hash FROM users WHERE id = $1', [userId]);
    if (!user) throw refusal('Войдите заново', 401);
    if (user.password_hash && !(await bcrypt.compare(String(current || ''), user.password_hash))) {
      throw refusal('Текущий пароль неверный', 401);
    }
    const hash = await bcrypt.hash(String(next), COST);
    await this.tx(async (client) => {
      await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, meta) VALUES ($1, 'password', $2, '{}'::jsonb)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [user.id, user.email]
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)', [user.id, keepSession]);
    });
    return { email: user.email };
  }
}

// При старте сервера (shop.js, main.js): админы из .env — с учёткой; что сделано — в лог.
async function bootAdmins(accounts, { adminEmails, adminPassword }, log = console) {
  const { created, missing } = await accounts.ensureAdmins(adminEmails, adminPassword);
  for (const email of created) log.log(`Админ ${email}: учётка заведена с паролем ADMIN_PASSWORD — войдите и смените пароль`);
  for (const email of missing) log.warn(`Админ ${email} без учётки: задайте ADMIN_PASSWORD (от ${MIN_PASSWORD} знаков) в .env или войдите через Google`);
  return { created, missing };
}

module.exports = { Accounts, bootAdmins, generatePassword, MIN_PASSWORD };
