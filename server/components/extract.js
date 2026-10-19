// Каркас контракта extract@1 (docs/ui-components.md §2г) — «источник и его прочтения»:
// слева источник целиком (строки текста), правее — одна или несколько колонок того, что
// из него извлекли (например, механический разбор и разбор нейросетью). Пункт колонки —
// с тоном (ok | ask | miss), пометкой, заметкой и ссылками на строки источника (anchors):
// щелчок по пункту подсвечивает его место и пункты других колонок на том же месте.
// Колонка бывает закрыта (closed — с причиной) или спрятана под «глаз» (peek); у неё —
// совет (hint) и свои действия. У пункта — сверка (pair: same | diff), варианты (choices,
// с отличием note) и свёрнутые «ещё N» (more). Действия — на колонку (scope: all) или на
// пункт (scope: item; tones — у каких пунктов, choose — значение из вариантов пункта,
// fields — короткая форма). Какие действия доступны сейчас, решает вид — у каждой колонки
// свой список; каркас проверяет это и при запуске. Словарный греп (П9): доменных слов нет.
//
// Контракт:
//   GET  /meta       → { kind:'extract', version:1, title, legend:{ok, ask, miss},
//                        actions:[{id, name, scope, tones?, choose?, primary?, fields?}] }
//   GET  /view?key=  → { ok, title, subtitle?, facts:[{label, value}],
//                        source:{ title, lines:[строка], note? },
//                        results:[{ id, title, state, reason?, peek?, hint?, facts, actions:[id],
//                                   items:[{id, text, tone, anchors:[n], sub?, tag?, note?,
//                                           choices?:[{value, text, note?}], more?:[…], pair?:{text, tone},
//                                           actions?:[id] — у пункта только эти действия}],
//                                   extra:[{text, tone}] }] }
//   POST /actions/:id {key, item?, value?, …поля} → { ok, result:{ message?, download? } }

const express = require('express');

const TONES = new Set(['ok', 'ask', 'miss']);
const PAIRS = new Set(['same', 'diff']);
const STATES = new Set(['open', 'closed', 'peek']);
const SCOPES = new Set(['all', 'item']);

function Extract(decl) {
  return { kind: 'extract', version: 1, ...decl };
}

const fieldView = (f) => ({
  key: f.key, label: f.label, required: !!f.required,
  ...(f.multiline ? { multiline: true } : {}),
  ...(f.placeholder ? { placeholder: f.placeholder } : {}),
});

const facts = (list) => (list || []).filter((f) => f && f.value != null && f.value !== '')
  .map((f) => ({ label: String(f.label), value: String(f.value) }));

const choice = (c) => ({ value: String(c.value), text: String(c.text), ...(c.note ? { note: String(c.note) } : {}) });

function itemOf(it, size) {
  if (!TONES.has(it.tone)) throw new Error(`extract@1: неизвестный тон ${it.tone}`);
  if (it.pair && !PAIRS.has(it.pair.tone)) throw new Error(`extract@1: неизвестный тон сверки ${it.pair.tone}`);
  return {
    id: String(it.id),
    text: String(it.text),
    tone: it.tone,
    anchors: (it.anchors || []).filter((n) => Number.isInteger(n) && n >= 0 && n < size),
    ...(it.sub ? { sub: String(it.sub) } : {}),
    ...(it.tag ? { tag: String(it.tag) } : {}),
    ...(it.note ? { note: String(it.note) } : {}),
    ...(it.choices && it.choices.length ? { choices: it.choices.map(choice) } : {}),
    ...(it.more && it.more.length ? { more: it.more.map(choice) } : {}),
    ...(it.pair ? { pair: { text: String(it.pair.text), tone: it.pair.tone } } : {}),
    ...(Array.isArray(it.actions) ? { actions: it.actions.map(String) } : {}), // только эти действия пункта
  };
}

