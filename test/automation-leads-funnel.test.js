// «Кому автоматизировать», шаг 2: лид со своей судьбой, воронка на kanban@1,
// путь лида stages@1 и мост вех дерева процессов (прогоны переживают рестарт).
// Домен — на двойниках в памяти; Postgres — отдельным тестом, который
// пропускается, если база недоступна или миграция 021 не накатана.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { Journal, MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { Lead, LeadPath, FUNNEL_TEMPLATE } = require('../server/services/automation-leads/funnel/Lead');
const { LeadFunnel, LeadIntake } = require('../server/services/automation-leads/funnel/LeadFunnel');
const { MemoryLeadRepository } = require('../server/services/automation-leads/funnel/MemoryLeadRepository');
const { LeadRepository } = require('../server/services/automation-leads/funnel/LeadRepository');
const views = require('../server/services/automation-leads/funnel/views');
const { NicheScan } = require('../server/services/automation-leads/NicheScan');
const { LeadsDesk } = require('../server/services/automation-leads/desk');
const { ProcessTreeStore } = require('../server/process-tree');
const { TreeLog, MemoryTreeRows, PgTreeRows } = require('../server/process-tree/persist');
const { Components } = require('../server/components');
const { Kanban } = require('../server/components/kanban');
const { Stages } = require('../server/components/stages');

const NICHE = { slug: 'hardware', title: 'Крепёж и сантехника', city: 'Курск', rubrics: [] };
const OWNER = 'me@example.com';
const NOW = new Date('2026-10-17T09:00:00Z'); // сегодня по Москве — 17.10.2026

function row(id, over = {}) {
  return {
    id, name: `Место ${id}`, address: 'ул. Ленина, 1', phone: '+7 (4712) 00-00-00', site: '',
    strength: 'strong', verdict: 'лид: сбой', reason: 'сбой в отзывах: цены',
    score: 5, pain: 2, gap_score: 2, reach: 1, failures: 'цены', quote: '«цен нет» (2025-03)', gaps: 'нет сайта',
    product_detail: [
      { id: 'fastener_pick', title: 'Подбор крепежа', strong: false, hook: true, evidence: [] },
      { id: 'assistant', title: 'Умный ассистент', strong: false, hook: false, evidence: ['нет мессенджера'] },
      { id: 'site', title: 'Сайт с каталогом', strong: true, hook: false, evidence: ['цены'] },
    ],
    branches: 1,
    ...over,
  };
}

const plan = (...rows) => ({ leads: rows });

function makeFunnel({ clock = () => NOW } = {}) {
  const journal = new MemoryJournal();
  const repository = new MemoryLeadRepository(journal);
  const funnel = new LeadFunnel({
    repository,
    journal,
    board: new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'] }),
    path: new LeadPath({ clock }),
    template: FUNNEL_TEMPLATE,
  });
  return { funnel, journal, repository };
}

async function intakeOne(funnel, rows = [row('1')]) {
  await funnel.intake({ owner: OWNER, niche: NICHE, plan: plan(...rows), run: 'run-1', actor: OWNER });
  return funnel.leads(OWNER);
}

const types = (events) => events.map((e) => e.type);

// ---------- Lead: форма из строки плана, кого создать и кого обновить ----------

test('lead from a plan row: the offer is the product with evidence in reviews; a refusal is not a lead', () => {
  const draft = Lead.fromPlan(row('42'), NICHE);
  assert.equal(draft.companyKey, '2gis:42');
  assert.equal(draft.offer, 'site', 'продукт с доводом в отзывах впереди, модуль ниши — последним');
  assert.deepEqual(draft.evidence.offers.map((o) => o.id), ['site', 'assistant', 'fastener_pick']);
  assert.equal(draft.company.phone, '+7 (4712) 00-00-00');
  assert.equal(Lead.fromPlan(row('43', { strength: null, verdict: 'отказ' }), NICHE), null);
  const hookOnly = Lead.fromPlan(row('44', { product_detail: [{ id: 'fastener_pick', title: 'Подбор', strong: false, hook: true }] }), NICHE);
  assert.equal(hookOnly.offer, 'fastener_pick');
});

