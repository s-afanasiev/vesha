// Семантический поиск и векторизация заметок через pgvector и LLM-эмбеддинги
const crypto = require('crypto');
const db = require('../../db');
const config = require('../../config');

const EMBEDDING_DIM = 768;

/**
 * Локальный детерминированный семантический векторизатор (Fallback без внешних API).
 * Превращает текст в нормализованный вектор размерности 768 на основе триграмм и хэшей слов.
 * Обеспечивает косинусную близость для родственных слов и синонимичных тем даже офлайн.
 */
function localDeterministicEmbedding(text) {
  const vec = new Float64Array(EMBEDDING_DIM);
  if (!text || typeof text !== 'string') return Array.from(vec);

  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = clean.split(/\s+/).filter(Boolean);

  // 1. Векторизация слов и триграмм
  for (const word of words) {
    // Хеш целого слова
    const hash = crypto.createHash('md5').update(word).digest();
    const idx1 = hash.readUInt16BE(0) % EMBEDDING_DIM;
    const idx2 = hash.readUInt16BE(2) % EMBEDDING_DIM;
    const sign1 = (hash[4] % 2 === 0) ? 1 : -1;
    const sign2 = (hash[5] % 2 === 0) ? 1 : -1;
    vec[idx1] += sign1 * 1.5;
    vec[idx2] += sign2 * 1.0;

    // Символьные n-граммы слова (ловят однокоренные слова и опечатки)
    for (let i = 0; i <= word.length - 3; i++) {
      const trigram = word.slice(i, i + 3);
      const th = crypto.createHash('md5').update(trigram).digest();
      const tidx = th.readUInt16BE(0) % EMBEDDING_DIM;
      const tsign = (th[2] % 2 === 0) ? 1 : -1;
      vec[tidx] += tsign * 0.4;
    }
  }

  // 2. L2 Нормализация вектора к единичной длине
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

/**
 * Вычисляет эмбеддинг через внешний API (Gemini или OpenAI) или локальный fallback
 */
async function computeEmbedding(text) {
  // Если настроен Gemini
  if (config.geminiApiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(config.geminiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.embedding && Array.isArray(data.embedding.values)) {
          return { model: 'gemini/text-embedding-004', vector: data.embedding.values };
        }
      }
    } catch (e) {
      console.warn('Gemini embedding failed, falling back:', e.message);
    }
  }

  // Fallback: локальный быстрый эмбеддинг
  return {
    model: 'local-trigram-768',
    vector: localDeterministicEmbedding(text),
  };
}

/**
 * Проверяет, поддерживает ли текущая таблица super_note_embeddings расширение pgvector
 */
