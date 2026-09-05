const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { jobDir, readMeta } = require('./extractAudio');

let tableReady = false;
let tablePromise = null;

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function inferKind(meta) {
  if (meta.historyKind === 'url' || meta.historyKind === 'file' || meta.historyKind === 'mic') {
    return meta.historyKind;
  }
  if (meta.kind === 'url' || meta.url) return 'url';
  if (meta.kind === 'mic' || /^mic_record/i.test(meta.sourceTitle || meta.title || '')) return 'mic';
  return 'file';
}

function summaryBits(summary) {
  if (!summary || typeof summary !== 'object') {
    return { has_summary: false, summary_title: null, language: null };
  }
  return {
    has_summary: true,
    summary_title: summary.title || null,
    language: summary.language || null,
  };
}

function idsMatch(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function ownerFromReq(req) {
  return {
    userId: req && req.user && req.user.id ? req.user.id : null,
    guestId: req && req.guest && req.guest.id ? req.guest.id : null,
  };
}

function publicRow(row) {
  if (!row) return null;
  const dir = jobDir(row.id);
  const audioFile = row.audio_file ? path.join(dir, row.audio_file) : null;
  const hasFiles = fs.existsSync(dir);
  const audioExists = Boolean(audioFile && fs.existsSync(audioFile));
  return {
    id: row.id,
    kind: row.kind,
    sourceUrl: row.source_url,
    sourceHost: row.source_host,
    sourceTitle: row.source_title,
    sourceBytes: row.source_bytes != null ? Number(row.source_bytes) : null,
    audioOnly: row.audio_only,
    status: row.status,
    phase: row.phase,
    durationSec: row.duration_sec,
    audioBytes: row.audio_bytes != null ? Number(row.audio_bytes) : null,
    hasAudio: row.has_audio && audioExists,
    hasSummary: row.has_summary,
    summaryTitle: row.summary_title,
    language: row.language,
    provider: row.provider,
    model: row.model,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    elapsedMs:
      row.started_at && row.completed_at
        ? new Date(row.completed_at) - new Date(row.started_at)
        : null,
    hasFiles,
    audioUrl: audioExists ? `/api/summarize/jobs/${row.id}/audio` : null,
  };
}

function publicFromMeta(meta) {
  if (!meta || !meta.id) return null;
  const bits = summaryBits(meta.summary);
  const terminal =
    meta.status === 'ready' ||
    meta.status === 'audio_ready' ||
    meta.status === 'transcript_ready' ||
    meta.status === 'failed';
  return publicRow({
    id: meta.id,
    kind: inferKind(meta),
    source_url: meta.url || null,
    source_host: hostFromUrl(meta.url),
    source_title: meta.title || meta.sourceTitle || null,
    source_bytes: Number.isFinite(meta.sourceBytes) ? meta.sourceBytes : null,
    audio_only: Boolean(meta.audioOnly),
    status: meta.status || 'queued',
    phase: meta.phase || null,
    duration_sec: Number.isFinite(meta.duration) ? meta.duration : null,
    audio_bytes: Number.isFinite(meta.bytes) ? meta.bytes : null,
    audio_file: meta.audioFile || null,
    has_audio: Boolean(meta.audioFile),
    has_summary: bits.has_summary,
    summary_title: bits.summary_title,
    language: bits.language,
    provider: meta.provider || null,
    model: meta.model || null,
    error: meta.error || null,
    created_at: meta.createdAt || null,
    started_at: meta.startedAt || null,
    completed_at: terminal ? meta.completedAt || meta.createdAt : meta.completedAt || null,
  });
}

function readAllMetas() {
  const root = config.summarizeDir;
  if (!root || !fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (name === 'temp' || name.startsWith('.')) continue;
    const meta = readMeta(name);
    if (meta && meta.id) out.push(meta);
  }
  return out;
}

function metaOwnedBy(meta, owner) {
  if (!meta || !owner) return false;
  if (owner.userId && idsMatch(meta.userId, owner.userId)) return true;
  if (owner.guestId && idsMatch(meta.guestId, owner.guestId)) return true;
  return false;
}

function isOrphanMeta(meta) {
  return !meta.userId && !meta.guestId;
}

async function ensureSummarizeJobsTable() {
  if (tableReady) return true;
  if (!tablePromise) {
    tablePromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS summarize_jobs (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
          kind TEXT NOT NULL DEFAULT 'url'
            CHECK (kind IN ('url', 'file', 'mic')),
          source_url TEXT,
          source_host TEXT,
          source_title TEXT,
          source_bytes BIGINT,
          audio_only BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'queued',
          phase TEXT,
          duration_sec DOUBLE PRECISION,
          audio_bytes BIGINT,
          audio_file TEXT,
          has_audio BOOLEAN NOT NULL DEFAULT false,
          has_summary BOOLEAN NOT NULL DEFAULT false,
          summary_title TEXT,
          language TEXT,
          provider TEXT,
          model TEXT,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await db.query(
        'ALTER TABLE summarize_jobs ADD COLUMN IF NOT EXISTS source_bytes BIGINT'
      );
      await db.query(`
        CREATE INDEX IF NOT EXISTS summarize_jobs_user_created_idx
          ON summarize_jobs (user_id, created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS summarize_jobs_guest_created_idx
          ON summarize_jobs (guest_id, created_at DESC)
      `);
      tableReady = true;
      return true;
    })().catch((err) => {
      tablePromise = null;
      throw err;
    });
  }
  return tablePromise;
}

