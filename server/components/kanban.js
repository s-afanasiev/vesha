// Каркас контракта kanban@1 (docs/ui-components.md §2а): доменно-нейтральный
// движок канбан-доски. Домен объявляет экземпляр Kanban({...}) — колонки,
// карточки (SQL или доменная дверь), правило перемещения; каркас конструирует
// /meta /cards /move. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET  /meta              → колонки ({id,name,type?,color?,limit?}), ключи полей
//                              карточки, возможности move / create / configure
//   GET  /cards             → { ok, cards } — плоский список, порядок внутри
//                              колонки = порядок от источника
//   POST /move {cardId,to}  → единственная дверь переноса (правило проверяет
//                              домен); рендерер знает только этот путь
//   POST /cards {...поля}   → новая карточка (если домен объявил create); поля —
//                              только объявленные в meta.create.fields
//   POST /columns {op,...}  → операция конструктора колонок (если домен объявил
//                              configure); инварианты доски проверяет домен,
//                              ответ — колонки после правки
// Колонки — от источника при каждом запросе: массив в декларации или функция
// (доска с конструктором). Статусы выбора/просмотра у рендерера клиентские;
// карточка — снимок (П10).

const express = require('express');

// Декларация вида «канбан» — вызывается доменом в его точке сборки.
function Kanban(decl) {
  return { kind: 'kanban', version: 1, ...decl };
}

function columnView(c) {
  return {
    id: c.id,
    name: c.title,
    ...(c.type ? { type: c.type } : {}),
    ...(c.color ? { color: c.color } : {}),
    ...(c.limit ? { limit: c.limit } : {}),
  };
}

function router(decl) {
  const r = express.Router();
  const idKey = decl.idKey || 'id';
  const columnKey = decl.columnKey || 'column';
  const columnsOf = async () => {
    const cols = typeof decl.columns === 'function' ? await decl.columns() : decl.columns;
    return cols || [];
  };
  const fail = (res, e) => res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });

  r.get('/meta', async (_req, res) => {
    try {
      const columns = await columnsOf();
      res.json({
        ok: true,
        kind: 'kanban',
        version: 1,
        idKey,
        columnKey,
        columns: columns.map(columnView),
        card: decl.card || {},
        move: { enabled: !!decl.move },
        create: decl.create ? { enabled: true, label: decl.create.label || 'Новая карточка', fields: decl.create.fields || [] } : { enabled: false },
        configure: decl.configure ? { enabled: true, types: decl.configure.types || [] } : { enabled: false },
      });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get('/cards', async (_req, res) => {
    try {
      const cards = await decl.cards();
      res.json({ ok: true, cards: Array.isArray(cards) ? cards : [] });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post('/move', async (req, res) => {
    try {
      if (!decl.move) throw new Error('перемещение карточек не разрешено');
      const cardId = String(req.body.cardId || '');
      const to = String(req.body.to || '');
      if (!cardId) throw new Error('нужен cardId');
      if (!(await columnsOf()).some((c) => c.id === to)) throw new Error(`неизвестная колонка: ${to}`);
      const result = await decl.move({ cardId, to, user: req.user || null });
      res.json({ ok: true, result: result === undefined ? {} : result });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post('/cards', async (req, res) => {
    try {
      if (!decl.create) throw new Error('создание карточек не разрешено');
      const fields = {};
      for (const f of decl.create.fields || []) {
        if (req.body[f.key] !== undefined) fields[f.key] = String(req.body[f.key]);
      }
      const result = await decl.create.run({ fields, user: req.user || null });
      res.json({ ok: true, result: result === undefined ? {} : result });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post('/columns', async (req, res) => {
    try {
      if (!decl.configure) throw new Error('настройка колонок не разрешена');
      const { op, ...args } = req.body || {};
      if (!op) throw new Error('нужна операция op');
      const columns = await decl.configure.run({ op: { op: String(op), ...args }, user: req.user || null });
      res.json({ ok: true, columns: (columns || await columnsOf()).map(columnView) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}

module.exports = { Kanban, router };
