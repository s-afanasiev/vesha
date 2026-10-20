const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { Board, STAGE_TYPES } = require('../server/services/backbone/board/Board');
const { templateOf } = require('../server/services/backbone/board/templates');
const { Path } = require('../server/services/backbone/orders/Order');
const { MemoryJournal } = require('../server/services/backbone/orders/Journal');
const { MemoryRepository } = require('../server/services/backbone/MemoryRepository');
const { BackboneDesk } = require('../server/services/backbone/BackboneDesk');
const { ShopForm } = require('../server/services/backbone/shops/ShopForm');
const { ShopAccess } = require('../server/services/backbone/shops/ShopAccess');
const { SiteIntake } = require('../server/services/backbone/site/SiteIntake');
const { StatusPage } = require('../server/services/backbone/site/StatusPage');
const { Receipts } = require('../server/services/backbone/receipts/Receipts');
const { ShopNotice } = require('../server/services/backbone/receipts/ShopNotice');
const { ShopMailboxes } = require('../server/services/backbone/receipts/ShopMailboxes');
const { MailSecret } = require('../server/services/backbone/receipts/MailSecret');
const { SmtpMailbox } = require('../server/services/backbone/receipts/SmtpMailbox');
const { letterOf } = require('../server/services/backbone/receipts/letter');
const { Erasure } = require('../server/services/backbone/privacy/Erasure');
const { Anonymizer, CUT } = require('../server/services/backbone/privacy/Anonymizer');
const { RequestText, PlainText, SheetRows, PdfTextLayer } = require('../server/services/backbone/invoice/RequestText');

// Почта для живых заказчиков (решение пользователя 20.10.2026; docs/backbone-handover.md §4.9,
// «Ответственность за письма»): по умолчанию — общий ящик сервера (наш домен для рассылки),
// по желанию заказчика — свой ящик магазина (только админ, пароль — шифром, включается после
// проверки); в письмах покупателю — только наш текст; не больше N писем на адрес за сутки;
// IP и время отправки у заявки — удаляются вместе с данными покупателя.

const SHOP = 'mail-shop';
const KEY = 'k'.repeat(16) + 'test-key-of-the-server-0123456789';
const ADMIN = { id: 'u-admin', email: 'admin@mail.test' };
const STAFF = { id: 'u-staff', email: 'staff@mail.test' };
const FORM = { name: 'ООО Стройка', contact: 'buyer@example.ru', text: 'Болт М10х50 — 200 шт', consent: 'on' };
const OWN = { host: 'smtp.shop.test', port: '465', username: 'zakaz@shop.test', password: 'app-pass-1', sender: '' };
const silent = { log() {}, error() {} };

function makeDesk({ key = KEY, perAddress = null, failOwn = null } = {}) {
  const clock = { now: new Date('2026-10-20T09:00:00Z') };
  const now = () => new Date(clock.now);
  const journal = new MemoryJournal({ clock: now });
  const repository = new MemoryRepository(journal);
  const shared = { from: 'noreply@send.test', letters: [], async send(m) { this.letters.push(m); return { messageId: 'x' }; } };
  const own = [];          // письма через свой ящик: { letter, settings }
  const opened = [];       // с какими настройками открывали свой ящик (пароль — расшифрованный)
  const mail = new ShopMailboxes({
    shared,
    settingsOf: (id) => repository.shopMailbox(id),
    secret: key ? new MailSecret({ key }) : null,
    open: (settings) => {
      opened.push(settings);
      return { from: settings.from, async send(m) { if (failOwn && failOwn()) throw new Error('SMTP AUTH PLAIN: 535 5.7.8 auth failed'); own.push({ letter: m, settings }); return {}; } };
    },
    log: silent,
  });
  const deadlineOf = () => '20.10 в 13:00';
  const receipts = new Receipts({
    repository, journal, mailbox: mail,
    statusUrl: (t) => `https://shop.test/backbone/status.html?t=${t}`,
    deadlineOf,
    notice: new ShopNotice({ cabinetUrl: (slug) => `https://shop.test/cabinet/?shop=${slug}`, deadlineOf }),
    perAddress, clock: now,
  });
  const erasure = new Erasure({ repository, journal, anonymizer: new Anonymizer(), keepYears: 3, visitorKeyOf: (shop, g) => `${shop.id}:${g}`, mailbox: mail, clock: now });
  const desk = new BackboneDesk({
    repository, journal, board: new Board(), path: new Path(STAGE_TYPES), templateOf,
    shopForm: new ShopForm({ niches: ['hardware'] }),
    access: new ShopAccess({ admins: [ADMIN.email] }),
    intake: new SiteIntake(new RequestText({ text: new PlainText(), xlsx: new SheetRows(), pdf: new PdfTextLayer() })),
    statusPage: new StatusPage(),
    receipts, erasure, mail, clock: now,
    privacy: { keepYears: 3, withdrawDays: 30 },
  });
  return { desk, repository, journal, shared, own, opened, clock };
}