async function upsertFromMeta(meta, owner = {}) {
  if (!meta || !meta.id) return;
  const bits = summaryBits(meta.summary);
  const userId = owner.userId || meta.userId || null;
  const guestId = owner.guestId || meta.guestId || null;
  const startedAt =
    meta.startedAt ||
    (meta.status && meta.status !== 'queued' ? meta.createdAt : null);
  const terminal =
    meta.status === 'ready' ||
    meta.status === 'audio_ready' ||
    meta.status === 'transcript_ready' ||
    meta.status === 'failed';
  const completedAt = terminal
    ? meta.completedAt || new Date().toISOString()
    : null;
  const sourceBytes = Number.isFinite(meta.sourceBytes) ? meta.sourceBytes : null;

  try {
    await ensureSummarizeJobsTable();
    await db.query(
      `INSERT INTO summarize_jobs (
         id, user_id, guest_id, kind, source_url, source_host, source_title, source_bytes,
         audio_only, status, phase, duration_sec, audio_bytes, audio_file,
         has_audio, has_summary, summary_title, language, provider, model, error,
         created_at, started_at, completed_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21,
         COALESCE($22::timestamptz, now()), $23, $24, now()
       )
       ON CONFLICT (id) DO UPDATE SET
         user_id = COALESCE(summarize_jobs.user_id, EXCLUDED.user_id),
         guest_id = COALESCE(summarize_jobs.guest_id, EXCLUDED.guest_id),
         kind = EXCLUDED.kind,
         source_url = COALESCE(EXCLUDED.source_url, summarize_jobs.source_url),
         source_host = COALESCE(EXCLUDED.source_host, summarize_jobs.source_host),
         source_title = COALESCE(EXCLUDED.source_title, summarize_jobs.source_title),
         source_bytes = COALESCE(EXCLUDED.source_bytes, summarize_jobs.source_bytes),
         audio_only = EXCLUDED.audio_only,
         status = EXCLUDED.status,
         phase = EXCLUDED.phase,
         duration_sec = COALESCE(EXCLUDED.duration_sec, summarize_jobs.duration_sec),
         audio_bytes = COALESCE(EXCLUDED.audio_bytes, summarize_jobs.audio_bytes),
         audio_file = COALESCE(EXCLUDED.audio_file, summarize_jobs.audio_file),
         has_audio = EXCLUDED.has_audio OR summarize_jobs.has_audio,
         has_summary = EXCLUDED.has_summary OR summarize_jobs.has_summary,
         summary_title = COALESCE(EXCLUDED.summary_title, summarize_jobs.summary_title),
         language = COALESCE(EXCLUDED.language, summarize_jobs.language),
         provider = COALESCE(EXCLUDED.provider, summarize_jobs.provider),
         model = COALESCE(EXCLUDED.model, summarize_jobs.model),
         error = EXCLUDED.error,
         started_at = COALESCE(summarize_jobs.started_at, EXCLUDED.started_at),
         completed_at = CASE
           WHEN EXCLUDED.status IN ('ready', 'audio_ready', 'transcript_ready', 'failed')
             THEN COALESCE(EXCLUDED.completed_at, now())
           WHEN EXCLUDED.status IN ('queued', 'running') THEN NULL
           ELSE summarize_jobs.completed_at
         END,
         updated_at = now()`,
      [
        meta.id,
        userId,
        guestId,
        inferKind(meta),
        meta.url || null,
        hostFromUrl(meta.url),
        meta.title || meta.sourceTitle || null,
        sourceBytes,
        Boolean(meta.audioOnly),
        meta.status || 'queued',
        meta.phase || null,
        Number.isFinite(meta.duration) ? meta.duration : null,
        Number.isFinite(meta.bytes) ? meta.bytes : null,
        meta.audioFile || null,
        Boolean(meta.audioFile),
        bits.has_summary,
        bits.summary_title,
        bits.language,
        meta.provider || null,
        meta.model || null,
        meta.error || null,
        meta.createdAt || null,
        startedAt,
        completedAt,
      ]
    );
  } catch (err) {
    console.error('summarize history upsert skipped:', err.message);
  }
}