test('sort out: a known company gets fresh evidence, not a second lead; do-not-contact is skipped forever', () => {
  const drafts = ['1', '2', '3'].map((id) => Lead.fromPlan(row(id), NICHE));
  const existing = [
    { id: 'a', company_key: '2gis:1', do_not_contact: null },
    { id: 'b', company_key: '2gis:1', do_not_contact: null },
    { id: 'c', company_key: '2gis:2', do_not_contact: 'просили не звонить' },
  ];
  const out = Lead.sortOut(drafts, existing);
  assert.deepEqual(out.create.map((d) => d.companyKey), ['2gis:3']);
  assert.deepEqual(out.refresh.map((r) => r.lead.id), ['a', 'b']);
  assert.deepEqual(out.blocked.map((d) => d.companyKey), ['2gis:2']);
});

// ---------- воронка: приём, путь, «не беспокоить», конструктор ----------

test('intake lands new leads in the inbox column with a found event; a rescan refreshes instead of duplicating', async () => {
  const { funnel, journal } = makeFunnel();
  const first = await funnel.intake({ owner: OWNER, niche: NICHE, plan: plan(row('1'), row('2', { strength: null })), run: 'run-1', actor: OWNER });
  assert.deepEqual({ created: first.created, known: first.known }, { created: 1, known: 0 });
  const [lead] = await funnel.leads(OWNER);
  assert.equal(lead.column_id, 'found');
  const found = (await journal.forSubject('lead', lead.id))[0];
  assert.equal(found.type, 'found');
  assert.equal(found.cause, 'scan');
  assert.equal(found.data.run, 'run-1');
  assert.equal(found.data.offerTitle, 'Сайт с каталогом');

  const second = await funnel.intake({ owner: OWNER, niche: NICHE, plan: plan(row('1', { score: 8 })), run: 'run-2', actor: OWNER });
  assert.deepEqual({ created: second.created, known: second.known, changed: second.changed }, { created: 0, known: 1, changed: 1 });
  const leads = await funnel.leads(OWNER);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].evidence.score, 8);
  assert.equal(leads[0].seen_run, 'run-2');
  assert.deepEqual(types(await journal.forSubject('lead', lead.id)), ['found', 'evidence_changed']);

  const other = await funnel.intake({ owner: 'other@example.com', niche: NICHE, plan: plan(row('1')), run: 'run-3', actor: 'other' });
  assert.equal(other.created, 1, 'у другого владельца — своя воронка: «я» в тройке');
});

test('the path: a refusal needs a reason, waiting takes a deadline, every transition is an event with semantic types', async () => {
  const { funnel, journal } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  await funnel.move(OWNER, lead.id, 'qualified', {}, { actor: OWNER, cause: 'board' });
  await assert.rejects(funnel.move(OWNER, lead.id, 'lost', {}, { actor: OWNER }), /Причина: пусто/);
  await assert.rejects(funnel.move(OWNER, lead.id, 'pitched', { until: '2026-10-16' }, { actor: OWNER }), /прошёл/);
  await assert.rejects(funnel.move(OWNER, lead.id, 'pitched', { until: '20.10.2026' }, { actor: OWNER }), /ГГГГ-ММ-ДД/);
  await assert.rejects(funnel.move(OWNER, lead.id, 'pitched', { until: '2028-01-01' }, { actor: OWNER }), /365/);

  const pitched = await funnel.move(OWNER, lead.id, 'pitched', { until: '2026-10-24' }, { actor: OWNER, cause: 'board' });
  assert.equal(pitched.until, '2026-10-24');
  const lost = await funnel.move(OWNER, lead.id, 'lost', { reason: 'уже заказали сайт у студии' }, { actor: OWNER, cause: 'board' });
  assert.deepEqual([lost.column_id, lost.until, lost.reason], ['lost', null, 'уже заказали сайт у студии']);

  const moves = (await journal.forSubject('lead', lead.id)).filter((e) => e.type === 'moved');
  assert.deepEqual(moves.map((e) => [e.data.from, e.data.to, e.data.toType]), [
    ['found', 'qualified', 'working'], ['qualified', 'pitched', 'waiting_client'], ['pitched', 'lost', 'refused'],
  ]);
  assert.equal(moves[1].data.until, '2026-10-24');
  assert.equal(moves[2].data.reason, 'уже заказали сайт у студии');
  assert.ok(moves.every((e) => e.actor === OWNER && e.cause === 'board'));
});