async function withShop(options) {
  const made = makeDesk(options);
  await made.desk.openShop({ slug: SHOP, name: 'Метиз', niche: 'hardware', email: 'zakaz@shop.test' }, 'admin@mail.test');
  return made;
}

const toBuyer = (letters) => letters.filter((m) => m.to === 'buyer@example.ru');

test('mail secret: the password is sealed per shop; another shop, another key or a changed byte — refused, not garbage', () => {
  const secret = new MailSecret({ key: KEY });
  const sealed = secret.seal('пароль-приложения', 'shop-1');
  assert.match(sealed, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
  assert.equal(sealed.includes('пароль'), false);
  assert.notEqual(secret.seal('пароль-приложения', 'shop-1'), sealed, 'новый iv — новый шифр');
  assert.equal(secret.open(sealed, 'shop-1'), 'пароль-приложения');
  assert.throws(() => secret.open(sealed, 'shop-2'), /не расшифровывается/, 'строка другого магазина');
  assert.throws(() => new MailSecret({ key: `${KEY}-другой` }).open(sealed, 'shop-1'), /BACKBONE_MAIL_KEY сменился/);
  const [v, iv, tag, data] = sealed.split(':');
  const flipped = `${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}`;
  assert.throws(() => secret.open([v, iv, tag, flipped].join(':'), 'shop-1'), /не расшифровывается/);
  assert.throws(() => new MailSecret({ key: 'короткий' }), /от 32 знаков/);
});

test('by default letters go from the shared mailbox: «Shop» <noreply@…>, Reply-To — the shop; the sender is kept with the letter', async () => {
  const { desk, shared, own } = await withShop();
  await desk.receiveFromSite(SHOP, FORM);
  assert.deepEqual(shared.letters.map((m) => m.to).sort(), ['buyer@example.ru', 'zakaz@shop.test']);
  assert.equal(own.length, 0);
  const rows = await desk.receiptsOf(SHOP);
  assert.deepEqual(rows.map((r) => [r.status, r.sent_from]), [['sent', 'noreply@send.test'], ['sent', 'noreply@send.test']]);
  const text = letterOf({ from: shared.from, ...shared.letters[0] }).text;
  assert.match(text, /^From: =\?UTF-8\?B\?[^?]+\?= <noreply@send\.test>\r\n/);
  assert.match(text, /\r\nReply-To: <zakaz@shop\.test>\r\n/, 'ответ покупателя — на почту магазина');
  const p = await desk.privacyOf(SHOP);
  assert.deepEqual(p.mail, { own: false, from: 'noreply@send.test' });
});

test('own mailbox — admin only at the door: staff 403, anonymous 401; without the server key it is off', async () => {
  const { desk, repository, journal } = await withShop();
  for (const [who, status] of [[STAFF, 403], [null, 401], [{ id: 'x' }, 401]]) {
    for (const call of [
      () => desk.mailOf(SHOP, who), () => desk.changeMail(SHOP, OWN, who), () => desk.checkMail(SHOP, who), () => desk.dropMail(SHOP, who),
    ]) await assert.rejects(call(), (err) => err.status === status, `${who && who.email}: ${status}`);
  }
  assert.equal(await repository.shopMailbox((await desk.shop(SHOP)).id), null, 'отказ — до записи');
  assert.equal(journal.events.some((e) => e.type.startsWith('mail_')), false);

  const off = await withShop({ key: null });
  await assert.rejects(off.desk.changeMail(SHOP, OWN, ADMIN), /не задан BACKBONE_MAIL_KEY/);
  const view = await off.desk.mailOf(SHOP, ADMIN);
  assert.deepEqual([view.ownAllowed, view.route.own, view.route.from], [false, false, 'noreply@send.test']);
});

test('own mailbox: saved settings send nothing until «Проверить отправку»; the password never leaves sealed', async () => {
  const { desk, repository, journal, shared, own, opened } = await withShop();
  await assert.rejects(desk.changeMail(SHOP, { ...OWN, password: '' }, ADMIN), /обязателен при первой настройке/);
  await assert.rejects(desk.changeMail(SHOP, { ...OWN, host: 'smtp shop' }, ADMIN), /SMTP-сервер/);
  await assert.rejects(desk.changeMail(SHOP, { ...OWN, port: '70000' }, ADMIN), /Порт/);
  const { settings } = await desk.changeMail(SHOP, OWN, ADMIN);
  assert.deepEqual([settings.host, settings.port, settings.username, settings.sender, settings.checked_at], ['smtp.shop.test', 465, 'zakaz@shop.test', 'zakaz@shop.test', null]);
  assert.equal('secret' in settings, false, 'шифр пароля наружу не уходит');
  const row = await repository.shopMailbox((await desk.shop(SHOP)).id);
  assert.match(row.secret, /^v1:/);
  assert.equal(JSON.stringify(row).includes('app-pass-1'), false, 'в базе — только шифр');
  const changed = journal.events.find((e) => e.type === 'mail_changed');
  assert.equal(JSON.stringify(changed).includes('app-pass-1'), false, 'в журнале — без пароля');
  assert.equal(changed.data.password, 'new');

  // не проверен — письма с общего ящика
  await desk.receiveFromSite(SHOP, FORM);
  assert.equal(own.length, 0);
  assert.equal(toBuyer(shared.letters).length, 1);
  const view = await desk.mailOf(SHOP, ADMIN);
  assert.equal(view.route.own, false);
  assert.match(view.route.reason, /не проверен/);
  assert.equal(opened.length, 0, 'ящик магазина даже не открывали');
});

test('a passed check moves the shop letters to its mailbox; changed settings — back to the shared one until checked; failed check and «Вернуть общий ящик»', async () => {
  let fail = false;
  const { desk, shared, own, opened, journal } = await withShop({ failOwn: () => fail });
  await desk.changeMail(SHOP, OWN, ADMIN);
  const check = await desk.checkMail(SHOP, ADMIN);
  assert.equal(check.ok, true);
  assert.equal(own[0].letter.to, 'zakaz@shop.test', 'тестовое письмо — на почту магазина');
  assert.match(own[0].letter.subject, /Проверка почты магазина — Метиз/);
  assert.equal(opened[0].pass, 'app-pass-1', 'пароль расшифрован для отправки');
  assert.equal(opened[0].from, 'zakaz@shop.test');

  const { order } = await desk.receiveFromSite(SHOP, FORM);
  assert.deepEqual(own.slice(1).map((o) => o.letter.to).sort(), ['buyer@example.ru', 'zakaz@shop.test'], 'квитанция и письмо менеджеру — со своего ящика');
  assert.equal(shared.letters.length, 0);
  assert.deepEqual((await desk.receiptsOf(SHOP)).map((r) => r.sent_from), ['zakaz@shop.test', 'zakaz@shop.test']);
  assert.deepEqual((await desk.privacyOf(SHOP)).mail, { own: true, from: 'zakaz@shop.test' });

  // правка — новая версия: до проверки письма снова с общего ящика; пароль прежний
  await desk.changeMail(SHOP, { host: '', port: '587', username: '', password: '', sender: '' }, ADMIN);
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'm' });
  assert.equal(toBuyer(shared.letters).length, 1, '«ждём ответа» — с общего ящика');
  assert.equal(journal.events.filter((e) => e.type === 'mail_changed').pop().data.password, 'kept');

  // проверка не прошла — причина, письма по-прежнему с общего
  fail = true;
  const failed = await desk.checkMail(SHOP, ADMIN);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /535/);
  const view = await desk.mailOf(SHOP, ADMIN);
  assert.equal(view.route.own, false);
  assert.match(view.route.reason, /проверка не прошла: SMTP AUTH PLAIN: 535/);
  fail = false;
  assert.equal((await desk.checkMail(SHOP, ADMIN)).ok, true);
  assert.equal(opened.pop().port, 587, 'проверена новая версия');

  // вернуть общий ящик: настройки и шифр пароля удалены
  await desk.dropMail(SHOP, ADMIN);
  assert.equal((await desk.mailOf(SHOP, ADMIN)).settings, null);
  await assert.rejects(desk.dropMail(SHOP, ADMIN), /Своего ящика у магазина нет/);
  await desk.moveOrder(SHOP, order.id, 'issued', { actor: 'm' });
  assert.equal(toBuyer(shared.letters).length, 2, '«выполнена» — снова с общего ящика');
  assert.deepEqual(journal.events.filter((e) => e.type.startsWith('mail_')).map((e) => [e.type, e.actor]), [
    ['mail_changed', 'admin@mail.test'], ['mail_checked', 'admin@mail.test'], ['mail_changed', 'admin@mail.test'],
    ['mail_checked', 'admin@mail.test'], ['mail_checked', 'admin@mail.test'], ['mail_removed', 'admin@mail.test'],
  ]);
});

