const db = require('../db');
const config = require('../config');

async function getSubject(req) {
  if (req.user) {
    return { subjectType: 'user', subjectId: req.user.id, isGuest: false };
  }
  const guestId = req.guest ? req.guest.id : '00000000-0000-0000-0000-000000000000';
  return { subjectType: 'guest', subjectId: guestId, isGuest: true };
}

async function getQuotaRow(subjectType, subjectId) {
  const { rows } = await db.query(
    `INSERT INTO usage_quotas (subject_type, subject_id, day)
     VALUES ($1, $2, CURRENT_DATE)
     ON CONFLICT (subject_type, subject_id, day)
     DO UPDATE SET subject_id = EXCLUDED.subject_id
     RETURNING *`,
    [subjectType, subjectId]
  );
  return rows[0];
}

function uploadLimit(isGuest) {
  return isGuest ? config.guestUploadsPerDay : config.userUploadsPerDay;
}

function offerLimit(isGuest) {
  return isGuest ? config.guestOfferLimit : config.userOfferLimit;
}

async function assertCanUpload(req) {
  const { subjectType, subjectId, isGuest } = await getSubject(req);
  const row = await getQuotaRow(subjectType, subjectId);
  const limit = uploadLimit(isGuest);
  if (row.uploads_count >= limit) {
    const err = new Error(
      isGuest
        ? `Гостевой лимит: ${limit} загрузок в день. Войдите, чтобы продолжить.`
        : `Дневной лимит загрузок (${limit}) исчерпан.`
    );
    err.status = 429;
    throw err;
  }
  return { subjectType, subjectId, isGuest, row, limit };
}

async function incrementUpload(subjectType, subjectId) {
  await db.query(
    `UPDATE usage_quotas
     SET uploads_count = uploads_count + 1
     WHERE subject_type = $1 AND subject_id = $2 AND day = CURRENT_DATE`,
    [subjectType, subjectId]
  );
}

async function incrementSearch(subjectType, subjectId) {
  await db.query(
    `INSERT INTO usage_quotas (subject_type, subject_id, day, searches_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (subject_type, subject_id, day)
     DO UPDATE SET searches_count = usage_quotas.searches_count + 1`,
    [subjectType, subjectId]
  );
}

async function getUsage(req) {
  const { subjectType, subjectId, isGuest } = await getSubject(req);
  const row = await getQuotaRow(subjectType, subjectId);
  return {
    isGuest,
    uploadsUsed: row.uploads_count,
    uploadsLimit: uploadLimit(isGuest),
    offerLimit: offerLimit(isGuest),
  };
}

module.exports = {
  getSubject,
  assertCanUpload,
  incrementUpload,
  incrementSearch,
  getUsage,
  offerLimit,
};
