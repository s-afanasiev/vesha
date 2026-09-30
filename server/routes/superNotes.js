// Маршруты API для Суперсправочника (/api/super-notes/)
const express = require('express');
const {
  listNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getTagCloud,
} = require('../services/super-notes/store');
const {
  syncNoteEmbedding,
  searchSemantic,
  getRelatedNotes,
} = require('../services/super-notes/embedder');
const { extractUrl } = require('../services/super-notes/parser');

const router = express.Router();

/**
 * GET /api/super-notes — список заметок
 */
router.get('/', async (req, res, next) => {
  try {
    const tag = req.query.tag ? String(req.query.tag).trim() : null;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const isPinned = req.query.pinned !== undefined ? req.query.pinned === 'true' : undefined;
    const isArchived = req.query.archived !== undefined ? req.query.archived === 'true' : false;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const result = await listNotes({ req, tag, q, isPinned, isArchived, limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/super-notes/tags — облако тегов с частотами
 */
router.get('/tags', async (req, res, next) => {
  try {
    const tags = await getTagCloud(req);
    res.json({ tags });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/super-notes/search/semantic — семантический векторный поиск
 */
router.get('/search/semantic', async (req, res, next) => {
  try {
    const query = req.query.q ? String(req.query.q).trim() : '';
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const notes = await searchSemantic({ req, query, limit });
    res.json({ notes, query });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/super-notes/:id — конкретная заметка
 */
router.get('/:id', async (req, res, next) => {
  try {
    const note = await getNoteById(req.params.id, req);
    if (!note) {
      return res.status(404).json({ error: 'Заметка не найдена' });
    }
    res.json({ note });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/super-notes/:id/related — семантически похожие заметки
 */
router.get('/:id/related', async (req, res, next) => {
  try {
    const related = await getRelatedNotes(req.params.id, req, 4);
    res.json({ related });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/super-notes — создание новой заметки
 */
router.post('/', async (req, res, next) => {
  try {
    const note = await createNote(req.body, req);
    // Фоновая генерация семантического вектора
    syncNoteEmbedding(note).catch(err => {
      console.warn('Background embedding sync failed:', err.message);
    });
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/super-notes/:id — обновление заметки
 */
router.put('/:id', async (req, res, next) => {
  try {
    const note = await updateNote(req.params.id, req.body, req);
    if (!note) {
      return res.status(404).json({ error: 'Заметка не найдена' });
    }
    syncNoteEmbedding(note).catch(err => {
      console.warn('Background embedding update failed:', err.message);
    });
    res.json({ note });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/super-notes/:id — удаление заметки
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deleteNote(req.params.id, req);
    if (!deleted) {
      return res.status(404).json({ error: 'Заметка не найдена' });
    }
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/super-notes/fetch-meta — быстрое извлечение title и favicon по URL
 */
router.post('/fetch-meta', async (req, res, next) => {
  try {
    const rawUrl = req.body && req.body.url;
    const url = extractUrl(rawUrl);
    if (!url) {
      return res.status(400).json({ error: 'Некорректный URL' });
    }

    let title = '';
    let description = '';
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VeshaSuperNotes/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (resp.ok) {
        const html = await resp.text();
        const tMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (tMatch) title = tMatch[1].trim();

        const dMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        if (dMatch) description = dMatch[1].trim();
      }
    } catch {
      // Игнорируем таймауты и ошибки парсинга внешних сайтов
    }

    if (!title) {
      try {
        title = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        title = url;
      }
    }

    res.json({ url, title, description });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
