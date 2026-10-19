// Каркас контракта switch@1 (docs/ui-components.md §2в): тумблер на несколько положений —
// одно текущее, смена — решение домена. Над тумблером — фразы-пояснения и необязательная
// кнопка-призыв (положение, к которому зовут). Домен может не запретить, а спросить:
// ответ { confirm: 'предупреждение' } — рендерер показывает его человеку и повторяет
// смену с confirm: true. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET  /meta   → { kind:'switch', version:1, title }
//   GET  /state  → { ok, value, options:[{value, name, note?}], lines?:[фраза], cta?:{value, name}, hint? }
//   POST /set {value, confirm?} → { ok, result:{ message } } | { ok, result:{ confirm: 'текст' } }

const express = require('express');

function Switch(decl) {
  return { kind: 'switch', version: 1, ...decl };
}

function stateView(state) {
  const options = (state.options || []).map((o) => ({ value: String(o.value), name: String(o.name), ...(o.note ? { note: String(o.note) } : {}) }));
  if (!options.some((o) => o.value === String(state.value))) throw new Error(`switch@1: положения ${state.value} нет среди вариантов`);
  return {
    value: String(state.value),
    options,
    ...(state.lines && state.lines.length ? { lines: state.lines.map(String) } : {}),
    ...(state.cta ? { cta: { value: String(state.cta.value), name: String(state.cta.name) } } : {}),
    ...(state.hint ? { hint: String(state.hint) } : {}),
  };
}

function router(decl) {
  const r = express.Router();
  if (typeof decl.state !== 'function' || typeof decl.set !== 'function') throw new Error('Switch: нужны state({ user }) и set({ value, confirm, user })');

  r.get('/meta', (_req, res) => {
    res.json({ ok: true, kind: 'switch', version: 1, title: decl.title || '' });
  });

  r.get('/state', async (req, res) => {
    try {
      res.json({ ok: true, ...stateView(await decl.state({ user: req.user || null })) });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });
    }
  });

  r.post('/set', async (req, res) => {
    try {
      const value = String((req.body && req.body.value) ?? '').trim();
      const user = req.user || null;
      const { options } = stateView(await decl.state({ user }));
      if (!options.some((o) => o.value === value)) throw new Error(`нет положения «${value}»`);
      const result = await decl.set({ value, confirm: req.body.confirm === true, user });
      res.json({ ok: true, result: result && result.confirm ? { confirm: String(result.confirm) } : { message: String((result && result.message) || '') } });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });
    }
  });

  return r;
}

module.exports = { Switch, router };
