const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

function query(text, params) {
  return pool.query(text, params);
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, '..', 'db', 'migrations');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE id = $1',
      [file]
    );
    if (rows.length) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('Applied migration', file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  pool,
  query,
  withClient,
  migrate,
};
