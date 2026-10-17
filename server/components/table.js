// Каркас контракта table@1 (docs/ui-components.md §2): доменно-нейтральный
// движок таблицы. Домен объявляет экземпляр Table({...}) — строки, колонки,
// пресеты выбора, действия; каркас конструирует /meta /rows /ids /actions/:id.
// Словарный греп (П9): в этом файле нет доменных слов.
//
// Движок v1 — в памяти: rows() отдаёт всю выборку, каркас сам фильтрует,
// сортирует и режет. SQL-источник source(params) — рост-точка.
//
// Поле действия type: 'file' — тело приходит multipart (в памяти, не больше
// maxBytes), файл ложится в body[key] как { name, size, data }; options —
// выбор из списка, чужое значение — 400.

const express = require('express');
const multer = require('multer');

const DEFAULTS = { pageSize: 50, maxLimit: 500, maxIds: 1000, maxFileBytes: 10 * 1024 * 1024 };

// Декларация вида «таблица» — вызывается доменом в его точке сборки.
function Table(decl) {
  return { kind: 'table', version: 1, ...decl };
}

function router(decl) {
  const limits = { ...DEFAULTS, ...decl.limits };
  const r = express.Router();

  r.get('/meta', (_req, res) => {
    res.json({
      ok: true,
      kind: 'table',
      version: 1,
      idKey: decl.idKey || 'id',
      columns: (decl.columns || []).map((c) => ({
        key: c.key,
        name: c.name,
        type: c.type || 'text',
        sortable: !!c.sortable,
        ...(c.render ? { render: c.render } : {}),
        ...(c.note ? { note: c.note } : {}),
      })),
      search: Array.isArray(decl.search) && decl.search.length > 0,
      select: {
        presets: ((decl.select && decl.select.presets) || []).map((p) => ({ id: p.id, name: p.name })),
      },
      actions: (decl.actions || []).map((a) => ({
        id: a.id,
        name: a.name,
        bulk: !!a.bulk,
        ...(a.max ? { max: a.max } : {}),
        // поля короткой формы перед запуском: значения уезжают в тело действия рядом с ids
        ...(a.fields ? {
          fields: a.fields.map((f) => ({
            key: f.key, label: f.label, required: !!f.required,
            ...(f.multiline ? { multiline: true } : {}),
            ...(f.placeholder ? { placeholder: f.placeholder } : {}),
            ...(f.options ? { options: f.options.map((o) => (typeof o === 'string' ? { value: o, name: o } : o)) } : {}),
            ...(f.type === 'file' ? { type: 'file', ...(f.accept ? { accept: f.accept } : {}), maxBytes: f.maxBytes || limits.maxFileBytes } : {}),
          })),
        } : {}),
      })),
      limits,
    });
  });

  r.get('/rows', async (req, res) => {
    try {
      const view = await viewOf(decl, limits, req.query, { user: req.user || null });
      res.json({ ok: true, total: view.total, rows: view.page });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  r.get('/ids', async (req, res) => {
    try {
      const view = await viewOf(decl, limits, req.query, { idsOnly: true, user: req.user || null });
      res.json({ ok: true, ids: view.ids.slice(0, limits.maxIds) });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  r.post('/actions/:actionId', (req, res) => {
    const action = (decl.actions || []).find((a) => a.id === req.params.actionId);
    if (!action) return res.status(404).json({ error: `неизвестное действие: ${req.params.actionId}` });
    const files = (action.fields || []).filter((f) => f.type === 'file');
    if (!files.length) return void runAction(action, req, res, {});
    // поле-файл: тело — multipart, файл — в памяти, не больше maxBytes поля
    const maxBytes = Math.max(...files.map((f) => f.maxBytes || limits.maxFileBytes));
    multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: files.length } })
      .fields(files.map((f) => ({ name: f.key, maxCount: 1 })))(req, res, (err) => {
        if (err) {
          const big = err.code === 'LIMIT_FILE_SIZE';
          return res.status(400).json({ error: big ? `файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ` : `файл не принят: ${err.message}` });
        }
        const got = {};
        for (const f of files) {
          const file = req.files && req.files[f.key] && req.files[f.key][0];
          if (!file) continue;
          if (file.size > (f.maxBytes || limits.maxFileBytes)) {
            return res.status(400).json({ error: `${f.label}: больше ${Math.round((f.maxBytes || limits.maxFileBytes) / 1024 / 1024)} МБ` });
          }
          // multer отдаёт имя в latin1 — браузер прислал utf-8
          got[f.key] = { name: Buffer.from(file.originalname, 'latin1').toString('utf8'), size: file.size, data: file.buffer };
        }
        void runAction(action, req, res, got);
      });
  });

  async function runAction(action, req, res, files) {
    try {
      const body = { ...(req.body || {}), ...files };
      const ids = [].concat(body.ids ?? []).map((v) => String(v)).filter(Boolean); // multipart: одно ids — строка
      if (action.bulk && !ids.length) throw new Error('ничего не выбрано');
      if (action.max && ids.length > action.max) throw new Error(`не больше ${action.max} строк за раз`);
      for (const f of action.fields || []) {
        const empty = f.type === 'file' ? !body[f.key] : !String(body[f.key] ?? '').trim();
        if (f.required && empty) throw new Error(`${f.label}: пусто`);
        if (f.options && !empty && !f.options.some((o) => (typeof o === 'string' ? o : o.value) === String(body[f.key]))) {
          throw new Error(`${f.label}: нет такого варианта`);
        }
      }
      // user — инициатор действия, как в kanban@1 /move: от его имени вехи и квоты (П37)
      const result = await action.run({ ids, body, user: req.user || null });
      res.json({ ok: true, result });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  }

  return r;
}

// Общий конвейер /rows и /ids: выборка → поиск q → пресет → сортировка → срез.
async function viewOf(decl, limits, query, { idsOnly = false, user = null } = {}) {
  const all = await decl.rows({ user }); // источник владельца (воронка лидов) знает, чья выборка
  const idKey = decl.idKey || 'id';

  let list = Array.isArray(all) ? all : [];
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  if (q && Array.isArray(decl.search)) {
    list = list.filter((row) =>
      decl.search.some((k) => String(row[k] ?? '').toLowerCase().includes(q)));
  }
  if (idsOnly && query.preset) {
    const preset = ((decl.select && decl.select.presets) || []).find((p) => p.id === query.preset);
    if (!preset) throw new Error(`неизвестный пресет: ${query.preset}`);
    list = list.filter(preset.where);
  }

  if (idsOnly) return { ids: list.map((row) => String(row[idKey] ?? '')) };

  const sort = parseSort(decl, query.sort);
  if (sort) list = [...list].sort(cmp(sort));

  const total = list.length;
  const limit = clamp(Number(query.limit) || limits.pageSize, 1, limits.maxLimit);
  const offset = Math.max(0, Number(query.offset) || 0);
  return { total, page: list.slice(offset, offset + limit) };
}

function parseSort(decl, raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const dir = raw.startsWith('-') ? -1 : 1;
  const key = dir === -1 ? raw.slice(1) : raw;
  const col = (decl.columns || []).find((c) => c.key === key && c.sortable);
  return col ? { key, dir, type: col.type || 'text' } : null;
}

// null всегда вниз независимо от направления.
function cmp({ key, dir, type }) {
  return (a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (type === 'num') return (Number(av) - Number(bv)) * dir;
    return String(av).localeCompare(String(bv), 'ru') * dir;
  };
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

module.exports = { Table, router };