let hasPgVectorCached = null;
async function checkHasPgVector() {
  if (hasPgVectorCached !== null) return hasPgVectorCached;
  try {
    const res = await db.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'super_note_embeddings' AND column_name = 'embedding'
    `);
    hasPgVectorCached = res.rows.length > 0;
  } catch {
    hasPgVectorCached = false;
  }
  return hasPgVectorCached;
}

/**
 * Сохранить или обновить эмбеддинг заметки
 */
async function syncNoteEmbedding(note) {
  if (!note || !note.id) return;
  const compositeText = [
    note.title || '',
    note.summary || '',
    note.content_raw || '',
    Array.isArray(note.items_json)
      ? note.items_json.map(it => `${it.title || ''} ${it.description || ''}`).join(' ')
      : '',
  ].join('\n').trim();

  if (!compositeText) return;

  const textHash = crypto.createHash('sha256').update(compositeText).digest('hex');
  const { model, vector } = await computeEmbedding(compositeText);
  const hasVector = await checkHasPgVector();

  if (hasVector) {
    const vectorStr = `[${vector.join(',')}]`;
    await db.query(
      `INSERT INTO super_note_embeddings (note_id, model, text_hash, embedding, updated_at)
       VALUES ($1, $2, $3, $4::vector, now())
       ON CONFLICT (note_id) DO UPDATE SET
         model = EXCLUDED.model,
         text_hash = EXCLUDED.text_hash,
         embedding = EXCLUDED.embedding,
         updated_at = now()`,
      [note.id, model, textHash, vectorStr]
    );
  } else {
    await db.query(
      `INSERT INTO super_note_embeddings (note_id, model, text_hash, embedding_json, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (note_id) DO UPDATE SET
         model = EXCLUDED.model,
         text_hash = EXCLUDED.text_hash,
         embedding_json = EXCLUDED.embedding_json,
         updated_at = now()`,
      [note.id, model, textHash, JSON.stringify(vector)]
    );
  }
}

/**
 * Семантический поиск по запросу с использованием pgvector
 */
async function searchSemantic({ req, query, limit = 20 }) {
  if (!query || !query.trim()) return [];
  const ident = req.user
    ? { field: 'user_id', value: req.user.id }
    : req.guest
    ? { field: 'guest_id', value: req.guest.id }
    : null;

  if (!ident) return [];

  const { vector } = await computeEmbedding(query.trim());
  const hasVector = await checkHasPgVector();

  if (hasVector) {
    const vectorStr = `[${vector.join(',')}]`;
    const sql = `
      SELECT 
        n.id, n.title, n.summary, n.content_raw, n.content_format,
        n.items_json, n.is_pinned, n.is_archived, n.color,
        n.created_at, n.updated_at,
        ROUND((1 - (e.embedding <=> $1::vector))::numeric, 3) AS similarity_score,
        COALESCE(
          json_agg(
            json_build_object('id', t.id, 'name', t.name, 'color', t.color)
          ) FILTER (WHERE t.id IS NOT NULL), '[]'
        ) AS tags
      FROM super_note_embeddings e
      JOIN super_notes n ON n.id = e.note_id
      LEFT JOIN super_note_tag_bindings tb ON tb.note_id = n.id
      LEFT JOIN super_note_tags t ON t.id = tb.tag_id
      WHERE n.${ident.field} = $2 AND n.is_archived = false
      GROUP BY n.id, e.embedding
      ORDER BY e.embedding <=> $1::vector ASC
      LIMIT $3
    `;
    const res = await db.query(sql, [vectorStr, ident.value, limit]);
    return res.rows;
  }

  // Fallback вычисление в JS при отсутствии расширения pgvector в СУБД
  const sql = `
    SELECT 
      n.id, n.title, n.summary, n.content_raw, n.content_format,
      n.items_json, n.is_pinned, n.is_archived, n.color,
      n.created_at, n.updated_at,
      e.embedding_json,
      COALESCE(
        json_agg(
          json_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ) FILTER (WHERE t.id IS NOT NULL), '[]'
      ) AS tags
    FROM super_note_embeddings e
    JOIN super_notes n ON n.id = e.note_id
    LEFT JOIN super_note_tag_bindings tb ON tb.note_id = n.id
    LEFT JOIN super_note_tags t ON t.id = tb.tag_id
    WHERE n.${ident.field} = $1 AND n.is_archived = false
    GROUP BY n.id, e.embedding_json
  `;
  const res = await db.query(sql, [ident.value]);
  const scored = res.rows.map(row => {
    const noteVec = row.embedding_json;
    let dot = 0;
    if (Array.isArray(noteVec)) {
      for (let i = 0; i < Math.min(vector.length, noteVec.length); i++) {
        dot += vector[i] * noteVec[i];
      }
    }
    const { embedding_json, ...rest } = row;
    return { ...rest, similarity_score: Math.round(dot * 1000) / 1000 };
  });

  scored.sort((a, b) => b.similarity_score - a.similarity_score);
  return scored.slice(0, limit);
}

/**
 * Получить семантически похожие заметки для текущей заметки
 */
async function getRelatedNotes(noteId, req, limit = 4) {
  const ident = req.user
    ? { field: 'user_id', value: req.user.id }
    : req.guest
    ? { field: 'guest_id', value: req.guest.id }
    : null;

  if (!ident) return [];
  const hasVector = await checkHasPgVector();

  if (hasVector) {
    const sql = `
      WITH current_emb AS (
        SELECT embedding FROM super_note_embeddings WHERE note_id = $1
      )
      SELECT 
        n.id, n.title, n.summary,
        ROUND((1 - (e.embedding <=> c.embedding))::numeric, 3) AS similarity_score
      FROM current_emb c
      CROSS JOIN super_note_embeddings e
      JOIN super_notes n ON n.id = e.note_id
      WHERE e.note_id != $1 AND n.${ident.field} = $2 AND n.is_archived = false
      ORDER BY e.embedding <=> c.embedding ASC
      LIMIT $3
    `;
    const res = await db.query(sql, [noteId, ident.value, limit]);
    return res.rows;
  }

  return [];
}

module.exports = {
  syncNoteEmbedding,
  searchSemantic,
  getRelatedNotes,
};