test('a stale move is refused: the lead moves only from the column where the person saw it', async () => {
  const { funnel, repository } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  await repository.updateLead(lead.id, 'found', { column_id: 'qualified' }, []);
  await assert.rejects(repository.updateLead(lead.id, 'found', { column_id: 'replied' }, []), (err) => err.status === 409);
});

test('do not contact: from any column into refusal, moves are closed, the next scan skips the company; lifting needs a reason', async () => {
  const { funnel, journal } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  assert.deepEqual(funnel.actionsFor(lead), ['note', 'block']);
  await assert.rejects(funnel.act(OWNER, lead.id, 'block', {}, OWNER), /Причина/);
  const blocked = await funnel.act(OWNER, lead.id, 'block', { reason: 'просили не звонить' }, OWNER);
  assert.deepEqual([blocked.column_id, blocked.do_not_contact], ['lost', 'просили не звонить']);
  assert.deepEqual(funnel.actionsFor(blocked), ['note', 'unblock']);
  await assert.rejects(funnel.move(OWNER, lead.id, 'qualified', {}, { actor: OWNER }), /Не беспокоить/);
  await assert.rejects(funnel.act(OWNER, lead.id, 'block', { reason: 'ещё раз' }, OWNER), /недоступно/);

  const rescan = await funnel.intake({ owner: OWNER, niche: NICHE, plan: plan(row('1')), run: 'run-2', actor: OWNER });
  assert.deepEqual([rescan.created, rescan.blocked], [0, 1]);

  const allowed = await funnel.act(OWNER, lead.id, 'unblock', { reason: 'сами написали' }, OWNER);
  assert.equal(allowed.do_not_contact, null);
  await funnel.act(OWNER, lead.id, 'note', { text: 'позвонил, ждут КП' }, OWNER);
  assert.deepEqual(types(await journal.forSubject('lead', lead.id)), ['found', 'do_not_contact', 'contact_allowed', 'noted']);
});

test('constructor: removing a column with leads moves them and records both the board and the lead events', async () => {
  const { funnel, journal } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  await funnel.move(OWNER, lead.id, 'meeting', {}, { actor: OWNER });
  await assert.rejects(funnel.configure(OWNER, { op: 'remove', id: 'meeting' }, OWNER), /перенести/);
  await assert.rejects(funnel.configure(OWNER, { op: 'remove', id: 'found' }, OWNER), /входящие/);
  const columns = await funnel.configure(OWNER, { op: 'remove', id: 'meeting', moveTo: 'replied' }, OWNER);
  assert.ok(!columns.some((c) => c.id === 'meeting'));
  assert.equal((await funnel.leads(OWNER))[0].column_id, 'replied');
  const moved = (await journal.forSubject('lead', lead.id)).at(-1);
  assert.deepEqual([moved.type, moved.cause, moved.data.to], ['moved', 'column_removed', 'replied']);
  const { funnel: f } = await funnel.board(OWNER);
  assert.deepEqual(types(await journal.forSubject('board', f.id)), ['board_created', 'column_removed']);
});

test('columns tell what to ask on entry: a reason for refusals, a deadline for waiting', async () => {
  const { funnel } = makeFunnel();
  const columns = await funnel.columns(OWNER);
  assert.deepEqual(columns.find((c) => c.id === 'lost').ask, [{ key: 'reason', label: 'Причина', required: true }]);
  assert.equal(columns.find((c) => c.id === 'pitched').ask[0].type, 'date');
  assert.equal(columns.find((c) => c.id === 'qualified').ask, undefined);
});

// ---------- проекции: карточка и путь по шагам ----------