test('a check that races a change of settings is refused, the new settings stay unchecked; the key changed — letters fall back to the shared mailbox', async () => {
  const { desk, repository } = await withShop();
  await desk.changeMail(SHOP, OWN, ADMIN);
  const shopId = (await desk.shop(SHOP)).id;
  const seen = await repository.shopMailbox(shopId);
  await desk.changeMail(SHOP, { ...OWN, port: '587' }, ADMIN);
  await assert.rejects(repository.markShopMailbox(shopId, seen.revision, { ok: true }, []), (err) => err.status === 409);
  assert.equal((await repository.shopMailbox(shopId)).checked_at, null);

  // проверенный ящик, а ключ сервера сменился: шифр не открывается — письма идут с общего ящика
  assert.equal((await desk.checkMail(SHOP, ADMIN)).ok, true);
  const other = makeDesk({ key: `${KEY}-новый` });
  const route = other.desk.mail.routeOf({ id: shopId, slug: SHOP }, await repository.shopMailbox(shopId));
  assert.deepEqual([route.own, route.from], [false, 'noreply@send.test']);
  assert.match(route.reason, /BACKBONE_MAIL_KEY сменился/);
});

test('letters to the buyer carry only our text: no column titles, no file name — only the shop name set by the admin', async () => {
  const { desk, shared } = await withShop();
  const SPAM = 'Купите у нас дёшево http://spam.example';
  for (const id of ['invoice', 'issued', 'refused']) await desk.configure(SHOP, { op: 'rename', id, title: SPAM.slice(0, 40) }, 'staff@mail.test');
  const { order } = await desk.receiveFromSite(SHOP, FORM);
  await desk.moveOrder(SHOP, order.id, 'invoice', { actor: 'm' });
  await desk.moveOrder(SHOP, order.id, 'issued', { actor: 'm' });
  const second = await desk.receiveFromSite(SHOP, { ...FORM, text: 'Гайка М10 — 50 шт' });
  await desk.moveOrder(SHOP, second.order.id, 'refused', { actor: 'm' });
  await desk.receiveFromSite(SHOP, { ...FORM, text: '' }, { name: 'Экстремистский текст.jpg', data: Buffer.from('jpeg') });

  const letters = toBuyer(shared.letters);
  assert.deepEqual(letters.map((m) => m.subject.replace(/ —.*$/, '')), [
    'Заявка №1 получена', 'Заявка №1: ждём вашего ответа', 'Заявка №1 выполнена', 'Заявка №2 получена', 'Заявка №2 закрыта', 'Заявка №3 получена',
  ]);
  for (const m of letters) {
    assert.doesNotMatch(`${m.subject}\n${m.body}`, /Купите|spam|Экстремист/, 'ни колонки, ни имени файла');
    assert.match(m.body, /\n\n— Метиз$/, 'подпись — название магазина от админа');
  }
  assert.match(letters[5].body, /Приложенный файл — скан или фото/);
  const manager = shared.letters.find((m) => m.to === 'zakaz@shop.test' && /№3/.test(m.subject));
  assert.match(manager.body, /Экстремистский текст\.jpg/, 'менеджеру — как прислал покупатель: письмо уходит только на почту магазина');
});

