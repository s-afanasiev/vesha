// Каркас контракта stages@1 (docs/ui-components.md §2а, «упрощённый канбан»):
// путь одной карточки во времени — окно статуса для ждущей стороны. Тот же
// журнал переходов, что у доски kanban@1, но одна карточка и шаги 1 → 2 → 3.
// Только чтение (П14). Домен объявляет Stages({ title, path }) и решает, что
// такое ключ (id карточки за границей доступа или токен ссылки) и какие шаги
// показать; каркас знает только форму ответа. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET /meta        → { kind:'stages', version:1, title }
//   GET /path?key=   → { ok, title, subtitle?, steps:[{name, state, at?, note?}],
//                        exit: null | {name, tone, reason?, at?}, updatedAt? }
//                        state: done | current | next; tone: done | refused | waiting

const express = require('express');

const STATES = new Set(['done', 'current', 'next']);

function Stages(decl) {
  return { kind: 'stages', version: 1, ...decl };
}

function router(decl) {
  const r = express.Router();
  if (typeof decl.path !== 'function') throw new Error('Stages: нужен path({ key, user })');

  r.get('/meta', (_req, res) => {
    res.json({ ok: true, kind: 'stages', version: 1, title: decl.title || '' });
  });

  r.get('/path', async (req, res) => {
    try {
      const key = String(req.query.key || '').trim();
      if (!key) throw new Error('нужен key');
      const view = await decl.path({ key, user: req.user || null });
      const steps = (view.steps || []).map((s) => {
        if (!STATES.has(s.state)) throw new Error(`stages@1: неизвестное состояние шага ${s.state}`);
        return { name: String(s.name), state: s.state, ...(s.at ? { at: s.at } : {}), ...(s.note ? { note: String(s.note) } : {}) };
      });
      res.json({
        ok: true,
        title: view.title || '',
        ...(view.subtitle ? { subtitle: view.subtitle } : {}),
        steps,
        exit: view.exit || null,
        ...(view.updatedAt ? { updatedAt: view.updatedAt } : {}),
      });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });
    }
  });

  return r;
}

module.exports = { Stages, router };