test('card and path steps: done with dates, current with a deadline, next up to the first done column', async () => {
  const { funnel } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  await funnel.move(OWNER, lead.id, 'qualified', {}, { actor: OWNER });
  await funnel.move(OWNER, lead.id, 'pitched', { until: '2026-10-24' }, { actor: OWNER });
  const h = await funnel.history(OWNER, lead.id);
  const view = views.pathSteps({ lead: h.lead, columns: h.columns, events: h.events, titles: views.titlesOf(h.columns, h.boardEvents), path: funnel.path });
  assert.deepEqual(view.steps.map((s) => [s.name, s.state]), [
    ['Найден', 'done'], ['Отобран', 'done'], ['Предложение отправлено', 'current'],
    ['Ответил', 'next'], ['Встреча', 'next'], ['Договорились', 'next'],
  ]);
  assert.equal(view.steps[2].note, 'ждём до 24.10');
  assert.equal(view.exit, null);
  const card = views.card(h.lead, funnel.path);
  assert.deepEqual(card.badges.map((b) => b.text), ['сбой в отзывах', 'балл 5', 'ждём до 24.10']);

  // срок вышел: лид всплывает первым в колонке
  const late = new LeadPath({ clock: () => new Date('2026-10-30T09:00:00Z') });
  assert.equal(views.card(h.lead, late).badges.at(-1).text, 'срок вышел 24.10');

  await funnel.move(OWNER, lead.id, 'lost', { reason: 'дорого' }, { actor: OWNER });
  const h2 = await funnel.history(OWNER, lead.id);
  const lost = views.pathSteps({ lead: h2.lead, columns: h2.columns, events: h2.events, titles: views.titlesOf(h2.columns), path: funnel.path });
  assert.deepEqual(lost.steps.map((s) => s.state), ['done', 'done', 'done']);
  assert.deepEqual([lost.exit.name, lost.exit.reason], ['Не вышло', 'дорого']);
});

// ---------- контракты: kanban@1 (подробности, действия, ask) и stages@1 ----------

async function serve(components, id) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', email: OWNER }; next(); });
  app.use('/c', components);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const call = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/c${path}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, json: await res.json() };
  };
  return { server, call };
}

function funnelComponents(funnel) {
  const owner = (user) => LeadFunnel.ownerOf(user);
  return Components({
    funnel: Kanban({
      columns: ({ user }) => funnel.columns(owner(user)),
      cards: async ({ user }) => (await funnel.leads(owner(user))).map((l) => views.card(l, funnel.path)),
      card: { title: 'title' },
      move: ({ cardId, to, fields, user }) => funnel.move(owner(user), cardId, to, fields, { actor: user.email, cause: 'board' }),
      details: {
        stages: '/c/path',
        read: async ({ cardId, user }) => {
          const h = await funnel.history(owner(user), cardId);
          const titles = views.titlesOf(h.columns, h.boardEvents);
          return { card: { title: h.lead.company.name }, facts: views.facts(h.lead, funnel.path), journal: h.events.map((e) => views.journalRow(e, titles)), actions: [...funnel.actionsFor(h.lead), 'ghost'] };
        },
      },
      actions: [
        { id: 'note', name: 'Заметка', fields: [{ key: 'text', label: 'Что произошло', required: true }],
          run: ({ cardId, fields, user }) => funnel.act(owner(user), cardId, 'note', fields, user.email) },
        { id: 'block', name: 'Не беспокоить', fields: [{ key: 'reason', label: 'Причина', required: true }],
          run: ({ cardId, fields, user }) => funnel.act(owner(user), cardId, 'block', fields, user.email) },
      ],
    }),
    path: Stages({
      title: 'Путь лида',
      path: async ({ key, user }) => {
        const h = await funnel.history(owner(user), key);
        return views.pathSteps({ lead: h.lead, columns: h.columns, events: h.events, titles: views.titlesOf(h.columns), path: funnel.path });
      },
    }),
  });
}

