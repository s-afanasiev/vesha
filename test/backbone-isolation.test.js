// Костяк: изоляция магазинов (docs/backbone-architecture.md §9, «Граница и изоляция»).
// Магазины живут в одной базе — строки различает shop_id, поэтому изоляция
// программная: граница routes/backbone.js до чтения данных пускает в адрес магазина
// только админа и сотрудника этого магазина (ShopAccess), а каждый id с клиента
// дверь сверяет с магазином адреса (BackboneDesk.orderOf, review, Assistant.own…).
//
// Здесь — атаки на HTTP-уровне, как их сделал бы «продвинутый» пользователь с
// инструментами разработчика: сотрудник магазина A подставляет в адреса своего
// магазина id заявки, строки, колонки, загрузки и разговора магазина B; ходит по
// адресам B; аноним и не-админ — в кабинет; посетитель витрины A — за данными B;
// подбор токена окна статуса, поддельный ключ гостя; демо chat-engine Vesha — за
// разговорами магазинов; перебор пароля. Каждая попытка — 401/403/404 (или отказ
// домена без чужих данных): проверяются и статус, и отсутствие меток B в теле, и
// то, что данные B в базе не изменились.

// до чтения config: свой ящик писем, щедрая частота формы, тесный счёт неудачных входов
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.BACKBONE_MAIL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backbone-iso-mail-'));
process.env.BACKBONE_SITE_PER_IP = '50';
process.env.LOGIN_FAILURES_PER_EMAIL = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('../server/config');

// Все компоненты магазина (components.js → shopComponents): каждый — поверхность атаки.
const COMPONENTS = {
  board: { kind: 'kanban', posts: ['move', 'cards', 'columns'] },
  receipts: { kind: 'table', actions: ['send'] },
  journal: { kind: 'table', actions: [] },
  drafts: { kind: 'table', actions: ['parse', 'export', 'sent', 'attach', 'demo'] },
  lines: { kind: 'table', actions: ['accept', 'replace', 'qty'] },
  summary: { kind: 'table', actions: ['help', 'shadow'] },
  weeks: { kind: 'table', actions: [] },
  synonyms: { kind: 'table', actions: [] },
  catalog: { kind: 'table', actions: [] },
  'catalog-fields': { kind: 'table', actions: ['upload', 'map', 'commit'] },
  'catalog-columns': { kind: 'table', actions: [] },
  'catalog-rejects': { kind: 'table', actions: [] },
  'catalog-loads': { kind: 'table', actions: [] },
  chats: { kind: 'table', actions: ['propose', 'reply'] },
  'chat-messages': { kind: 'table', actions: ['approve', 'reject'] },
};
const PAGES = ['main', 'draft', 'measures', 'catalog', 'assistant'];

// Чтения и записи магазина по его адресу: все экраны, строки, карточки, действия, файл.
function surfaces(slug, { orderId, lineId, dialogueId } = {}) {
  const base = `/api/backbone/s/${slug}`;
  const gets = [...PAGES.map((p) => `${base}/c/pages/${p}`), `${base}/files/invoice/${orderId || 'x'}.xlsx`];
  const posts = [];
  for (const [id, c] of Object.entries(COMPONENTS)) {
    gets.push(`${base}/c/${id}/meta`);
    if (c.kind === 'kanban') {
      gets.push(`${base}/c/${id}/cards`);
      posts.push([`${base}/c/${id}/move`, { cardId: orderId, to: 'issued' }]);
      posts.push([`${base}/c/${id}/cards`, { client: 'Взлом' }]);
      posts.push([`${base}/c/${id}/columns`, { op: 'rename', id: 'new', title: 'Взлом' }]);
    } else {
      gets.push(`${base}/c/${id}/rows`, `${base}/c/${id}/ids`);
      for (const a of c.actions) {
        const ids = id === 'lines' ? [lineId] : id.startsWith('chat') ? [dialogueId] : [orderId];
        posts.push([`${base}/c/${id}/actions/${a}`, { ids, text: 'взлом', sku: 'x', qty: '1', invoice: 'Болт — 1 шт', column: 'A' }]);
      }
    }
  }
  return { gets, posts };
}

