// Каркас контракта table@1 (docs/ui-components.md §2): доменно-нейтральный
// движок таблицы. Домен объявляет экземпляр Table({...}) — строки, колонки,
// пресеты выбора, действия; каркас конструирует /meta /rows /ids /actions/:id.
// Словарный греп (П9): в этом файле нет доменных слов.
//
// Движок v1 — в памяти: rows() отдаёт всю выборку, каркас сам фильтрует,
// сортирует и режет. SQL-источник source(params) — рост-точка.

const express = require('express');

const DEFAULTS = { pageSize: 50, maxLimit: 500, maxIds: 1000 };

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
      actions: (decl.actions || []).map((a) => ({ id: a.id, name: a.name, bulk: !!a.bulk })),
      limits,
    });
  });

  r.get('/rows', async (req, res) => {
    try {
      const view = await viewOf(decl, limits, req.query);
      res.json({ ok: true, total: view.total, rows: view.page });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  r.get('/ids', async (req, res) => {
    try {
      const view = await viewOf(decl, limits, req.query, { idsOnly: true });
      res.json({ ok: true, ids: view.ids.slice(0, limits.maxIds) });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  r.post('/actions/:actionId', async (req, res) => {
    const action = (decl.actions || []).find((a) => a.id === req.params.actionId);
    if (!action) return res.status(404).json({ error: `неизвестное действие: ${req.params.actionId}` });
    try {
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map((v) => String(v)).filter(Boolean) : [];
      if (action.bulk && !ids.length) throw new Error('ничего не выбрано');
      if (action.max && ids.length > action.max) throw new Error(`не больше ${action.max} строк за раз`);
      const result = await action.run({ ids, body: req.body });
      res.json({ ok: true, result });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  return r;
}

// Общий конвейер /rows и /ids: выборка → поиск q → пресет → сортировка → срез.
async function viewOf(decl, limits, query, { idsOnly = false } = {}) {
  const all = await decl.rows();
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