test('per address: not more than N letters to the buyer a day; the rest skipped with a reason; another address and the manager are not limited', async () => {
  const { desk, shared, clock } = await withShop({ perAddress: { letters: 3, hours: 24 } });
  const hour = 60 * 60 * 1000;
  const lists = ['Болт М8 — 1 шт', 'Болт М10 — 2 шт', 'Болт М12 — 3 шт', 'Болт М14 — 4 шт', 'Болт М16 — 5 шт'];
  for (const text of lists.slice(0, 2)) await desk.receiveFromSite(SHOP, { ...FORM, text });
  clock.now = new Date(clock.now.getTime() + hour);
  for (const text of lists.slice(2)) await desk.receiveFromSite(SHOP, { ...FORM, text });
  await desk.receiveFromSite(SHOP, { ...FORM, contact: 'other@example.ru', text: 'Шайба — 1 шт' });
  const rows = (await desk.receiptsOf(SHOP)).reverse();
  const client = rows.filter((r) => r.audience === 'client' && r.address === 'buyer@example.ru');
  assert.deepEqual(client.map((r) => r.status), ['sent', 'sent', 'sent', 'skipped', 'skipped']);
  assert.match(client[3].last_error, /на этот адрес за 24 ч уже 3 писем — больше не шлём, чтобы форма витрины не стала рассылкой/);
  assert.equal(toBuyer(shared.letters).length, 3);
  assert.equal(shared.letters.filter((m) => m.to === 'other@example.ru').length, 1, 'другой адрес — свой счёт');
  assert.equal(rows.filter((r) => r.audience === 'shop' && r.status === 'sent').length, 6, 'менеджеру — о каждой заявке');

  // окно сдвинулось: два первых письма вышли из суток, в окне — одно ушедшее и два пропущенных (не в счёт)
  clock.now = new Date(clock.now.getTime() + 23.5 * hour);
  await desk.receiveFromSite(SHOP, { ...FORM, text: 'Болт М20 — 6 шт' });
  await desk.receiveFromSite(SHOP, { ...FORM, text: 'Болт М24 — 7 шт' });
  await desk.receiveFromSite(SHOP, { ...FORM, text: 'Болт М27 — 8 шт' });
  assert.equal(toBuyer(shared.letters).length, 5, 'ещё два письма до лимита, третье — пропущено');
  assert.equal((await desk.receiptsOf(SHOP)).find((r) => r.audience === 'client').status, 'skipped');
});