test('kanban@1: columns carry ask, a move without a required field is refused by the contract, details and actions work', async () => {
  const { funnel, journal } = makeFunnel();
  const [lead] = await intakeOne(funnel);
  const { server, call } = await serve(funnelComponents(funnel));
  try {
    const meta = (await call('/funnel/meta')).json;
    assert.deepEqual(meta.details, { enabled: true, stages: '/c/path' });
    assert.deepEqual(meta.actions.map((a) => a.id), ['note', 'block']);
    assert.equal(meta.columns.find((c) => c.id === 'lost').ask[0].required, true);
    assert.equal(meta.columns.find((c) => c.id === 'qualified').ask, undefined);

    const cards = (await call('/funnel/cards')).json.cards;
    assert.equal(cards[0].title, 'Место 1', 'карточки — воронки того, кто вошёл');

    const refused = await call('/funnel/move', { cardId: lead.id, to: 'lost' });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /Причина/);
    const moved = await call('/funnel/move', { cardId: lead.id, to: 'lost', reason: 'нет бюджета', ignored: 'x' });
    assert.equal(moved.status, 200);

    const details = (await call(`/funnel/cards/${lead.id}`)).json;
    assert.equal(details.card.title, 'Место 1');
    assert.deepEqual(details.actions, ['note', 'block'], 'необъявленное действие каркас отбрасывает');
    assert.ok(details.facts.some((f) => f.label === 'Причина отказа' && f.value === 'нет бюджета'));
    assert.ok(details.facts.find((f) => f.label === 'Телефон').href.startsWith('tel:+7'));
    assert.match(details.journal.at(-1).what, /«Найден» → «Не вышло» · причина: нет бюджета/);

    assert.equal((await call(`/funnel/cards/${lead.id}/actions/note`, {})).status, 400);
    assert.equal((await call(`/funnel/cards/${lead.id}/actions/nope`, { text: 'x' })).status, 400);
    assert.equal((await call(`/funnel/cards/${lead.id}/actions/note`, { text: 'перезвонить в январе' })).status, 200);
    assert.equal((await journal.forSubject('lead', lead.id)).at(-1).type, 'noted');
    assert.equal((await call('/funnel/cards/00000000-0000-0000-0000-000000000000')).status, 404);

    assert.deepEqual((await call('/path/meta')).json, { ok: true, kind: 'stages', version: 1, title: 'Путь лида' });
    const path = (await call(`/path/path?key=${lead.id}`)).json;
    assert.deepEqual(path.steps.map((s) => s.state), ['done']);
    assert.equal(path.exit.reason, 'нет бюджета');
    assert.equal((await call('/path/path')).status, 400);
  } finally {
    server.close();
  }
});

