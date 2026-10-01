// Доставка текста госактов (И4): в списке API pravo текста нет, он в PDF по /file/pdf.
// Сюжет «доставить текст» — отдельный батч за раз: берём только публикации без body,
// пауза между запросами — уважение к источнику. Ошибка одной доставки — не падение
// батча (П24): она помечается в meta.body_error и не повторяется бесконечно.
const db = require('../../db');
const config = require('../../config');
const { fetchActPdf, extractPdfText } = require('../collectors/adapters/pravo');

const PAUSE_MS = 500;
// Меньше сотни букв — перед нами скан без текстового слоя, а не акт.
const MIN_LETTERS = 100;

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Правило-вердикт (П14): извлечённый текст годится? Маркеры страниц pdf.js («-- 1 of 3 --»)
// текстом не считаются. У сканов он один, у настоящих актов — сотни букв.
function hasUsefulText(text) {
  const letters = (text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').match(/[\p{L}\p{N}]/gu) || []).length;
  return letters >= MIN_LETTERS;
}

async function deliverPendingActs({ limit = config.ideaRadarGovTextsBatch } = {}) {
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.external_id
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE s.adapter = 'pravo' AND p.body IS NULL AND p.meta->>'body_error' IS NULL
     ORDER BY p.published_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  let delivered = 0;
  let failed = 0;
  const failures = [];
  for (const [index, row] of rows.entries()) {
    if (index > 0) await pause(PAUSE_MS);
    try {
      const pdf = await fetchActPdf(row.external_id, {
        pageTimeoutMs: config.ideaRadarPageTimeoutMs,
        maxBytes: config.ideaRadarMaxBytes,
      });
      const text = (await extractPdfText(pdf)).replace(/--\s*\d+\s+of\s+\d+\s*--/g, '\n').trim();
      if (!hasUsefulText(text)) throw new Error('PDF без текстового слоя (скан)');
      await db.query('UPDATE idea_radar_publications SET body = $2 WHERE id = $1', [row.id, text]);
      delivered += 1;
    } catch (err) {
      failed += 1;
      failures.push({ title: row.title, error: err.message });
      // Пометка в meta: повторять бессмысленно; смена решения (OCR) снимет флаг.
      await db.query(
        `UPDATE idea_radar_publications
         SET meta = jsonb_set(meta, '{body_error}', to_jsonb($2::text))
         WHERE id = $1`,
        [row.id, String(err.message).slice(0, 200)]
      );
    }
  }

  const { rows: left } = await db.query(
    `SELECT count(*)::int AS remaining
     FROM idea_radar_publications p
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE s.adapter = 'pravo' AND p.body IS NULL AND p.meta->>'body_error' IS NULL`
  );

  return {
    requested: rows.length,
    delivered,
    failed,
    remaining: left[0].remaining,
    failures: failures.slice(0, 3),
  };
}

module.exports = {
  deliverPendingActs,
  hasUsefulText,
};