// Клиент с cookie: сессия и гость едут в каждом запросе; тело — и разобранным, и сырым
// (по сырому проверяем, что меток чужого магазина в ответе нет).
const seenGuests = new Set();
function client(base, headers = {}) {
  const jar = new Map();
  const call = async (p, init = {}) => {
    const h = { ...headers, ...(init.headers || {}) };
    if (jar.size && !h.cookie) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + p, { ...init, headers: h });
    const cookies = r.headers.getSetCookie();
    for (const c of cookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const [k, v] = [pair.slice(0, i), pair.slice(i + 1)];
      if (k === 'vesha_guest') seenGuests.add(decodeURIComponent(v).split('.')[0]);
      if (!init.headers || !init.headers.cookie) jar.set(k, v);
    }
    const raw = await r.text();
    let body = {};
    try { body = JSON.parse(raw); } catch { /* xlsx или пусто */ }
    return { ...body, status: r.status, raw, cookies, type: r.headers.get('content-type') || '', retryAfter: r.headers.get('retry-after') };
  };
  return {
    jar,
    get: (p, init) => call(p, init),
    post: (p, body, init = {}) => call(p, { ...init, method: 'POST', headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }, body: JSON.stringify(body) }),
    put: (p, body) => call(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    form: (p, form) => call(p, { method: 'POST', body: form }),
  };
}

