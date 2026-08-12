const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const config = require('../config');

function hashFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function resolveImagePath(storagePath) {
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.join(config.uploadDir, path.basename(storagePath));
}

/** Fill content_hash for rows that still lack it. */
async function backfillImageHashes() {
  const { rows } = await db.query(
    `SELECT id, storage_path FROM look_images WHERE content_hash IS NULL`
  );
  let n = 0;
  for (const row of rows) {
    const abs = resolveImagePath(row.storage_path);
    if (!fs.existsSync(abs)) continue;
    try {
      const hash = hashFile(abs);
      await db.query(`UPDATE look_images SET content_hash = $1 WHERE id = $2`, [
        hash,
        row.id,
      ]);
      n += 1;
    } catch (_) {
      // skip unreadable files
    }
  }
  return n;
}

/**
 * Keep newest look per (owner, content_hash); delete older duplicates.
 * Owner = user_id or guest_id.
 */
async function cleanupDuplicateLooks() {
  const { rows } = await db.query(`
    WITH ranked AS (
      SELECT
        l.id,
        ROW_NUMBER() OVER (
          PARTITION BY
            COALESCE(l.user_id::text, ''),
            COALESCE(l.guest_id::text, ''),
            li.content_hash
          ORDER BY l.created_at DESC
        ) AS rn
      FROM looks l
      JOIN look_images li ON li.look_id = l.id
      WHERE li.content_hash IS NOT NULL
    )
    SELECT id FROM ranked WHERE rn > 1
  `);

  if (!rows.length) return 0;

  const ids = rows.map((r) => r.id);
  // Remove orphan files for deleted looks' images
  const imgs = await db.query(
    `SELECT storage_path FROM look_images WHERE look_id = ANY($1::uuid[])`,
    [ids]
  );

  await db.query(`DELETE FROM looks WHERE id = ANY($1::uuid[])`, [ids]);

  for (const img of imgs.rows) {
    const abs = resolveImagePath(img.storage_path);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (_) {
      // ignore
    }
  }
  return ids.length;
}

async function findExistingLookByHash({ userId, guestId, contentHash }) {
  if (!contentHash) return null;
  if (userId) {
    const { rows } = await db.query(
      `SELECT l.*
       FROM looks l
       JOIN look_images li ON li.look_id = l.id
       WHERE l.user_id = $1 AND li.content_hash = $2
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [userId, contentHash]
    );
    return rows[0] || null;
  }
  if (guestId) {
    const { rows } = await db.query(
      `SELECT l.*
       FROM looks l
       JOIN look_images li ON li.look_id = l.id
       WHERE l.guest_id = $1 AND li.content_hash = $2
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [guestId, contentHash]
    );
    return rows[0] || null;
  }
  return null;
}

module.exports = {
  hashFile,
  resolveImagePath,
  backfillImageHashes,
  cleanupDuplicateLooks,
  findExistingLookByHash,
};
