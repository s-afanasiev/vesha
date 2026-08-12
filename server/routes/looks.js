const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const db = require('../db');
const config = require('../config');
const quota = require('../services/quota');
const { processLook } = require('../services/pipeline');
const {
  hashFile,
  findExistingLookByHash,
} = require('../services/imageHash');

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Нужен файл изображения'));
    }
    cb(null, true);
  },
});

function canAccessLook(look, req) {
  if (req.user && look.user_id === req.user.id) return true;
  if (look.guest_id && req.guest && look.guest_id === req.guest.id) return true;
  return false;
}

async function getLookBundle(lookId, offerLimit) {
  const lookRes = await db.query(`SELECT * FROM looks WHERE id = $1`, [lookId]);
  const look = lookRes.rows[0];
  if (!look) return null;

  const images = await db.query(
    `SELECT id, mime, bytes, created_at FROM look_images WHERE look_id = $1`,
    [lookId]
  );
  const extraction = await db.query(
    `SELECT provider, model, attributes, search_queries, created_at
     FROM ai_extractions WHERE look_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [lookId]
  );
  const offers = await db.query(
    `SELECT id, shop, title, url, price_cents, currency, thumbnail_url, snippet, score
     FROM offers WHERE look_id = $1
     ORDER BY score DESC NULLS LAST, created_at ASC
     LIMIT $2`,
    [lookId, offerLimit]
  );
  const searchJobs = await db.query(
    `SELECT id, provider, query, status, error, created_at, finished_at
     FROM search_jobs WHERE look_id = $1
     ORDER BY created_at ASC`,
    [lookId]
  );

  const extractionRow = extraction.rows[0] || null;

  return {
    look: {
      id: look.id,
      status: look.status,
      title: look.title,
      error: look.error,
      createdAt: look.created_at,
      updatedAt: look.updated_at,
    },
    images: images.rows,
    extraction: extractionRow,
    searchQueries:
      (extractionRow && extractionRow.search_queries) ||
      searchJobs.rows.map((j) => j.query),
    searchJobs: searchJobs.rows.map((j) => ({
      id: j.id,
      provider: j.provider,
      query: j.query,
      status: j.status,
      error: j.error,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
    })),
    offers: offers.rows.map((o) => ({
      id: o.id,
      shop: o.shop,
      title: o.title,
      url: o.url,
      priceCents: o.price_cents,
      currency: o.currency,
      thumbnailUrl: o.thumbnail_url,
      snippet: o.snippet,
      score: o.score,
    })),
  };
}

/** History of looks for current user or guest (one card per unique image hash). */
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 24));
    const ownerClause = req.user
      ? 'l.user_id = $1'
      : req.guest
        ? 'l.guest_id = $1'
        : null;
    if (!ownerClause) return res.json({ looks: [] });

    const ownerId = req.user ? req.user.id : req.guest.id;
    const { rows } = await db.query(
      `SELECT DISTINCT ON (COALESCE(li.content_hash, l.id::text))
          l.id, l.title, l.status, l.created_at, l.updated_at,
          (SELECT count(*)::int FROM offers o WHERE o.look_id = l.id) AS offers_count
       FROM looks l
       LEFT JOIN look_images li ON li.look_id = l.id
       WHERE ${ownerClause}
       ORDER BY COALESCE(li.content_hash, l.id::text), l.created_at DESC
       LIMIT $2`,
      [ownerId, limit]
    );

    // Re-sort by recency for carousel (DISTINCT ON forces hash-first order)
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      looks: rows.map((l) => ({
        id: l.id,
        title: l.title || 'Без названия',
        status: l.status,
        offersCount: l.offers_count,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
        imageUrl: `/api/looks/${l.id}/image`,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Прикрепите изображение (поле image)' });
    }

    const gate = await quota.assertCanUpload(req);
    const userId = req.user ? req.user.id : null;
    const guestId = req.user ? null : req.guest.id;
    const absPath = path.join(config.uploadDir, req.file.filename);
    const contentHash = hashFile(absPath);

    const existing = await findExistingLookByHash({
      userId,
      guestId,
      contentHash,
    });
    if (existing) {
      // Drop freshly uploaded duplicate file
      try {
        fs.unlinkSync(absPath);
      } catch (_) {
        // ignore
      }
      const limit = quota.offerLimit(gate.isGuest);
      const bundle = await getLookBundle(existing.id, limit);
      return res.status(200).json({ ...bundle, deduplicated: true });
    }

    const lookIns = await db.query(
      `INSERT INTO looks (user_id, guest_id, status)
       VALUES ($1, $2, 'uploaded')
       RETURNING *`,
      [userId, guestId]
    );
    const look = lookIns.rows[0];

    await db.query(
      `INSERT INTO look_images (look_id, storage_path, mime, bytes, content_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [look.id, req.file.filename, req.file.mimetype, req.file.size, contentHash]
    );

    await quota.incrementUpload(gate.subjectType, gate.subjectId);
    await quota.incrementSearch(gate.subjectType, gate.subjectId);

    // Fire-and-await for MVP simplicity (sync response after pipeline)
    try {
      await processLook(look.id);
    } catch (err) {
      console.error('processLook failed', look.id, err.message);
    }

    const limit = quota.offerLimit(gate.isGuest);
    const bundle = await getLookBundle(look.id, limit);
    res.status(201).json(bundle);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM looks WHERE id = $1`, [req.params.id]);
    const look = rows[0];
    if (!look) return res.status(404).json({ error: 'Не найдено' });
    if (!canAccessLook(look, req)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const usage = await quota.getUsage(req);
    const bundle = await getLookBundle(look.id, usage.offerLimit);
    res.json(bundle);
  } catch (err) {
    next(err);
  }
});

/** Re-run vision + search for an existing look (same image file). */
router.post('/:id/reprocess', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM looks WHERE id = $1`, [req.params.id]);
    const look = rows[0];
    if (!look) return res.status(404).json({ error: 'Не найдено' });
    if (!canAccessLook(look, req)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const subject = await quota.getSubject(req);
    await quota.incrementSearch(subject.subjectType, subject.subjectId);

    try {
      await processLook(look.id, { clearPrevious: true });
    } catch (err) {
      console.error('reprocess failed', look.id, err.message);
    }

    const usage = await quota.getUsage(req);
    const bundle = await getLookBundle(look.id, usage.offerLimit);
    res.json({ ...bundle, reprocessed: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/image', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM looks WHERE id = $1`, [req.params.id]);
    const look = rows[0];
    if (!look) return res.status(404).json({ error: 'Не найдено' });
    if (!canAccessLook(look, req)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const imgs = await db.query(
      `SELECT * FROM look_images WHERE look_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [look.id]
    );
    const image = imgs.rows[0];
    if (!image) return res.status(404).json({ error: 'Нет изображения' });
    const abs = path.join(config.uploadDir, path.basename(image.storage_path));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Файл отсутствует' });
    res.type(image.mime);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