function touchHistory(id, owner) {
  const meta = readMeta(id);
  if (!meta) return;
  upsertFromMeta(meta, owner).catch((err) => {
    console.error('summarize history touch failed:', err.message);
  });
}

function mergeItems(dbItems, diskItems, limit) {
  const map = new Map();
  for (const item of diskItems) {
    if (item && item.id) map.set(String(item.id), item);
  }
  for (const item of dbItems) {
    if (item && item.id) map.set(String(item.id), item);
  }
  return [...map.values()]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

async function listForOwner(owner, { limit = 40 } = {}) {
  const warnings = [];
  const allMetas = readAllMetas();
  const hasOwner = Boolean(owner && (owner.userId || owner.guestId));
  const ownedMetas = hasOwner ? allMetas.filter((m) => metaOwnedBy(m, owner)) : [];

  try {
    await ensureSummarizeJobsTable();
    for (const meta of ownedMetas) {
      await upsertFromMeta(meta, owner);
    }
  } catch (err) {
    warnings.push('Таблица истории в Postgres недоступна: ' + err.message);
  }

  let dbItems = [];
  if (hasOwner) {
    try {
      const { rows } = owner.userId
        ? await db.query(
            `SELECT * FROM summarize_jobs
             WHERE user_id = $1
                OR (guest_id = $2 AND user_id IS NULL)
             ORDER BY created_at DESC
             LIMIT $3`,
            [owner.userId, owner.guestId || null, limit]
          )
        : await db.query(
            `SELECT * FROM summarize_jobs
             WHERE guest_id = $1 AND user_id IS NULL
             ORDER BY created_at DESC
             LIMIT $2`,
            [owner.guestId, limit]
          );
      dbItems = rows.map(publicRow);
    } catch (err) {
      warnings.push('Чтение summarize_jobs не удалось: ' + err.message);
    }
  } else {
    warnings.push(
      'Нет сессии гостя (Postgres или cookie). Показаны задания с диска этого сервера.'
    );
  }

  let diskSource = ownedMetas;
  if (!diskSource.length && allMetas.length) {
    if (!hasOwner) {
      diskSource = allMetas;
      warnings.push('История взята с диска, не из Postgres.');
    } else {
      const orphans = allMetas.filter(isOrphanMeta);
      if (orphans.length) {
        diskSource = orphans;
        warnings.push(
          'В БД пусто для этого браузера — показаны задания с диска без привязки к гостю.'
        );
      }
    }
  }

  const items = mergeItems(dbItems, diskSource.map(publicFromMeta).filter(Boolean), limit);
  return {
    items,
    warning: warnings[0] || null,
  };
}

module.exports = {
  ownerFromReq,
  upsertFromMeta,
  touchHistory,
  listForOwner,
  ensureSummarizeJobsTable,
};