test('trace: IP and time of each submission from the site and the chat stay with the order and go with the buyer data — by request and by the term', async () => {
  const { desk, journal, clock } = await withShop();
  const { order } = await desk.receiveFromSite(SHOP, FORM, null, { ip: '203.0.113.7' });
  clock.now = new Date(clock.now.getTime() + 60 * 60 * 1000);
  await desk.receiveFromSite(SHOP, FORM, null, { ip: '198.51.100.2' });                 // тот же список ещё раз
  const read = await desk.intake.read({ ...FORM, text: 'Гайка М10 — 50 шт' });           // список из чата — та же форма
  const { order: chat } = await desk.receiveFromChat(SHOP, read, { clientKey: 'guest-1', dialogueId: 'd-1', ip: '192.0.2.9' });
  const manual = await desk.createOrder(SHOP, { client: 'Звонок', contact: '+7 900 000-00-00' }, 'm');

  const ledger = new Map((await desk.customers(SHOP)).map((o) => [o.id, o.sent]));
  assert.deepEqual(ledger.get(order.id).map((s) => [s.at, s.ip]), [['2026-10-20T09:00:00.000Z', '203.0.113.7'], ['2026-10-20T10:00:00.000Z', '198.51.100.2']]);
  assert.deepEqual(ledger.get(chat.id).map((s) => s.ip), ['192.0.2.9']);
  assert.deepEqual(ledger.get(manual.id).map((s) => s.ip), [null], 'заведена вручную — без IP');

  await desk.eraseCustomer(SHOP, [order.id], 'admin@mail.test');
  const events = await journal.forSubject('order', order.id);
  assert.deepEqual(events.filter((e) => e.type.startsWith('received')).map((e) => e.data.ip), [CUT, CUT], 'IP — вместе с данными покупателя');
  assert.equal(JSON.stringify(journal.events).includes('203.0.113.7'), false);
  assert.equal(JSON.stringify(journal.events).includes('192.0.2.9'), true, 'чужая заявка не тронута');

  clock.now = new Date('2029-10-21T09:00:00Z');                                         // срок хранения (3 года) вышел
  await desk.eraseExpired(SHOP, 'system');
  assert.equal(JSON.stringify(journal.events).includes('192.0.2.9'), false, 'по сроку хранения — тоже');
});

