const path = require('path');
const db = require('../db');
const { extractClothing } = require('./vision');
const { runSearch } = require('./search');
const config = require('../config');

async function processLook(lookId) {
  await db.query(
    `UPDATE looks SET status = 'analyzing', updated_at = now(), error = NULL WHERE id = $1`,
    [lookId]
  );

  try {
    const { rows: images } = await db.query(
      `SELECT * FROM look_images WHERE look_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [lookId]
    );
    const image = images[0];
    if (!image) throw new Error('Нет изображения у look');

    const absPath = path.isAbsolute(image.storage_path)
      ? image.storage_path
      : path.join(config.uploadDir, path.basename(image.storage_path));

    let extraction;
    try {
      extraction = await extractClothing(absPath, image.mime);
    } catch (err) {
      if (!config.geminiApiKey && !config.openaiApiKey) {
        extraction = {
          provider: 'mock',
          model: 'mock',
          raw_response: { mock: true },
          attributes: {
            category: 'футболка',
            colors: ['неизвестно'],
            pattern: 'неясно',
            material: null,
            brand: null,
            gender: 'неясно',
            style: 'повседневный',
            key_features: [],
            title_ru: 'Одежда (demo без vision-ключа)',
            search_queries: ['купить футболку'],
          },
          search_queries: ['купить футболку'],
        };
      } else {
        throw err;
      }
    }

    const queries =
      extraction.search_queries && extraction.search_queries.length
        ? extraction.search_queries
        : ['купить одежду'];

    await db.query(
      `INSERT INTO ai_extractions (look_id, provider, model, raw_response, attributes, search_queries)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        lookId,
        extraction.provider,
        extraction.model,
        JSON.stringify(extraction.raw_response || {}),
        JSON.stringify(extraction.attributes || {}),
        queries,
      ]
    );

    const title =
      extraction.attributes?.title_ru ||
      extraction.attributes?.category ||
      'Подборка';
    await db.query(
      `UPDATE looks SET title = $1, updated_at = now() WHERE id = $2`,
      [title, lookId]
    );

    const { jobs, offers } = await runSearch(queries);

    let firstJobId = null;
    for (const job of jobs) {
      const inserted = await db.query(
        `INSERT INTO search_jobs (look_id, provider, query, status, raw_response, error, finished_at)
         VALUES ($1, 'serpapi_yandex', $2, $3, $4::jsonb, $5, now())
         RETURNING id`,
        [
          lookId,
          job.query,
          job.status,
          job.raw_response ? JSON.stringify(job.raw_response) : null,
          job.error,
        ]
      );
      if (!firstJobId) firstJobId = inserted.rows[0].id;
    }

    for (const o of offers) {
      await db.query(
        `INSERT INTO offers
          (look_id, search_job_id, shop, title, url, price_cents, currency, thumbnail_url, snippet, score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          lookId,
          firstJobId,
          o.shop,
          o.title,
          o.url,
          o.price_cents,
          o.currency || 'RUB',
          o.thumbnail_url,
          o.snippet,
          o.score || 0,
        ]
      );
    }

    await db.query(
      `UPDATE looks SET status = 'ready', updated_at = now() WHERE id = $1`,
      [lookId]
    );
  } catch (err) {
    await db.query(
      `UPDATE looks SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [lookId, err.message || 'Ошибка обработки']
    );
    throw err;
  }
}

module.exports = { processLook };
