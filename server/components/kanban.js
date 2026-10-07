// Каркас контракта kanban@1 (docs/ui-components.md §2): доменно-нейтральный
// движок канбан-доски. Домен объявляет экземпляр Kanban({...}) — колонки,
// карточки (SQL или доменная дверь), правило перемещения; каркас конструирует
// /meta /cards /move. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET  /meta            → колонки ({id,title,color,limit}), ключи полей карточки
//   GET  /cards           → { ok, cards } — плоский список, порядок внутри
//                            колонки = порядок от источника
//   POST /move {cardId,to} → единственная дверь переноса (правило проверяет
//                            домен); рендерер знает только этот путь
// Статусы выбора/просмотра у рендерера клиентские; карточка — снимок (П10).

const express = require('express');

// Декларация вида «канбан» — вызывается доменом в его точке сборки.
function Kanban(decl) {
  return { kind: 'kanban', version: 1, ...decl };
}

function router(decl) {
  const r = express.Router();
  const idKey = decl.idKey || 'id';
  const columnKey = decl.columnKey || 'column';
  const columns = decl.columns || [];

  r.get('/meta', (_req, res) => {
    res.json({
      ok: true,
      kind: 'kanban',
      version: 1,
      idKey,
      columnKey,
      columns: columns.map((c) => ({
        id: c.id,
        name: c.title,
        ...(c.color ? { color: c.color } : {}),
        ...(c.limit ? { limit: c.limit } : {}),
      })),
      card: decl.card || {},
      move: { enabled: !!decl.move },
    });
  });

  r.get('/cards', async (_req, res) => {
    try {
      const cards = await decl.cards();
      res.json({ ok: true, cards: Array.isArray(cards) ? cards : [] });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  r.post('/move', async (req, res) => {
    try {
      if (!decl.move) throw new Error('перемещение карточек не разрешено');
      const cardId = String(req.body.cardId || '');
      const to = String(req.body.to || '');
      if (!cardId) throw new Error('нужен cardId');
      if (!columns.some((c) => c.id === to)) throw new Error(`неизвестная колонка: ${to}`);
      const result = await decl.move({ cardId, to, user: req.user || null });
      res.json({ ok: true, result: result === undefined ? {} : result });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  return r;
}

module.exports = { Kanban, router };