test('postgres: shops are isolated — staff of A, visitors and anonymous users reach no data of B', async (t) => {
  const db = require('../server/db');
  try {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', ['028_backbone_chat_channel.sql']);
    if (!rows.length) return t.skip('миграция 028 не накатана');
  } catch (err) {
    return t.skip(`Postgres недоступен: ${err.message}`);
  }
  if (!config.adminEmails.length) return t.skip('ADMIN_EMAILS пуст');
  const adminEmail = config.adminEmails[0];
  const { identityMiddleware } = require('../server/middleware/identity');
  const app = express();
  app.set('trust proxy', 1); // Secure у cookie — за HTTPS-прокси (X-Forwarded-Proto)
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', identityMiddleware);
  // админ экземпляра — заголовком теста (его пароля в общей базе нет); остальные — настоящей регистрацией
  app.use('/api', (req, _res, next) => { if (req.get('x-test-admin')) req.user = { id: 'test-admin', email: adminEmail }; next(); });
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/backbone', require('../server/routes/backbone'));
  app.use('/api/backbone-public', require('../server/routes/backbonePublic'));
  app.use('/api/chat-engine', require('../server/routes/chat-engine')); // демо chat-engine Vesha: те же таблицы разговоров
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const tag = Date.now().toString(36);
  const A = `t-iso-a-${tag}`;
  const B = `t-iso-b-${tag}`;
  const SECRET = `BBX${tag}`;                    // метка данных B: в тексте заявки, разговоре, каталоге, загрузке
  const buyerB = `buyer-b-${tag}@iso.test`;
  const shopMailB = `shop-b-${tag}@iso.test`;
  const staffMail = `staff-a-${tag}@iso.test`;
  const bruteMail = `brute-${tag}@iso.test`;
  const admin = client(base, { 'x-test-admin': '1' });
  const staffA = client(base);
  const anon = client(base);
  const guestA = client(base);
  const guestB = client(base);
  const { rows: [{ value: demoPersona }] } = await db.query("SELECT value FROM chat_engine_settings WHERE key = 'persona'");
  const sql = async (q, params) => (await db.query(q, params)).rows;

  try {
    // ---------- магазины A и B, сотрудник A, данные B ----------
    for (const [slug, name, email] of [[A, 'Изоляция A', ''], [B, `Изоляция B ${SECRET}`, shopMailB]]) {
      const opened = await admin.post('/api/backbone/c/shops/actions/open', { slug, name, niche: 'hardware', email });
      assert.equal(opened.status, 200, opened.error);
    }
    const [shopA] = await sql('SELECT * FROM backbone_shops WHERE slug = $1', [A]);
    const [shopB] = await sql('SELECT * FROM backbone_shops WHERE slug = $1', [B]);
    for (const [shop, prefix, note] of [[shopA, 'AA', 'магазин A'], [shopB, 'BB', SECRET]]) {
      await db.query(`INSERT INTO backbone_catalog_items (shop_id, sku, name, item_group, unit, pack, price, stock, position) VALUES
        ($1, $2, $3, 'Болты', 'шт', 25, 15.40, 1000, 1), ($1, $4, $5, 'Гайки', 'шт', 50, 2.10, 1000, 2)`,
      [shop.id, `${prefix}-B10x50`, `Болт DIN 933 М10×50 ${note}`, `${prefix}-N10`, `Гайка DIN 934 М10 ${note}`]);
      await db.query('UPDATE backbone_shops SET catalog_version = 1 WHERE id = $1', [shop.id]);
    }

    // сотрудник A — учётка, которую завёл сайт: пароль видит только админ
    const added = await admin.post('/api/backbone/c/shops/actions/staff', { ids: [A], email: staffMail });
    assert.equal(added.status, 200, added.error);
    const [, staffPass] = added.result.message.match(/пароль (\S+) \(показываем один раз\)/);
    assert.equal((await staffA.post('/api/auth/login', { email: staffMail, password: staffPass })).status, 200);

    const form = new FormData();
    form.set('contact', buyerB); form.set('consent', 'on');
    form.set('text', `Болт М10х50 — 200 шт\nГайка М10 — 200 шт\nПозиция ${SECRET} — 1 шт`);
    const orderedB = await guestB.form(`/api/backbone-public/shops/${B}/orders`, form);
    assert.equal(orderedB.status, 200, orderedB.error);
    const statusTokenB = new URLSearchParams(JSON.parse(orderedB.raw).status.split('?')[1]).get('t'); // status в теле — ссылка, в клиенте — HTTP
    const [orderB] = await sql('SELECT * FROM backbone_orders WHERE shop_id = $1', [shopB.id]);
    assert.equal(orderB.status_token, statusTokenB);
    const parsed = await admin.post(`/api/backbone/s/${B}/c/drafts/actions/parse`, { ids: [orderB.id] });
    assert.equal(parsed.status, 200, parsed.error);
    const linesB = await sql('SELECT id FROM backbone_order_lines WHERE order_id = $1 ORDER BY position', [orderB.id]);
    assert.ok(linesB.length >= 2, 'у заявки B — черновик');
    const addedCol = await admin.post(`/api/backbone/s/${B}/c/board/columns`, { op: 'add', title: `Колонка ${SECRET}`, type: 'working' });
    assert.equal(addedCol.status, 200, addedCol.error);
    const colB = addedCol.columns.find((c) => c.name.includes(SECRET)).id;

    const askedB = await guestB.post(`/api/backbone-public/shops/${B}/assistant/messages`, { text: `Вопрос ${SECRET}: привезёте в субботу?`, externalId: `ext-${tag}` });
    assert.equal(askedB.status, 200, askedB.error);
    const [dialogB] = await sql('SELECT * FROM chat_engine_dialogues WHERE visitor_key LIKE $1', [`${shopB.id}:%`]);
    assert.equal(dialogB.channel, 'shop', 'разговор магазина — на канале shop');
    const [draftB] = await sql(`INSERT INTO chat_engine_messages (dialogue_id, role, state, text) VALUES ($1, 'draft', 'open', $2) RETURNING *`, [dialogB.id, `Черновик ${SECRET}`]);
    const visitorMsgB = askedB.messages.find((m) => m.mine);
    const [loadB] = await sql(`INSERT INTO backbone_catalog_loads (shop_id, status, file_name, file, header_row, columns, mapping, rows, actor)
      VALUES ($1, 'pending', $2, '\\x00', 1, $3, '{}', 1, 'admin') RETURNING id`,
    [shopB.id, `прайс-${SECRET}.xlsx`, JSON.stringify([{ index: 0, letter: 'A', header: SECRET, samples: [SECRET] }])]);
    await db.query("UPDATE backbone_receipts SET status = 'pending' WHERE shop_id = $1", [shopB.id]);
    const pendingB = (await sql("SELECT count(*)::int AS n FROM backbone_receipts WHERE shop_id = $1 AND status = 'pending'", [shopB.id]))[0].n;
    assert.ok(pendingB >= 1, 'у B — письма в очереди');

    // свои данные A: заявка сотрудника и разговор посетителя
    assert.equal((await staffA.post(`/api/backbone/s/${A}/c/board/cards`, { client: 'Клиент A', text: 'Болт М10х50 — 10 шт' })).status, 200);
    assert.equal((await guestA.post(`/api/backbone-public/shops/${A}/assistant/messages`, { text: 'Работаете в воскресенье?' })).status, 200);
    const [dialogA] = await sql('SELECT * FROM chat_engine_dialogues WHERE visitor_key LIKE $1', [`${shopA.id}:%`]);

    // метки B: ни одна не должна появиться в ответе на атаку
    const marksB = [SECRET, orderB.id, ...linesB.map((l) => l.id), dialogB.id, draftB.id, buyerB, shopMailB, shopB.id, orderB.status_token];
    const clean = (r, what) => {
      for (const m of marksB) assert.ok(!r.raw.includes(m), `${what}: в ответе метка B «${m}»`);
    };
    const snapshotB = async () => JSON.stringify({
      order: await sql('SELECT column_id, updated_at FROM backbone_orders WHERE shop_id = $1', [shopB.id]),
      lines: await sql('SELECT id, state, review, sku, invoice_qty FROM backbone_order_lines WHERE shop_id = $1 ORDER BY id', [shopB.id]),
      columns: await sql('SELECT id, title, position FROM backbone_board_columns WHERE shop_id = $1 ORDER BY id', [shopB.id]),
      events: await sql('SELECT count(*)::int AS n FROM journal_events WHERE scope = $1', [String(shopB.id)]),
      messages: await sql('SELECT id, role, state, text FROM chat_engine_messages WHERE dialogue_id = $1 ORDER BY id', [dialogB.id]),
      dialogue: await sql('SELECT stage, notes, visitor_name FROM chat_engine_dialogues WHERE id = $1', [dialogB.id]),
      load: await sql('SELECT status, mapping FROM backbone_catalog_loads WHERE id = $1', [loadB.id]),
      receipts: await sql('SELECT status FROM backbone_receipts WHERE shop_id = $1 ORDER BY id', [shopB.id]),
      persona: await sql("SELECT value FROM chat_engine_settings WHERE key = 'backbone.persona'"),
    });
    const before = await snapshotB();
    const idsB = { orderId: orderB.id, lineId: linesB[0].id, dialogueId: dialogB.id };

    await t.test('без входа — 401 на любой адрес кабинета, данных нет', async () => {
      const { gets, posts } = surfaces(B, idsB);
      for (const p of [...gets, '/api/backbone/me', '/api/backbone/c/shops/rows', '/api/backbone/c/staff/rows', '/api/backbone/c/pages/shops']) {
        const r = await anon.get(p);
        assert.equal(r.status, 401, p);
        clean(r, p);
      }
      for (const [p, body] of [...posts, ['/api/backbone/invite', { token: 'x' }], ['/api/backbone/c/shops/actions/staff', { ids: [B], email: 'x@iso.test' }]]) {
        const r = await anon.post(p, body);
        assert.equal(r.status, 401, p);
        clean(r, p);
      }
    });

    await t.test('сотрудник A по адресам магазина B — 403 на каждый экран, строки и действие', async () => {
      const { gets, posts } = surfaces(B, idsB);
      for (const p of gets) {
        const r = await staffA.get(p);
        assert.equal(r.status, 403, p);
        clean(r, p);
      }
      for (const [p, body] of posts) {
        const r = await staffA.post(p, body);
        assert.equal(r.status, 403, p);
        clean(r, p);
      }
    });

    await t.test('не-админ в кабинете магазинов — 403: магазины, сотрудники, свой доступ к чужому магазину', async () => {
      for (const p of ['/api/backbone/c/shops/rows', '/api/backbone/c/staff/rows', '/api/backbone/c/pages/shops', '/api/backbone/c/shops/meta']) {
        const r = await staffA.get(p);
        assert.equal(r.status, 403, p);
        clean(r, p);
      }
      for (const [a, body] of [['shops/actions/open', { slug: `t-iso-x-${tag}`, name: 'X', niche: 'hardware' }],
        ['shops/actions/change', { ids: [B], name: 'Взлом' }], ['shops/actions/staff', { ids: [B], email: staffMail }],
        ['staff/actions/remove', { ids: [`${A}:${staffMail}`] }]]) {
        assert.equal((await staffA.post(`/api/backbone/c/${a}`, body)).status, 403, a);
      }
      const me = await staffA.get('/api/backbone/me');
      assert.deepEqual(me.shops.map((s) => s.slug), [A]);
      clean(me, '/me');
    });

    await t.test('сотрудник A подставляет id заявки B в адреса своего магазина — «не найдена»', async () => {
      const moved = await staffA.post(`/api/backbone/s/${A}/c/board/move`, { cardId: orderB.id, to: 'issued' });
      assert.equal(moved.status, 404);
      clean(moved, 'move');
      const parsedA = await staffA.post(`/api/backbone/s/${A}/c/drafts/actions/parse`, { ids: [orderB.id] });
      assert.equal(parsedA.status, 200, 'разбор пачкой — исход по каждой заявке');
      assert.equal(parsedA.result.message, 'Заявка не найдена');
      const attached = await staffA.post(`/api/backbone/s/${A}/c/drafts/actions/attach`, { ids: [orderB.id], invoice: 'Болт М10х50 — 200 шт' });
      assert.equal(attached.status, 404);
      clean(attached, 'attach');
      // выгрузка, «счёт отправлен» и файл — в помощи; A переводим прямо в базе
      await db.query("UPDATE backbone_shops SET mode = 'help' WHERE id = $1", [shopA.id]);
      for (const a of ['export', 'sent']) {
        const r = await staffA.post(`/api/backbone/s/${A}/c/drafts/actions/${a}`, { ids: [orderB.id] });
        assert.equal(r.status, 404, a);
        clean(r, a);
      }
      const file = await staffA.get(`/api/backbone/s/${A}/files/invoice/${orderB.id}.xlsx`);
      assert.equal(file.status, 404);
      assert.match(file.type, /json/, 'вместо xlsx — отказ');
      clean(file, 'xlsx');
      // id не в форме UUID — тоже «не найдено», а не ошибка базы
      for (const [p, body] of [[`/c/board/move`, { cardId: "1' OR '1'='1", to: 'issued' }], [`/c/drafts/actions/export`, { ids: ['x'] }], [`/c/lines/actions/accept`, { ids: ['x'] }], [`/c/chats/actions/propose`, { ids: ['x'] }]]) {
        const r = await staffA.post(`/api/backbone/s/${A}${p}`, body);
        assert.equal(r.status, 404, p);
        assert.doesNotMatch(r.raw, /syntax|uuid/i, `${p}: без текста ошибки базы`);
      }
      assert.equal((await staffA.get(`/api/backbone/s/${A}/files/invoice/x.xlsx`)).status, 404);
    });

    await t.test('строки черновика B через таблицу строк A — «не найдена», строки B не тронуты', async () => {
      for (const [a, body] of [['accept', {}], ['replace', { sku: 'AA-B10x50' }], ['qty', { qty: '5' }]]) {
        const r = await staffA.post(`/api/backbone/s/${A}/c/lines/actions/${a}`, { ids: [linesB[0].id], ...body });
        assert.equal(r.status, 404, a);
        clean(r, a);
      }
      const all = await staffA.post(`/api/backbone/s/${A}/c/lines/actions/accept`, { ids: linesB.map((l) => l.id) });
      assert.equal(all.status, 404, 'пачка чужих строк');
    });

    await t.test('колонки: колонка B в переносе и конструкторе A — «нет колонки»; одноимённая правится только у A', async () => {
      const [orderA] = await sql('SELECT id FROM backbone_orders WHERE shop_id = $1', [shopA.id]);
      assert.equal((await staffA.post(`/api/backbone/s/${A}/c/board/move`, { cardId: orderA.id, to: 'parse' })).status, 200, 'карточка A — в «Разбор»: удалить колонку можно только с переносом');
      const into = await staffA.post(`/api/backbone/s/${A}/c/board/move`, { cardId: orderA.id, to: colB });
      assert.equal(into.status, 400);
      assert.match(into.error, /неизвестная колонка/);
      clean(into, 'move to B column');
      for (const op of [{ op: 'rename', id: colB, title: 'Взлом' }, { op: 'remove', id: 'parse', moveTo: colB }, { op: 'move', id: colB, to: 0 }]) {
        const r = await staffA.post(`/api/backbone/s/${A}/c/board/columns`, op);
        assert.equal(r.status, 400, op.op);
        clean(r, op.op);
      }
      const renamed = await staffA.post(`/api/backbone/s/${A}/c/board/columns`, { op: 'rename', id: 'new', title: 'Входящие A' });
      assert.equal(renamed.status, 200, renamed.error);
      const [colA] = await sql("SELECT title FROM backbone_board_columns WHERE shop_id = $1 AND id = 'new'", [shopA.id]);
      assert.equal(colA.title, 'Входящие A');
    });

    await t.test('разговор и черновик B через экран ассистента A — «не найден», черновик B открыт', async () => {
      for (const [a, body] of [['chats/actions/propose', { ids: [dialogB.id] }], ['chats/actions/reply', { ids: [dialogB.id], text: 'взлом' }],
        ['chat-messages/actions/approve', { ids: [`${dialogB.id}/${draftB.id}`], text: 'взлом' }], ['chat-messages/actions/reject', { ids: [`${dialogB.id}/${draftB.id}`] }]]) {
        const r = await staffA.post(`/api/backbone/s/${A}/c/${a}`, body);
        assert.equal(r.status, 404, a);
        clean(r, a);
      }
      const mixed = await staffA.post(`/api/backbone/s/${A}/c/chat-messages/actions/approve`, { ids: [`${dialogA.id}/${draftB.id}`] });
      assert.equal(mixed.status, 400, 'свой разговор, чужой черновик — «это не черновик»');
      clean(mixed, 'mixed');
    });

    await t.test('загрузка каталога B не видна и не подменяется из A (id загрузки с клиента не приходит)', async () => {
      assert.deepEqual((await staffA.get(`/api/backbone/s/${A}/c/catalog-columns/rows`)).rows, []);
      const commit = await staffA.post(`/api/backbone/s/${A}/c/catalog-fields/actions/commit`, {});
      assert.equal(commit.status, 400);
      assert.match(commit.error, /Нет файла/);
      const map = await staffA.post(`/api/backbone/s/${A}/c/catalog-fields/actions/map`, { ids: ['sku'], column: 'A' });
      assert.equal(map.status, 400);
      assert.match(map.error, /Сначала загрузите файл/);
      clean(commit, 'commit');
      clean(map, 'map');
    });

    await t.test('квитанции: «Отправить ожидающие» в кабинете A — только письма A, очередь B не тронута и не сосчитана', async () => {
      const sent = await staffA.post(`/api/backbone/s/${A}/c/receipts/actions/send`, {});
      assert.equal(sent.status, 200, sent.error);
      assert.match(sent.result.message, /к отправке 0, ушло 0/);
    });

    await t.test('данные A — без меток B: доска, журнал, черновики, строки, синонимы, каталог, замеры, письма, разговоры', async () => {
      for (const p of ['board/cards', 'journal/rows?limit=500', 'drafts/rows', 'lines/rows', 'synonyms/rows', 'catalog/rows?limit=500', 'summary/rows',
        'weeks/rows', 'receipts/rows', 'chats/rows', 'chat-messages/rows', 'catalog-loads/rows', 'catalog-rejects/rows', 'catalog-fields/rows', 'board/meta']) {
        const r = await staffA.get(`/api/backbone/s/${A}/c/${p}`);
        assert.equal(r.status, 200, `${p}: ${r.error}`);
        clean(r, p);
      }
      const catalog = await staffA.get(`/api/backbone/s/${A}/c/catalog/rows?limit=500`);
      assert.deepEqual(catalog.rows.map((r) => r.sku).sort(), ['AA-B10x50', 'AA-N10']);
    });

    await t.test('посев — только свой ключ: «constructor», «__proto__», «toString» — не магазин ни с витрины, ни в кабинете', async () => {
      for (const slug of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        for (const p of [`/shops/${slug}`, `/shops/${slug}/catalog`, `/shops/${slug}/privacy`, `/shops/${slug}/assistant`]) {
          const r = await anon.get(`/api/backbone-public${p}`);
          assert.equal(r.status, 404, p);
        }
        assert.equal((await admin.get(`/api/backbone/s/${slug}/c/board/cards`)).status, 404, `админ: ${slug}`);
        assert.equal((await staffA.get(`/api/backbone/s/${slug}/c/board/cards`)).status, 403, `сотрудник: ${slug}`);
      }
      const made = await sql("SELECT slug FROM backbone_shops WHERE slug IN ('constructor', '__proto__', 'toString', 'hasOwnProperty')");
      assert.deepEqual(made, [], 'игрушечные адреса не заводят магазин');
    });

    await t.test('витрина A не отдаёт данных B: название, каталог, политика, ассистент', async () => {
      const front = await guestB.get(`/api/backbone-public/shops/${A}`);
      assert.equal(front.status, 200);
      assert.equal(front.name, 'Изоляция A');
      clean(front, 'storefront');
      const found = await guestB.get(`/api/backbone-public/shops/${A}/catalog?q=BB-`);
      assert.equal(found.total, 0);
      const all = await guestB.get(`/api/backbone-public/shops/${A}/catalog`);
      assert.deepEqual(all.items.map((i) => i.sku).sort(), ['AA-B10x50', 'AA-N10']);
      clean(all, 'catalog');
      const privacy = await guestB.get(`/api/backbone-public/shops/${A}/privacy`);
      assert.deepEqual([privacy.name, privacy.email], ['Изоляция A', null]);
      clean(privacy, 'privacy');

      // посетитель с заявкой №1 в B спрашивает о ней витрину A — «не вижу»
      const asked = await guestB.post(`/api/backbone-public/shops/${A}/assistant/messages`, { text: `где заявка ${orderedB.number}?` });
      assert.equal(asked.status, 200, asked.error);
      assert.match(asked.messages[asked.messages.length - 1].text, /не вижу/);
      clean(asked, 'assistant status');
      const talk = await guestB.get(`/api/backbone-public/shops/${A}/assistant`);
      assert.ok(talk.messages.every((m) => !m.text.includes(SECRET)), 'разговор с B в виджете A не виден');
      clean(talk, 'assistant talk');
      // сообщение со списком из разговора B — не заявка в A
      const sent = await guestB.post(`/api/backbone-public/shops/${A}/assistant/orders`, { message: visitorMsgB.id, contact: 'x@iso.test', consent: 'on' });
      assert.equal(sent.status, 404);
      clean(sent, 'assistant order');
    });

    await t.test('окно статуса: токен — 24 знака (144 бита), подбор и порча токена — 404, контактов и текста нет', async () => {
      assert.ok(statusTokenB.length >= 24, statusTokenB);
      const tries = [`${statusTokenB.slice(0, -1)}${statusTokenB.endsWith('A') ? 'B' : 'A'}`, '1', orderB.id, `${orderedB.number}`,
        ...Array.from({ length: 20 }, () => crypto.randomBytes(18).toString('base64url'))];
      for (const key of tries) {
        const r = await anon.get(`/api/backbone-public/c/status/path?key=${encodeURIComponent(key)}`);
        assert.equal(r.status, 404, key);
        clean(r, 'status');
      }
      const own = await anon.get(`/api/backbone-public/c/status/path?key=${encodeURIComponent(statusTokenB)}`);
      assert.equal(own.status, 200, 'по своей ссылке — путь заявки');
      for (const m of [buyerB, `Позиция ${SECRET}`]) assert.ok(!own.raw.includes(m), `окно статуса без «${m}»`);
    });

    await t.test('ключ гостя: чужой id без подписи или с поддельной подписью — новый гость, разговор B не виден', async () => {
      const real = decodeURIComponent(guestB.jar.get('vesha_guest'));
      const id = real.split('.')[0];
      const mine = await guestB.get(`/api/backbone-public/shops/${B}/assistant`);
      assert.ok(mine.raw.includes(SECRET), 'контроль: свой гость видит свой разговор');
      for (const forged of [id, `${id}.${'0'.repeat(64)}`, `${id}.${crypto.createHmac('sha256', 'dev-session-secret-change-me').update(id).digest('hex')}`]) {
        if (forged === real) continue; // секрет теста — по умолчанию: такую подпись проверяет refuseWeakSecret ниже
        const r = await anon.get(`/api/backbone-public/shops/${B}/assistant`, { headers: { cookie: `vesha_guest=${encodeURIComponent(forged)}` } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.messages, [], forged);
        assert.ok(r.cookies.some((c) => c.startsWith('vesha_guest=') && !c.includes(id)), 'выдан новый гость');
      }
    });

    await t.test('демо chat-engine Vesha не видит и не правит разговоры магазинов и их персону', async () => {
      const state = await anon.get('/api/chat-engine/state');
      assert.equal(state.status, 200);
      assert.ok(!state.result.dialogues.some((d) => d.channel === 'shop'), 'в демо нет разговоров магазинов');
      clean(state, 'demo state');
      for (const [m, p, body] of [['get', `/dialogues/${dialogB.id}/messages`], ['post', `/dialogues/${dialogB.id}/replies`, { text: 'взлом' }],
        ['post', `/dialogues/${dialogB.id}/stage`, { stage: 'in_work' }], ['post', `/dialogues/${dialogB.id}/card`, { notes: 'взлом', visitorName: 'взлом' }],
        ['post', `/drafts/${draftB.id}/approve`, { text: 'взлом' }], ['post', `/drafts/${draftB.id}/reject`, {}]]) {
        const r = m === 'get' ? await anon.get(`/api/chat-engine${p}`) : await anon.post(`/api/chat-engine${p}`, body);
        assert.ok([404, 409].includes(r.status), `${p}: ${r.status}`);
        clean(r, p);
      }
      assert.equal((await anon.put('/api/chat-engine/persona', { value: `Взлом персоны ${tag}` })).status, 200, 'демо правит свою персону');
      // повтор externalId из разговора магазина: дубль без id чужого разговора
      const [ext] = await sql('SELECT external_id FROM chat_engine_messages WHERE dialogue_id = $1 AND external_id IS NOT NULL', [dialogB.id]);
      assert.ok(ext.external_id.startsWith(`${shopB.id}:`), 'externalId магазина — внутри ключа посетителя');
      const dup = await anon.post('/api/chat-engine/widget/messages', { text: 'дубль', externalId: ext.external_id });
      assert.deepEqual([dup.status, dup.result.duplicate, dup.result.dialogueId], [200, true, undefined]);
      clean(dup, 'widget dup');
    });

    await t.test('данные B после всех атак — те же', async () => {
      assert.equal(await snapshotB(), before);
    });

    await t.test('почта админа (ADMIN_EMAILS) регистрацией не заводится — её не занять раньше админа', async () => {
      for (const email of [adminEmail, ` ${adminEmail.toUpperCase()} `]) {
        const r = await client(base).post('/api/auth/register', { email, password: 'squat-pass-123' });
        assert.equal(r.status, 403, email);
        assert.ok(!r.cookies.some((c) => c.startsWith('vesha_session=')), 'сессии нет');
      }
    });

    await t.test('вход: перебор пароля — после 3 неудач 429 с Retry-After, даже с верным паролем', async () => {
      assert.equal((await client(base).post('/api/auth/register', { email: bruteMail, password: 'right-pass-123' })).status, 201);
      const robot = client(base);
      for (let i = 0; i < 3; i++) assert.equal((await robot.post('/api/auth/login', { email: bruteMail, password: `wrong-${i}` })).status, 401);
      const blocked = await robot.post('/api/auth/login', { email: bruteMail, password: 'right-pass-123' });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.retryAfter) > 0);
      assert.ok(!blocked.cookies.some((c) => c.startsWith('vesha_session=')), 'сессии нет');
    });

    await t.test('cookie: httpOnly и SameSite=Lax; пришли по HTTPS (за прокси) — Secure', async () => {
      const plain = await client(base).get('/api/auth/me');
      const guest = plain.cookies.find((c) => c.startsWith('vesha_guest='));
      assert.match(guest, /HttpOnly/i);
      assert.match(guest, /SameSite=Lax/i);
      assert.doesNotMatch(guest, /Secure/i, 'по http — без Secure, иначе локально вход не работает');
      const https = await client(base, { 'X-Forwarded-Proto': 'https' }).post('/api/auth/login', { email: staffMail, password: staffPass });
      assert.equal(https.status, 200, https.error);
      for (const c of https.cookies) assert.match(c, /;\s*Secure/i, c);
    });
  } finally {
    server.close();
    await db.query("UPDATE chat_engine_settings SET value = $1 WHERE key = 'persona'", [demoPersona]);
    for (const slug of [A, B]) {
      const [shop] = await sql('SELECT id FROM backbone_shops WHERE slug = $1', [slug]);
      if (!shop) continue;
      await db.query('DELETE FROM chat_engine_dialogues WHERE visitor_key LIKE $1', [`${shop.id}:%`]);
      await db.query('DELETE FROM journal_events WHERE scope = $1', [String(shop.id)]);
      await db.query('DELETE FROM backbone_shops WHERE id = $1', [shop.id]);
    }
    await db.query("DELETE FROM chat_engine_dialogues WHERE channel = 'web' AND visitor_key = ANY($1)", [[...seenGuests]]);
    await db.query('DELETE FROM users WHERE email = ANY($1)', [[staffMail, bruteMail]]);
    if (seenGuests.size) await db.query('DELETE FROM guests WHERE id = ANY($1::uuid[])', [[...seenGuests]]).catch(() => {});
    fs.rmSync(process.env.BACKBONE_MAIL_DIR, { recursive: true, force: true });
  }
});

