// Каркас контракта kanban@1 (docs/ui-components.md §2а): доменно-нейтральный
// движок канбан-доски. Домен объявляет экземпляр Kanban({...}) — колонки,
// карточки (SQL или доменная дверь), правило перемещения; каркас конструирует
// /meta /cards /move. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET  /meta              → колонки ({id,name,type?,color?,limit?,ask?}), ключи полей
//                              карточки, возможности move / create / configure /
//                              details / actions
//   GET  /cards             → { ok, cards } — плоский список, порядок внутри
//                              колонки = порядок от источника
//   POST /move {cardId,to}  → единственная дверь переноса (правило проверяет
//                              домен); рендерер знает только этот путь. Колонка
//                              с ask — поля, которые домен спрашивает при входе в
//                              неё (причина отказа, срок); уходят только они,
//                              обязательное пустое — 400
//   POST /cards {...поля}   → новая карточка (если домен объявил create); поля —
//                              только объявленные в meta.create.fields
//   POST /columns {op,...}  → операция конструктора колонок (если домен объявил
//                              configure); инварианты доски проверяет домен,
//                              ответ — колонки после правки
//   GET  /cards/:id         → подробности карточки (если домен объявил details):
//                              { card:{title,subtitle}, facts:[{label,value,href?}],
//                              journal:[{at,what,actor,why}], actions:[id…] } —
//                              actions: какие из объявленных действий доступны ей сейчас
//   POST /cards/:id/actions/:action {...поля}
//                           → действие над карточкой (из meta.actions); поля —
//                              только объявленные, обязательное пустое — 400
// Колонки и карточки — от источника при каждом запросе: массив в декларации или
// функция ({ user }) — доска с конструктором, доска владельца. Статусы
// выбора/просмотра у рендерера клиентские; карточка — снимок (П10).

const express = require('express');

// Декларация вида «канбан» — вызывается доменом в его точке сборки.
function Kanban(decl) {
  return { kind: 'kanban', version: 1, ...decl };
}

function fieldView(f) {
  return {
    key: f.key,
    label: f.label || f.key,
    ...(f.required ? { required: true } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.multiline ? { multiline: true } : {}),
  };
}

function columnView(c) {
  return {
    id: c.id,
    name: c.title,
    ...(c.type ? { type: c.type } : {}),
    ...(c.color ? { color: c.color } : {}),
    ...(c.limit ? { limit: c.limit } : {}),
    ...(c.ask && c.ask.length ? { ask: c.ask.map(fieldView) } : {}),
  };
}

// Поля формы из тела запроса: только объявленные; обязательное пустое — ошибка контракта.
function pickFields(fields, body) {
  const out = {};
  for (const f of fields || []) {
    const v = body[f.key];
    const value = v === undefined || v === null ? '' : String(v).trim();
    if (value) out[f.key] = value;
    else if (f.required) throw new Error(`нужно поле «${f.label || f.key}»`);
  }
  return out;
}

function router(decl) {
  const r = express.Router();
  const idKey = decl.idKey || 'id';
  const columnKey = decl.columnKey || 'column';
  const actions = decl.actions || [];
  const userOf = (req) => req.user || null;
  const columnsOf = async (user) => {
    const cols = typeof decl.columns === 'function' ? await decl.columns({ user }) : decl.columns;
    return cols || [];
  };
  const fail = (res, e) => res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });

  r.get('/meta', async (req, res) => {
    try {
      const columns = await columnsOf(userOf(req));
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
        details: decl.details ? { enabled: true, ...(decl.details.stages ? { stages: decl.details.stages } : {}) } : { enabled: false },
        actions: actions.map((a) => ({ id: a.id, name: a.name, ...(a.fields ? { fields: a.fields.map(fieldView) } : {}) })),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get('/cards', async (req, res) => {
    try {
      const cards = await decl.cards({ user: userOf(req) });
      res.json({ ok: true, cards: Array.isArray(cards) ? cards : [] });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get('/cards/:cardId', async (req, res) => {
    try {
      if (!decl.details) throw new Error('подробности карточек не объявлены');
      const details = await decl.details.read({ cardId: String(req.params.cardId), user: userOf(req) });
      const known = new Set(actions.map((a) => a.id));
      res.json({
        ok: true,
        card: details.card || {},
        facts: details.facts || [],
        journal: details.journal || [],
        actions: (details.actions || []).filter((id) => known.has(id)),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post('/move', async (req, res) => {
    try {
      if (!decl.move) throw new Error('перемещение карточек не разрешено');
      const user = userOf(req);
      const cardId = String(req.body.cardId || '');
      const to = String(req.body.to || '');
      if (!cardId) throw new Error('нужен cardId');
      const column = (await columnsOf(user)).find((c) => c.id === to);
      if (!column) throw new Error(`неизвестная колонка: ${to}`);
      const fields = pickFields(column.ask, req.body);
      const result = await decl.move({ cardId, to, fields, user });
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
      const result = await decl.create.run({ fields, user: userOf(req) });
      res.json({ ok: true, result: result === undefined ? {} : result });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post('/cards/:cardId/actions/:actionId', async (req, res) => {
    try {
      const action = actions.find((a) => a.id === req.params.actionId);
      if (!action) throw new Error(`неизвестное действие: ${req.params.actionId}`);
      const fields = pickFields(action.fields, req.body || {});
      const result = await action.run({ cardId: String(req.params.cardId), fields, user: userOf(req) });
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
      const user = userOf(req);
      const columns = await decl.configure.run({ op: { op: String(op), ...args }, user });
      res.json({ ok: true, columns: (columns || await columnsOf(user)).map(columnView) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}

module.exports = { Kanban, router };