// SMTP-приёмник на 127.0.0.1 — как в test/backbone-shops.test.js.
function smtpSink() {
  const letters = [];
  const server = net.createServer((socket) => {
    const letter = { lines: [] };
    let buf = '';
    let data = false;
    socket.write('220 sink.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; letters.push(letter); socket.write('250 2.0.0 queued\r\n'); } else letter.lines.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) socket.write('250-sink.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('AUTH PLAIN ')) { letter.auth = Buffer.from(line.slice(11), 'base64').toString('utf8'); socket.write('235 2.7.0 ok\r\n'); } else if (cmd.startsWith('MAIL FROM:')) { letter.from = line.slice(10); socket.write('250 ok\r\n'); } else if (cmd.startsWith('RCPT TO:')) { letter.to = line.slice(8); socket.write('250 ok\r\n'); } else if (cmd === 'DATA') { data = true; socket.write('354 go\r\n'); } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('502 5.5.2 ?\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, letters, port: server.address().port })));
}

const header = (letter, name) => {
  const line = letter.lines.find((l) => l.toLowerCase().startsWith(`${name}:`));
  return line && line.slice(name.length + 1).trim();
};

test('smtp: the shop with its own mailbox sends from it (its login and password), without — from the shared one', async () => {
  const [sharedSink, ownSink] = await Promise.all([smtpSink(), smtpSink()]);
  try {
    const { desk, repository } = makeDesk();
    const secret = new MailSecret({ key: KEY });
    desk.mail = new ShopMailboxes({
      shared: new SmtpMailbox({ host: '127.0.0.1', port: sharedSink.port, user: 'noreply@send.test', pass: 'общий', from: 'noreply@send.test', timeoutMs: 5000 }),
      settingsOf: (id) => repository.shopMailbox(id),
      secret,
      open: (s) => new SmtpMailbox({ ...s, timeoutMs: 5000 }),
      log: silent,
    });
    desk.receipts.mailbox = desk.mail;
    await desk.openShop({ slug: SHOP, name: 'Метиз', niche: 'hardware', email: 'zakaz@shop.test' }, 'admin');
    await desk.openShop({ slug: 'plain-shop', name: 'Сантехника', niche: 'hardware', email: 'zakaz@plain.test' }, 'admin');
    await desk.changeMail(SHOP, { ...OWN, host: '127.0.0.1', port: String(ownSink.port), password: 'пароль-ящика' }, ADMIN);
    assert.equal((await desk.checkMail(SHOP, ADMIN)).ok, true);
    assert.equal(ownSink.letters.length, 1, 'тестовое письмо — через ящик магазина');

    await desk.receiveFromSite(SHOP, FORM);
    await desk.receiveFromSite('plain-shop', FORM);
    const own = ownSink.letters.slice(1);
    assert.deepEqual(own.map((l) => l.to).sort(), ['<buyer@example.ru>', '<zakaz@shop.test>']);
    for (const l of own) {
      assert.equal(l.from, '<zakaz@shop.test>');
      assert.equal(l.auth, '\0zakaz@shop.test\0пароль-ящика', 'вход в ящик магазина — его логином и расшифрованным паролем');
      assert.match(header(l, 'from'), /<zakaz@shop\.test>$/);
    }
    assert.deepEqual(sharedSink.letters.map((l) => [l.to, l.from, l.auth]).sort(), [
      ['<buyer@example.ru>', '<noreply@send.test>', '\0noreply@send.test\0общий'],
      ['<zakaz@plain.test>', '<noreply@send.test>', '\0noreply@send.test\0общий'],
    ], 'магазин без своего ящика — с общего');
    const toBuyerShared = sharedSink.letters.find((l) => l.to === '<buyer@example.ru>');
    assert.equal(header(toBuyerShared, 'reply-to'), '<zakaz@plain.test>', 'ответ покупателя — на почту магазина');
  } finally {
    sharedSink.server.close();
    ownSink.server.close();
  }
});