test('shop build refuses to start in production with a missing or short SESSION_SECRET', () => {
  const { refuseWeakSecret } = require('../shop');
  assert.throws(() => refuseWeakSecret({ NODE_ENV: 'production' }), /SESSION_SECRET/);
  assert.throws(() => refuseWeakSecret({ NODE_ENV: 'production', SESSION_SECRET: 'dev-session-secret-change-me' }), /короче 32/);
  assert.doesNotThrow(() => refuseWeakSecret({ NODE_ENV: 'production', SESSION_SECRET: crypto.randomBytes(32).toString('hex') }));
  assert.doesNotThrow(() => refuseWeakSecret({ NODE_ENV: 'development' }), 'локально — без требования');
});

test('rate window: N per window per key, a full window refuses until the oldest mark expires', () => {
  const { RateWindow } = require('../server/services/rateWindow');
  let now = 0;
  const w = new RateWindow({ max: 2, windowMs: 1000, maxKeys: 3, clock: () => now });
  assert.equal(w.take('a'), true);
  assert.equal(w.take('a'), true);
  assert.equal(w.take('a'), false);
  assert.equal(w.take('b'), true, 'ключи независимы');
  assert.equal(w.retryAfterSec('a'), 1);
  now = 1000;
  assert.equal(w.take('a'), true, 'окно сдвинулось');
  for (const k of ['c', 'd', 'e']) w.hit(k);
  now = 5000;
  w.hit('f');
  assert.deepEqual([...w.hits.keys()], ['f'], 'ключи без свежих отметок вычищены');
  w.reset('f');
  assert.equal(w.full('f'), false);
});