test('automation-leads funnel API is admin-only: a guest gets 403 before any data is touched', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/automation-leads', require('../server/routes/automationLeads'));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/automation-leads`;
    for (const path of ['/c/funnel/meta', '/c/funnel/cards', '/c/funnel-journal/rows', '/c/lead-path/path?key=x', '/c/pages/funnel']) {
      assert.equal((await fetch(base + path)).status, 403, path);
    }
    const post = await fetch(`${base}/c/funnel/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: 'x', to: 'lost' }),
    });
    assert.equal(post.status, 403);
  } finally {
    server.close();
  }
});

// ---------- разбор → воронка: шаг дерева и его сбой ----------

function stubScan(intake) {
  return new NicheScan({
    places: { run: async () => [{ branch_id: '1' }] },
    each: { run: async () => [] },
    plan: { decide: () => ({ ...plan(row('1')), counts: { leads: 1, strong: 1, weak: 0, rejected: 0, places: 1 } }) },
    intake,
  });
}

test('the scan ends with an intake step in the tree; an intake failure is the step outcome, not a failed scan', async () => {
  const { funnel } = makeFunnel();
  const store = new ProcessTreeStore();
  const root = store.createNode({ nodeType: 'NicheScan' });
  root.start();
  const result = await stubScan(new LeadIntake(funnel)).run(NICHE, {}, { node: root, user: { email: 'Me@Example.com' } });
  assert.equal(result.intake.created, 1);
  const intakeNode = store.nodesOf(root.id).find((n) => n.nodeType === 'LeadIntake');
  assert.equal(intakeNode.status, 'completed');
  assert.match(intakeNode.payload.summary, /новых 1/);
  assert.equal((await funnel.leads(OWNER))[0].found_run, root.id, 'владелец — email того, кто нажал, в нижнем регистре');

  const broken = { run: async () => { throw new Error('база недоступна'); } };
  const root2 = store.createNode({ nodeType: 'NicheScan' });
  const failed = await stubScan(broken).run(NICHE, {}, { node: root2, user: null });
  assert.equal(failed.intake.error, 'база недоступна');
  assert.equal(store.nodesOf(root2.id).find((n) => n.nodeType === 'LeadIntake').status, 'failed');
});

// ---------- мост вех: прогоны переживают рестарт ----------

test('tree bridge: runs survive a restart; a node left running becomes failed with interrupted', async () => {
  const rows = new MemoryTreeRows();
  const before = new ProcessTreeStore({ keepRoots: 3 });
  const log1 = new TreeLog(rows, { tree: 't', flushMs: 5 });
  await log1.attach(before);
  const done = before.createNode({ nodeType: 'NicheScan', title: 'готовый', payload: { niche: 'hardware' } });
  done.start();
  await done.step({ nodeType: 'Places' }, async (n) => n.complete({ summary: '150 в нише' }));
  done.complete({ summary: 'лидов 1', counts: { leads: 1, strong: 1 } });
  const alive = before.createNode({ nodeType: 'NicheCollect', title: 'идёт' });
  alive.start();
  const child = alive.child({ nodeType: 'Listing' });
  child.wait('ждём квоту');
  await log1.flush();

  // «рестарт»: новое хранилище и новый мост над теми же строками
  const after = new ProcessTreeStore({ keepRoots: 3 });
  const log2 = new TreeLog(rows, { tree: 't', flushMs: 5 });
  await log2.attach(after);
  assert.deepEqual(after.roots().map((r) => r.title), ['идёт', 'готовый']);
  const restored = after.nodesOf(done.id);
  assert.equal(restored.length, 2);
  assert.equal(restored.find((n) => n.nodeType === 'Places').payload.summary, '150 в нише');
  const interrupted = after.nodesOf(alive.id);
  assert.ok(interrupted.every((n) => n.status === 'failed' && n.outcome.code === 'interrupted'));
  await log2.flush();
  assert.equal((await rows.load('t')).find((n) => n.nodeId === child.id).outcome.code, 'interrupted', 'закрытие записано в базу');

  // новые прогоны пишутся, старые выселяются и из базы
  for (let i = 0; i < 3; i++) {
    const r = after.createNode({ nodeType: 'SourceProbe', title: `проверка ${i}` });
    r.complete();
  }
  await log2.flush();
  assert.equal(after.roots().length, 3);
  const kept = new Set((await rows.load('t')).map((n) => n.rootId));
  assert.deepEqual([...kept].sort(), after.rootIds().sort());
  assert.equal((await rows.load('other')).length, 0, 'деревья не смешиваются');
});

test('tree bridge: a database failure is logged once and retried; the tree keeps working in memory', async () => {
  let failing = true;
  const saved = [];
  const rows = {
    load: async () => [],
    save: async (_tree, nodes) => { if (failing) throw new Error('нет связи'); saved.push(...nodes); },
    prune: async () => {},
  };
  const warnings = [];
  const store = new ProcessTreeStore();
  const log = new TreeLog(rows, { tree: 't', flushMs: 60_000, log: { warn: (m) => warnings.push(m) } });
  await log.attach(store);
  store.createNode({ nodeType: 'NicheScan' }).complete();
  await log.flush();
  await log.flush();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /нет связи/);
  failing = false;
  await log.flush();
  assert.equal(saved.length, 1);
  assert.equal(store.roots()[0].status, 'completed');
});

test('desk after a restart: the niche row shows the last scan from the restored tree', async () => {
  const store = new ProcessTreeStore();
  const rows = new MemoryTreeRows();
  const scanRoot = (() => {
    const before = new ProcessTreeStore();
    const r = before.createNode({ nodeType: 'NicheScan', payload: { niche: 'hardware' } });
    r.complete({ summary: 'лидов 106', counts: { leads: 106, strong: 22 } });
    return before.nodesOf(r.id);
  })();
  await rows.save('t', scanRoot);
  await new TreeLog(rows, { tree: 't' }).attach(store);
  const desk = new LeadsDesk({
    tree: store,
    niches: { hardware: NICHE },
    corpus: { info: async () => null },
  });
  const [niche] = await desk.nicheRows();
  assert.deepEqual([niche.leads, niche.strong], [106, 22]);
  assert.match(niche.state, /до рестарта/);
});

// ---------- Postgres: воронка и мост на живой базе (пропуск без базы) ----------

test('postgres: a lead from a scan lives in the database, its transitions are journal events, tree rows round-trip', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['021_automation_leads.sql']);
    if (!rows.length) return t.skip('миграция 021 не накатана');
  } catch (err) {
    await db.pool.end().catch(() => {});
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  const owner = `test-${crypto.randomUUID()}@example.com`;
  const tree = `test-${crypto.randomUUID()}`;
  const journal = new Journal(db);
  const funnel = new LeadFunnel({
    repository: new LeadRepository(db, journal),
    journal,
    board: new Board({ types: STAGE_TYPES, required: ['inbox', 'done', 'refused'] }),
    path: new LeadPath(),
    template: FUNNEL_TEMPLATE,
  });
  try {
    const intake = await funnel.intake({ owner, niche: NICHE, plan: plan(row('1'), row('2')), run: 'pg-run', actor: owner });
    assert.equal(intake.created, 2);
    const again = await funnel.intake({ owner, niche: NICHE, plan: plan(row('1')), run: 'pg-run-2', actor: owner });
    assert.deepEqual([again.created, again.known], [0, 1]);
    const [lead] = await funnel.leads(owner);
    await funnel.move(owner, lead.id, 'qualified', {}, { actor: owner, cause: 'board' });
    const until = new LeadPath().today();
    const pitched = await funnel.move(owner, lead.id, 'pitched', { until }, { actor: owner, cause: 'board' });
    assert.equal(pitched.until, until, 'DATE возвращается строкой дня');
    await funnel.move(owner, lead.id, 'lost', { reason: 'не дозвонился' }, { actor: owner, cause: 'board' });
    await assert.rejects(new LeadRepository(db, journal).updateLead(lead.id, 'found', { column_id: 'won' }, []), (err) => err.status === 409);
    const events = await journal.forSubject('lead', lead.id);
    assert.deepEqual(types(events), ['found', 'moved', 'moved', 'moved']);
    assert.equal(events.at(-1).data.reason, 'не дозвонился');
    await funnel.configure(owner, { op: 'remove', id: 'meeting' }, owner);

    const store = new ProcessTreeStore();
    const root = store.createNode({ nodeType: 'NicheScan', payload: { niche: 'hardware' } });
    root.start();
    const log = new TreeLog(new PgTreeRows(db), { tree, flushMs: 5 });
    await log.attach(store);
    root.child({ nodeType: 'Places' }).complete({ summary: 'ok' });
    await log.flush();
    const restoredStore = new ProcessTreeStore();
    await new TreeLog(new PgTreeRows(db), { tree, flushMs: 5 }).attach(restoredStore);
    const nodes = restoredStore.nodesOf(root.id);
    assert.equal(nodes.length, 2);
    assert.equal(nodes.find((n) => !n.parentNodeId).outcome.code, 'interrupted');
  } finally {
    const { rows: [f] } = await db.query('SELECT id FROM lead_funnels WHERE owner = $1', [owner]);
    if (f) await db.query('DELETE FROM journal_events WHERE scope = $1', [f.id]);
    await db.query('DELETE FROM lead_funnels WHERE owner = $1', [owner]);
    await db.query('DELETE FROM process_tree_nodes WHERE tree = $1', [tree]);
    await db.pool.end();
  }
});