// Вид домена → ответ контракта; чужой тон или состояние — ошибка контракта (П8).
function viewOf(raw, known) {
  const lines = ((raw.source && raw.source.lines) || []).map(String);
  const results = (raw.results || []).map((r, i) => {
    const state = r.state || 'open';
    if (!STATES.has(state)) throw new Error(`extract@1: неизвестное состояние ${state}`);
    return {
      id: String(r.id || i),
      title: String(r.title || ''),
      state,
      ...(r.reason ? { reason: String(r.reason) } : {}),
      ...(state === 'peek' ? { peek: String(r.peek || 'Показать') } : {}),
      ...(r.hint ? { hint: String(r.hint) } : {}),
      facts: facts(r.facts),
      items: (r.items || []).map((it) => itemOf(it, lines.length)),
      extra: (r.extra || []).map((x) => {
        if (!PAIRS.has(x.tone)) throw new Error(`extract@1: неизвестный тон сверки ${x.tone}`);
        return { text: String(x.text), tone: x.tone };
      }),
      actions: (r.actions || []).map(String).filter((id) => known.has(id)),
    };
  });
  return {
    title: String(raw.title || ''),
    ...(raw.subtitle ? { subtitle: String(raw.subtitle) } : {}),
    facts: facts(raw.facts),
    source: { title: String((raw.source && raw.source.title) || ''), lines, ...(raw.source && raw.source.note ? { note: String(raw.source.note) } : {}) },
    results,
  };
}

function router(decl) {
  const r = express.Router();
  if (typeof decl.view !== 'function') throw new Error('Extract: нужен view({ key, user })');
  const actions = decl.actions || [];
  for (const a of actions) if (!SCOPES.has(a.scope || 'all')) throw new Error(`Extract: у действия ${a.id} неизвестный scope ${a.scope}`);
  const known = new Set(actions.map((a) => a.id));
  const keyOf = (v) => {
    const key = String(v ?? '').trim();
    if (!key) throw new Error('нужен key');
    return key;
  };

  r.get('/meta', (_req, res) => {
    res.json({
      ok: true,
      kind: 'extract',
      version: 1,
      title: decl.title || '',
      legend: { ok: 'ok', ask: 'ask', miss: 'miss', ...decl.legend },
      actions: actions.map((a) => ({
        id: a.id,
        name: a.name,
        scope: a.scope || 'all',
        ...(a.tones ? { tones: a.tones } : {}),
        ...(a.choose ? { choose: true } : {}),
        ...(a.primary ? { primary: true } : {}),
        ...(a.fields ? { fields: a.fields.map(fieldView) } : {}),
      })),
    });
  });

  r.get('/view', async (req, res) => {
    try {
      const key = keyOf(req.query.key);
      res.json({ ok: true, ...viewOf(await decl.view({ key, user: req.user || null }), known) });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });
    }
  });

  r.post('/actions/:actionId', async (req, res) => {
    try {
      const action = actions.find((a) => a.id === req.params.actionId);
      if (!action) return res.status(404).json({ error: `неизвестное действие: ${req.params.actionId}` });
      const body = req.body || {};
      const key = keyOf(body.key);
      const user = req.user || null;
      // доступность — по нынешнему виду: кнопка из устаревшей страницы не проходит
      const view = viewOf(await decl.view({ key, user }), known);
      const columns = view.results.filter((c) => c.actions.includes(action.id));
      if (!columns.length) throw new Error(`«${action.name}» сейчас недоступно — обновите страницу`);
      let item = null;
      if ((action.scope || 'all') === 'item') {
        item = columns.flatMap((c) => c.items).find((it) => it.id === String(body.item ?? ''));
        if (!item) throw new Error('пункт не найден — обновите страницу');
        if ((action.tones && !action.tones.includes(item.tone)) || (item.actions && !item.actions.includes(action.id))) {
          throw new Error(`«${action.name}» — не для этого пункта`);
        }
        if (action.choose && ![...(item.choices || []), ...(item.more || [])].some((c) => c.value === String(body.value ?? ''))) {
          throw new Error('нет такого варианта');
        }
      }
      for (const f of action.fields || []) {
        if (f.required && !String(body[f.key] ?? '').trim()) throw new Error(`${f.label}: пусто`);
      }
      const result = await action.run({ key, item: item && item.id, value: body.value == null ? null : String(body.value), body, user });
      res.json({ ok: true, result: result || {} });
    } catch (e) {
      res.status(e.status && e.status < 500 ? e.status : 400).json({ error: String(e.message || e) });
    }
  });

  return r;
}

module.exports = { Extract, router };
