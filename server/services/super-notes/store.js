// Хранилище заметок, тегов и иерархических структур в PostgreSQL
const db = require('../../db');
const { parseTags, parseHierarchicalItems } = require('./parser');

function getIdentity(req) {
  if (req.user && req.user.id) {
    return { field: 'user_id', value: req.user.id, isUser: true };
  }
  if (req.guest && req.guest.id) {
    return { field: 'guest_id', value: req.guest.id, isUser: false };
  }
  return null;
}

/**
 * Получить список заметок с фильтрами и тегами
 */
async function listNotes({ req, tag, q, isPinned, isArchived = false, limit = 50, offset = 0 }) {
  const ident = getIdentity(req);
  if (!ident) return { notes: [], total: 0 };

  const conditions = [`n.${ident.field} = $1`];
  const params = [ident.value];
  let paramIdx = 2;

  if (typeof isArchived === 'boolean') {
    conditions.push(`n.is_archived = $${paramIdx++}`);
    params.push(isArchived);
  }

  if (typeof isPinned === 'boolean') {
    conditions.push(`n.is_pinned = $${paramIdx++}`);
    params.push(isPinned);
  }

  // Фильтр по тегу
  if (tag) {
    const cleanTag = String(tag).trim().toLowerCase().replace(/^#+/, '');
    conditions.push(`EXISTS (
      SELECT 1 FROM super_note_tag_bindings b
      JOIN super_note_tags t ON t.id = b.tag_id
      WHERE b.note_id = n.id AND t.name = $${paramIdx++}
    )`);
    params.push(cleanTag);
  }

  // Полнотекстовый или строковый поиск
  if (q && String(q).trim()) {
    const queryText = String(q).trim();
    conditions.push(`(
      n.tsv_content @@ plainto_tsquery('russian', $${paramIdx})
      OR n.title ILIKE '%' || $${paramIdx} || '%'
      OR n.content_raw ILIKE '%' || $${paramIdx} || '%'
    )`);
    params.push(queryText);
    paramIdx++;
  }

  const whereSql = conditions.join(' AND ');

  const sql = `
    SELECT 
      n.id, n.title, n.summary, n.content_raw, n.content_format,
      n.items_json, n.is_pinned, n.is_archived, n.color,
      n.created_at, n.updated_at,
      COALESCE(
        json_agg(
          json_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ) FILTER (WHERE t.id IS NOT NULL), '[]'
      ) AS tags
    FROM super_notes n
    LEFT JOIN super_note_tag_bindings tb ON tb.note_id = n.id
    LEFT JOIN super_note_tags t ON t.id = tb.tag_id
    WHERE ${whereSql}
    GROUP BY n.id
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  params.push(limit, offset);

  const res = await db.query(sql, params);
  return { notes: res.rows };
}

/**
 * Получить одну заметку по ID
 */
async function getNoteById(id, req) {
  const ident = getIdentity(req);
  if (!ident) return null;

  const sql = `
    SELECT 
      n.id, n.title, n.summary, n.content_raw, n.content_format,
      n.items_json, n.is_pinned, n.is_archived, n.color,
      n.created_at, n.updated_at,
      COALESCE(
        json_agg(
          json_build_object('id', t.id, 'name', t.name, 'color', t.color)
        ) FILTER (WHERE t.id IS NOT NULL), '[]'
      ) AS tags
    FROM super_notes n
    LEFT JOIN super_note_tag_bindings tb ON tb.note_id = n.id
    LEFT JOIN super_note_tags t ON t.id = tb.tag_id
    WHERE n.id = $1 AND n.${ident.field} = $2
    GROUP BY n.id
  `;

  const res = await db.query(sql, [id, ident.value]);
  return res.rows[0] || null;
}

/**
 * Создать новую заметку
 */
async function createNote(data, req) {
  const ident = getIdentity(req);
  if (!ident) throw new Error('Пользователь не идентифицирован');

  const title = (data.title || '').trim() || 'Без названия';
  const contentRaw = (data.content_raw || '').trim();
  const summary = (data.summary || '').trim() || null;
  const contentFormat = data.content_format || 'markdown';
  const isPinned = Boolean(data.is_pinned);
  const color = data.color || null;

  // Автоматический парсинг дочерних элементов (если не переданы готовые)
  let items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0 && contentRaw) {
    items = parseHierarchicalItems(contentRaw);
  }

  const userId = ident.isUser ? ident.value : null;
  const guestId = !ident.isUser ? ident.value : null;

  const insertSql = `
    INSERT INTO super_notes (
      user_id, guest_id, title, summary, content_raw, 
      content_format, items_json, is_pinned, color
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;

  const res = await db.query(insertSql, [
    userId,
    guestId,
    title,
    summary,
    contentRaw,
    contentFormat,
    JSON.stringify(items),
    isPinned,
    color,
  ]);

  const createdNote = res.rows[0];

  // Привязка тегов
  const tagsList = parseTags(data.tags);
  if (tagsList.length > 0) {
    await bindTagsToNote(createdNote.id, tagsList, ident);
  }

  return getNoteById(createdNote.id, req);
}

/**
 * Обновить существующую заметку
 */
async function updateNote(id, data, req) {
  const ident = getIdentity(req);
  if (!ident) throw new Error('Пользователь не идентифицирован');

  const existing = await getNoteById(id, req);
  if (!existing) return null;

  const title = data.title !== undefined ? (data.title || '').trim() : existing.title;
  const contentRaw = data.content_raw !== undefined ? (data.content_raw || '').trim() : existing.content_raw;
  const summary = data.summary !== undefined ? (data.summary || '').trim() : existing.summary;
  const contentFormat = data.content_format || existing.content_format;
  const isPinned = data.is_pinned !== undefined ? Boolean(data.is_pinned) : existing.is_pinned;
  const isArchived = data.is_archived !== undefined ? Boolean(data.is_archived) : existing.is_archived;
  const color = data.color !== undefined ? data.color : existing.color;

  let items = Array.isArray(data.items) ? data.items : existing.items_json;
  if (data.reparse_items && contentRaw) {
    items = parseHierarchicalItems(contentRaw);
  }

  const updateSql = `
    UPDATE super_notes SET
      title = $1,
      summary = $2,
      content_raw = $3,
      content_format = $4,
      items_json = $5,
      is_pinned = $6,
      is_archived = $7,
      color = $8,
      updated_at = now()
    WHERE id = $9 AND ${ident.field} = $10
    RETURNING *
  `;

  await db.query(updateSql, [
    title,
    summary,
    contentRaw,
    contentFormat,
    JSON.stringify(items),
    isPinned,
    isArchived,
    color,
    id,
    ident.value,
  ]);

  // Обновление тегов если они переданы
  if (data.tags !== undefined) {
    await db.query(`DELETE FROM super_note_tag_bindings WHERE note_id = $1`, [id]);
    const tagsList = parseTags(data.tags);
    if (tagsList.length > 0) {
      await bindTagsToNote(id, tagsList, ident);
    }
  }

  return getNoteById(id, req);
}

/**
 * Удалить заметку
 */
async function deleteNote(id, req) {
  const ident = getIdentity(req);
  if (!ident) return false;

  const res = await db.query(
    `DELETE FROM super_notes WHERE id = $1 AND ${ident.field} = $2 RETURNING id`,
    [id, ident.value]
  );
  return res.rowCount > 0;
}

/**
 * Привязать список строковых тегов к заметке
 */
async function bindTagsToNote(noteId, tagsList, ident) {
  for (const tagName of tagsList) {
    // Upsert тега
    let tagId;
    if (ident.isUser) {
      const tagRes = await db.query(
        `INSERT INTO super_note_tags (user_id, name)
         VALUES ($1, $2)
         ON CONFLICT (user_id, name) WHERE user_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [ident.value, tagName]
      );
      tagId = tagRes.rows[0].id;
    } else {
      const tagRes = await db.query(
        `INSERT INTO super_note_tags (guest_id, name)
         VALUES ($1, $2)
         ON CONFLICT (guest_id, name) WHERE guest_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [ident.value, tagName]
      );
      tagId = tagRes.rows[0].id;
    }

    // Привязка
    await db.query(
      `INSERT INTO super_note_tag_bindings (note_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT (note_id, tag_id) DO NOTHING`,
      [noteId, tagId]
    );
  }
}

/**
 * Получить облако тегов с частотой использования
 */
async function getTagCloud(req) {
  const ident = getIdentity(req);
  if (!ident) return [];

  const sql = `
    SELECT 
      t.id, t.name, t.color,
      COUNT(b.note_id)::int AS count
    FROM super_note_tags t
    JOIN super_note_tag_bindings b ON b.tag_id = t.id
    JOIN super_notes n ON n.id = b.note_id
    WHERE t.${ident.field} = $1 AND n.is_archived = false
    GROUP BY t.id, t.name, t.color
    ORDER BY count DESC, t.name ASC
  `;

  const res = await db.query(sql, [ident.value]);
  return res.rows;
}

module.exports = {
  listNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getTagCloud,
};
