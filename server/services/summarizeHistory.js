const fs = require('fs');
const path = require('path');
const db = require('../db');
const { jobDir, readMeta } = require('./extractAudio');

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

async function upsertFromMeta(meta, owner = {}) {
  if (!meta || !meta.id) return;
  const bits = summaryBits(meta.summary);
  const userId = owner.userId || meta.userId || null;
  const guestId = owner.guestId || meta.guestId || null;
  const startedAt =
    meta.startedAt ||
    (meta.status && meta.status !== 'queued' ? meta.createdAt : null);
  const terminal =
    meta.status === 'ready' || meta.status === 'audio_ready' || meta.status === 'failed';
  const completedAt = terminal
    ? meta.completedAt || new Date().toISOString()
    : null;
  const sourceBytes = Number.isFinite(meta.sourceBytes) ? meta.sourceBytes : null;

  try {
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
           WHEN EXCLUDED.status IN ('ready', 'audio_ready', 'failed')
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
    console.warn('summarize history upsert skipped:', err.message);
  }
}

function touchHistory(id, owner) {
  const meta = readMeta(id);
  if (!meta) return;
  upsertFromMeta(meta, owner).catch((err) => {
    console.warn('summarize history touch failed:', err.message);
  });
}

async function listForOwner(owner, { limit = 40 } = {}) {
  if (!owner || (!owner.userId && !owner.guestId)) return [];
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
  return rows.map(publicRow);
}

module.exports = {
  ownerFromReq,
  upsertFromMeta,
  touchHistory,
  listForOwner,
};
