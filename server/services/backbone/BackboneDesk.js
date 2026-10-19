// Дверь территории костяка (П28): снаружи — сценарии магазина, механику
// собирает сама. Заявки и доска меняются только отсюда; правило доски — Board,
// правило пути — Path, истина — репозиторий, события — журнал (О15).
//
// Шаг 1 MVP (docs/backbone-architecture.md §10): заявку создают вручную, проводят
// по колонкам; доску правят конструктором; всё — события журнала.
// Шаг 2: заявку разбирает инструмент слота (OrderToInvoice) в черновик счёта;
// менеджер правит строки, правка рождает синоним; parsed, draft_ready,
// parse_failed, reviewed — события того же журнала.
// Шаг 3: режим магазина — тень (черновик скрыт, итоговый счёт из 1С прикладывают
// для сверки) или помощь (черновик → xlsx для 1С → «счёт отправлен»); смена
// режима — решение с мерой (Baseline); замеры читаются из журнала (Measures).
// Шаг 4: витрина — заявка с сайта (SiteIntake: контакт, согласие, тот же список
// дважды — одна заявка), окно статуса по ссылке (StatusPage, stages@1), квитанции
// клиенту — проекция журнала в исходящие (Receipts) после каждого перехода.
// Шаг 5: ассистент — заявка из разговора (receiveFromChat: тот же ключ «контакт +
// содержимое», что у сайта) и заявки собеседника по ключу клиента (clientOrders, О20).
// Шаг 6 (то, что решается кодом): магазины — таблица, а не код; админ заводит
// магазин из кабинета (ShopForm), новый — в тени. Каталог магазина — его выгрузка
// xlsx (CatalogFile): файл → сопоставление колонок → подмена целиком только при
// успешном чтении (О17). Инструмент разбора строится на каталоге магазина (toolOf).
// Сотрудники магазина: админ добавляет почту магазину, сотрудник входит обычной
// регистрацией и видит только свой магазин; кто куда входит — правило ShopAccess.
// Тумблер разбора (18.10.2026): «Выключен» (off — только доска), «Сравнение» (shadow —
// помощник разбирает тихо, черновик — после счёта менеджера), «Помощь» (help — черновик
// сразу). «Помощь» без набранной меры — подтверждением (решение пользователя). Карточка
// заявки «две колонки» — orderCard: текст покупателя и как понял помощник.

const { Order } = require('./orders/Order');
const { Synonyms } = require('./catalog/Synonyms');
const { anchorText, pairByPlace } = require('./invoice/RequestText');
const { sameLine } = require('./invoice/FinalInvoice');
const crypto = require('node:crypto');

// Положения тумблера разбора: id — в таблице магазинов и событиях mode_changed.
const MODES = ['off', 'shadow', 'help'];
const ALREADY = { off: 'Разбор уже выключен', shadow: 'Сравнение уже идёт', help: 'Помощь уже включена' };
const ms = (at) => new Date(at).getTime(); // pg отдаёт Date, двойник — строку ISO

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

// «Помощь» без набранной меры: не запрет, а вопрос — включить всё равно (confirm).
function unmeasured(reason) {
  const err = new Error(`Мера для «Помощи» ещё не набрана: ${reason}. Включить всё равно? Замер «до» останется неполным.`);
  err.status = 409;
  err.warn = true;
  return err;
}

// Отказ во входе — вердикт ShopAccess: 401 без входа, 403 — не ваш магазин.
function refused({ status, reason }) {
  const err = new Error(reason);
  err.status = status;
  return err;
}

class BackboneDesk {
  constructor({
    repository, journal, board, path, templateOf, shops = {}, tool = null, toolOf = null, llm = null,
    measuresOf = null, baseline = null, clock = () => new Date(),
    intake = null, statusPage = null, receipts = null, privacy = null,
    shopForm = null, catalogs = null, catalogFile = null, access = null, autoParse = false,
  }) {
    this.repository = repository;
    this.journal = journal;
    this.boardRule = board;
    this.path = path;
    this.templateOf = templateOf;
    this.shops = shops; // посев: slug → { name, niche, hours, mode, shadowDays } — демо-магазин из кода
    this.toolOf = toolOf || (async () => tool); // магазин → инструмент слота на его каталоге
    this.llm = llm;     // модель — только по кнопке «Распознать нейросетью»: forActor(user)
    this.autoParse = autoParse; // механика разбирает заявку сразу при поступлении (без модели — бесплатно)
    this.shopForm = shopForm;       // форма магазина из кабинета
    this.catalogs = catalogs;       // каталоги магазинов по версии выгрузки
    this.catalogFile = catalogFile; // чтение выгрузки xlsx
    this.access = access;           // кто входит: админ — все магазины, сотрудник — свой
    this.measuresOf = measuresOf; // (магазин, его описание) → Measures в часах работы магазина
    this.baseline = baseline;     // правило тени и включения помощи
    this.clock = clock;
    this.intake = intake;         // приём заявки с витрины
    this.statusPage = statusPage; // окно статуса клиента
    this.receipts = receipts;     // квитанции: проекция журнала и доставка
    this.privacy = privacy;       // политика ПДн витрины: { keepYears, withdrawDays }
  }

  // Магазин по slug — из таблицы; посев из кода (демо) заводится при первом обращении.
  async shop(slug, actor = 'system') {
    const known = await this.repository.shopBySlug(String(slug));
    if (known) return known;
    const spec = this.shops[slug];
    if (!spec) throw notFound(`Магазин не найден: ${slug}`);
    return this.open({
      slug, name: spec.name, niche: spec.niche, mode: spec.mode || 'shadow',
      hours: spec.hours || null, replyTo: spec.replyTo || null, shadowDays: spec.shadowDays ?? null,
    }, actor, { exists: 'return' });
  }

  // Магазин с доской из шаблона ниши; из кабинета — ещё и событие shop_opened.
  async open(fields, actor, { exists, cabinet = false }) {
    const columns = this.boardRule.check(this.templateOf(fields.niche));
    return this.repository.createShop(fields, columns, (shop) => [
      {
        stream: 'board', scope: shop.id, subjectId: shop.id, type: 'board_created',
        data: { niche: fields.niche, columns: columns.map((c) => c.id) }, actor, cause: 'template',
      },
      ...(cabinet ? [{
        stream: 'shop', scope: shop.id, subjectId: shop.id, type: 'shop_opened',
        data: { slug: fields.slug, name: fields.name, niche: fields.niche, mode: fields.mode, hours: fields.hours, replyTo: fields.replyTo },
        actor, cause: 'cabinet',
      }] : []),
    ], { exists });
  }

  // ---------- шаг 6: магазин из кабинета ----------

  // Все магазины; посевы, которых ещё нет в таблице, заводятся тут же.
  async shopList() {
    for (const slug of Object.keys(this.shops)) await this.shop(slug);
    return this.repository.shops();
  }

  // Новый магазин — без правки кода: адрес, название, ниша, часы, почта; режим — тень (база «до»).
  async openShop(fields, actor) {
    const form = this.shopForm.create(fields);
    if (this.shops[form.slug]) throw conflict(`Адрес магазина «${form.slug}» уже занят`);
    return this.open({ ...form, mode: 'shadow' }, actor, { exists: 'fail', cabinet: true });
  }

  // Правка из кабинета: название, часы, почта для квитанций. Адрес, ниша и режим — не здесь.
  async changeShop(slug, fields, actor) {
    const shop = await this.shop(slug);
    const next = this.shopForm.change(fields, shop);
    return this.repository.updateShop(shop.id, next, [{
      stream: 'shop', scope: shop.id, subjectId: shop.id, type: 'shop_changed',
      data: { name: next.name, hours: next.hours, replyTo: next.replyTo }, actor, cause: 'cabinet',
    }]);
  }

  // ---------- сотрудники магазина: кабинет только своего магазина ----------

  isSeed(slug) {
    return Object.hasOwn(this.shops, slug);
  }

  // Вход в магазин — вердикт ShopAccess до чтения данных магазина: без входа — 401,
  // чужой магазин и демо не админу — 403 (существование адреса не выдаём); админу
  // неизвестный адрес — 404, посев заводится здесь же.
  async enter(slug, user) {
    const email = this.access.emailOf(user);
    const known = email && !this.access.isAdmin(user) ? await this.repository.shopBySlug(String(slug)) : null;
    const verdict = this.access.shop(user, {
      seed: this.isSeed(slug),
      staff: Boolean(known && await this.repository.isStaff(known.id, email)),
    });
    if (!verdict.ok) throw refused(verdict);
    return this.shop(slug);
  }

  // Любой адрес кабинета — только после входа.
  signedIn(user) {
    const verdict = this.access.signedIn(user);
    if (!verdict.ok) throw refused(verdict);
    return verdict;
  }

  // Экран «Магазины» — только админ.
  enterCabinet(user) {
    const verdict = this.access.cabinet(user);
    if (!verdict.ok) throw refused(verdict);
    return verdict;
  }

  // Магазины в шапке кабинета: админу — все, сотруднику — его магазины без посева.
  async shopsFor(user) {
    const verdict = this.signedIn(user);
    if (verdict.role === 'admin') return { admin: true, shops: await this.shopList() };
    const own = await this.repository.shopsOfStaff(this.access.emailOf(user));
    return { admin: false, shops: own.filter((s) => !this.isSeed(s.slug)) };
  }

  async staffList() {
    return this.repository.staff();
  }

  staffEvent(shop, type, email, actor) {
    return { stream: 'shop', scope: shop.id, subjectId: shop.id, type, data: { email }, actor, cause: 'cabinet' };
  }

  // Админ добавляет почту сотрудника магазину; сотрудник регистрируется с ней сам.
  async addStaff(slug, rawEmail, actor) {
    const shop = await this.shop(slug);
    if (this.isSeed(shop.slug)) throw bad('Демо-магазин — только для админа: сотрудников у него нет');
    const email = this.shopForm.staffEmail(rawEmail);
    await this.repository.addStaff(shop.id, { email, addedBy: actor }, [this.staffEvent(shop, 'staff_added', email, actor)]);
    return { shop, email };
  }

  // Убранный сотрудник теряет вход сразу: доступ проверяется на каждом запросе.
  async removeStaff(slug, rawEmail, actor) {
    const shop = await this.shop(slug);
    const email = String(rawEmail ?? '').trim().toLowerCase();
    await this.repository.removeStaff(shop.id, email, [this.staffEvent(shop, 'staff_removed', email, actor)]);
    return { shop, email };
  }

  // Описание магазина для замеров: часы и срок тени — из таблицы.
  specOf(shop) {
    return { hours: shop.hours || {}, shadowDays: shop.shadow_days ?? null };
  }

  // ---------- шаг 6: каталог магазина из выгрузки ----------

  async catalogOf(slug) {
    return this.catalogs.of(await this.shop(slug));
  }

  // Витрина: название, часы, группы каталога.
  async storefront(slug) {
    const shop = await this.shop(slug);
    const catalog = await this.catalogs.of(shop);
    return { shop, groups: catalog.groups(), items: catalog.items().length };
  }

  async catalogLoads(slug) {
    const shop = await this.shop(slug);
    return this.repository.catalogLoads(shop.id);
  }

  async pendingCatalog(slug) {
    const shop = await this.shop(slug);
    return this.repository.pendingLoad(shop.id);
  }

  catalogEvent(shop, type, data, actor) {
    return { stream: 'shop', scope: shop.id, subjectId: shop.id, type, data, actor, cause: 'catalog' };
  }

  // Шаг 1 выгрузки: файл → шапка, колонки, догадка «поле ← колонка»; файл ждёт решения.
  // Нечитаемый файл — отказ в истории загрузок; каталог прежний.
  async uploadCatalog(slug, file, actor) {
    const shop = await this.shop(slug);
    let preview;
    try {
      preview = this.catalogFile.preview(await this.catalogFile.grid(file));
    } catch (err) {
      if (!err.refused) throw err;
      const fileName = (file && file.name) || 'без имени';
      await this.repository.refusedLoad(shop.id, { fileName, reason: err.message, actor },
        [this.catalogEvent(shop, 'catalog_refused', { file: fileName, reason: err.message }, actor)]);
      throw bad(err.message);
    }
    await this.repository.savePendingLoad(shop.id, {
      fileName: file.name, file: file.data, headerRow: preview.headerRow, columns: preview.columns, mapping: preview.mapping, rows: preview.rows, actor,
    });
    return { ...preview, fileName: file.name };
  }

  // Шаг 2: админ поправил колонку поля; колонка достаётся одному полю.
  async mapCatalogField(slug, field, column) {
    const shop = await this.shop(slug);
    const load = await this.repository.pendingLoad(shop.id);
    if (!load) throw bad('Сначала загрузите файл выгрузки');
    if (!this.catalogFile.fields.some((f) => f.key === field)) throw bad(`Неизвестное поле каталога: ${field}`);
    const index = this.catalogFile.columnOf(load.columns, column);
    const mapping = { ...load.mapping };
    if (index != null) for (const k of Object.keys(mapping)) if (mapping[k] === index) mapping[k] = null;
    mapping[field] = index;
    await this.repository.setLoadMapping(load.id, mapping);
    return { mapping, column: index == null ? null : load.columns.find((c) => c.index === index) };
  }

  // Шаг 3: выгрузка читается целиком; каталог подменяется только при успехе (О17).
  async commitCatalog(slug, actor) {
    const shop = await this.shop(slug);
    const load = await this.repository.pendingLoad(shop.id, { withFile: true });
    if (!load) throw bad('Нет файла, который ждёт загрузки, — загрузите выгрузку');
    let read;
    try {
      const grid = await this.catalogFile.grid({ name: load.file_name, data: load.file });
      read = this.catalogFile.read(grid, { headerRow: load.header_row, mapping: load.mapping });
    } catch (err) {
      if (err.refused) throw bad(err.message); // не сопоставлено обязательное — файл ждёт правки
      throw err;
    }
    const facts = { rows: read.rows, loaded: read.items.length, rejected: read.rejected, rejects: read.rejects };
    if (!read.ok) {
      await this.repository.noteLoadAttempt(shop.id, load.id, { ...facts, reason: read.reason }, [this.catalogEvent(shop, 'catalog_refused', {
        file: load.file_name, reason: read.reason, loaded: facts.loaded, rejected: facts.rejected,
      }, actor)]);
      return { ok: false, reason: read.reason, ...facts };
    }
    const next = await this.repository.replaceCatalog(shop.id, load.id, { items: read.items, ...facts }, [this.catalogEvent(shop, 'catalog_loaded', {
      file: load.file_name, loaded: facts.loaded, rejected: facts.rejected, groups: read.groups, version: (shop.catalog_version || 0) + 1,
    }, actor)]);
    return { ok: true, version: next.catalog_version, ...facts };
  }

  async board(slug) {
    const shop = await this.shop(slug);
    return { shop, version: shop.board_version, columns: await this.repository.columns(shop.id) };
  }

  async columns(slug) {
    return (await this.board(slug)).columns;
  }

  async orders(slug) {
    const shop = await this.shop(slug);
    return this.repository.orders(shop.id);
  }

  async createOrder(slug, fields, actor) {
    const draft = Order.draft(fields || {});
    const { shop, columns } = await this.board(slug);
    const inbox = columns.find((c) => c.type === 'inbox');
    const order = await this.repository.createOrder(shop.id, inbox.id, { ...draft, channel: 'manual' }, (o) => [{
      stream: 'order', scope: shop.id, subjectId: o.id, type: 'received',
      data: { number: o.number, column: inbox.id, columnType: inbox.type, channel: o.channel, org: Order.fromOrganization(o.client) },
      actor, cause: 'manual',
    }]);
    await this.parseOnArrival(shop, order);
    return order;
  }

  // Механический разбор сразу при поступлении (решение пользователя 19.10.2026): без
  // модели и бесплатно; в «Помощи» менеджер открывает готовый черновик, в «Сравнении»
  // разбор идёт тихо. Сбой разбора не роняет приём заявки (П35) — только в лог.
  async parseOnArrival(shop, order) {
    if (!this.autoParse || shop.mode === 'off') return;
    try {
      await this.parseOrder(shop.slug, order.id, { actor: 'helper', cause: 'auto' });
    } catch (err) {
      console.error('backbone: заявка не разобрана при поступлении', err);
    }
  }

  async moveOrder(slug, orderId, to, { actor, cause = 'manual' } = {}) {
    const { shop, columns } = await this.board(slug);
    const order = await this.repository.orderById(orderId);
    if (!order || order.shop_id !== shop.id) throw notFound('Заявка не найдена');
    const from = columns.find((c) => c.id === order.column_id);
    const move = this.path.transition(from, columns.find((c) => c.id === to));
    const moved = await this.repository.moveOrder(order.id, order.column_id, to, [{
      stream: 'order', scope: shop.id, subjectId: order.id, type: move.type,
      data: { number: order.number, ...move.data }, actor, cause,
    }]);
    await this.afterChange(shop);
    return moved;
  }

  // ---------- шаг 4: витрина, окно статуса, квитанции ----------

  // Заявка с сайта: форма → заявка во «входящих» с ссылкой на окно статуса.
  // Тот же список с того же контакта ещё раз — та же заявка и событие received_again
  // (клиенту — без второй квитанции, менеджеру — письмо: клиент ждёт или заказывает снова).
  // clientKey — гость витрины: по нему ассистент узнаёт заявки собеседника (шаг 5).
  async receiveFromSite(slug, form, file = null, { clientKey = null } = {}) {
    const read = await this.intake.read(form, file); // форма проверяется до базы: отказ — сразу
    return this.receive(slug, read, { channel: 'site', clientKey });
  }

  // Заявка из разговора с ассистентом (шаг 5): список, согласие и контакт прочитал ChatIntake.
  async receiveFromChat(slug, read, { clientKey, dialogueId }) {
    return this.receive(slug, read, { channel: 'chat', clientKey, data: { dialogue: dialogueId } });
  }

  // Приём из канала: заявка во «входящих» со ссылкой на окно статуса. Тот же список
  // с того же контакта ещё раз — из любого канала — та же заявка и событие received_again (П36).
  async receive(slug, read, { channel, clientKey = null, data = {} }) {
    const { shop, columns } = await this.board(slug);
    const again = async (order) => {
      await this.repository.appendEvents([{
        stream: 'order', scope: shop.id, subjectId: order.id, type: 'received_again',
        data: { number: order.number, channel, ...data }, actor: channel, cause: channel,
      }]);
      await this.afterChange(shop);
      return { order, duplicate: true };
    };
    const known = await this.repository.orderByContentKey(shop.id, read.contentKey);
    if (known) return again(known);
    const inbox = columns.find((c) => c.type === 'inbox');
    let order;
    try {
      order = await this.repository.createOrder(shop.id, inbox.id, {
        ...read.draft,
        statusToken: crypto.randomBytes(18).toString('base64url'),
        contentKey: read.contentKey,
        consentAt: this.clock().toISOString(),
        clientKey,
      }, (o) => [{
        stream: 'order', scope: shop.id, subjectId: o.id, type: 'received',
        data: {
          number: o.number, column: inbox.id, columnType: inbox.type, channel,
          contact: read.contact.kind, org: Order.fromOrganization(o.client),
          ...(read.refusal ? { refusal: read.refusal.code, file: read.refusal.file } : {}),
          ...data,
        },
        actor: channel, cause: channel,
      }]);
    } catch (err) {
      if (err.code !== '23505') throw err;
      return again(await this.repository.orderByContentKey(shop.id, read.contentKey)); // гонка двух одинаковых отправок
    }
    await this.parseOnArrival(shop, order);
    await this.afterChange(shop);
    return { order, duplicate: false, refusal: read.refusal };
  }

  // Заявки собеседника (О20) — дверь, а не фильтр в промпте: только по ключу клиента,
  // каждая — с шагом окна статуса и ссылкой на него. Чужой номер сюда не попадает.
  async clientOrders(slug, clientKey) {
    if (!clientKey) return [];
    const shop = await this.shop(slug);
    const orders = await this.repository.ordersOfClient(shop.id, String(clientKey));
    if (!orders.length) return [];
    const columns = await this.repository.columns(shop.id);
    const out = [];
    for (const order of orders) {
      const view = this.statusPage.view({ order, columns, events: await this.journal.forSubject('order', order.id), shopName: shop.name });
      const step = view.exit || view.steps.find((s) => s.state === 'current') || view.steps[0];
      out.push({ number: order.number, step: step.name, note: step.note || null, at: step.at || null, token: order.status_token });
    }
    return out;
  }

  // Окно статуса по токену ссылки: шаги, даты, номер — без контактов и текста.
  async statusOf(token) {
    const order = token ? await this.repository.orderByToken(String(token)) : null;
    if (!order) throw notFound('Заявка не найдена — проверьте ссылку');
    const shop = await this.repository.shopById(order.shop_id);
    return this.statusPage.view({
      order,
      columns: await this.repository.columns(shop.id),
      events: await this.journal.forSubject('order', order.id),
      shopName: shop.name,
    });
  }

  // Политика обработки персональных данных витрины (152-ФЗ): кто обрабатывает, сроки,
  // почта для отзыва согласия — из таблицы магазинов; контактов клиентов здесь нет.
  async privacyOf(slug) {
    const shop = await this.shop(slug);
    return { name: shop.name, email: shop.reply_to || null, ...this.privacy };
  }

  async receiptsOf(slug) {
    const shop = await this.shop(slug);
    return this.repository.receipts(shop.id);
  }

  // Проекция журнала в квитанции и доставка ожидающих; кнопка в кабинете — то же самое.
  async sendReceipts(slug) {
    const shop = await this.shop(slug);
    const made = await this.receipts.project(shop, await this.repository.columns(shop.id));
    const delivery = await this.receipts.deliver((id) => this.repository.shopById(id));
    return { made, ...delivery };
  }

  // После перехода: квитанции не должны ронять сам переход (П35) — сбой только в лог.
  async afterChange(shop) {
    if (!this.receipts) return;
    try {
      await this.receipts.project(shop, await this.repository.columns(shop.id));
      await this.receipts.deliver((id) => this.repository.shopById(id));
    } catch (err) {
      console.error('backbone: квитанции не обработаны', err);
    }
  }

  // Операция конструктора: правило — Board, атомарность и версия — репозиторий.
  async configure(slug, op, actor) {
    const { shop, version, columns } = await this.board(slug);
    const counts = {};
    for (const o of await this.repository.orders(shop.id)) counts[o.column_id] = (counts[o.column_id] || 0) + 1;
    const next = this.boardRule.apply(columns, op, counts);
    const byId = new Map(columns.map((c) => [c.id, c]));
    await this.repository.saveBoard(
      shop.id, version, next.columns, next.moves,
      [{ stream: 'board', scope: shop.id, subjectId: shop.id, ...next.event, actor, cause: 'configure' }],
      (order, move) => ({
        stream: 'order', scope: shop.id, subjectId: order.id, type: 'moved',
        data: {
          number: order.number, from: move.from, to: move.to,
          fromType: byId.get(move.from).type, toType: next.columns.find((c) => c.id === move.to).type,
        },
        actor, cause: 'column_removed',
      }),
    );
    return this.repository.columns(shop.id);
  }

  async journalOf(slug, { limit = 200 } = {}) {
    const shop = await this.shop(slug);
    return this.journal.forScope(shop.id, { limit });
  }

  async history(slug, orderId) {
    const shop = await this.shop(slug);
    const order = await this.orderOf(shop, orderId);
    return { order, events: await this.journal.forSubject('order', order.id) };
  }

  async orderOf(shop, orderId) {
    const order = await this.repository.orderById(orderId);
    if (!order || order.shop_id !== shop.id) throw notFound('Заявка не найдена');
    return order;
  }

  // ---------- шаг 2: черновик счёта ----------

  // Разбор заявки инструментом — механический: правила и сопоставление с каталогом, без
  // модели (с 19.10.2026; нейросеть — readByModel, по кнопке). Отказ (скан, пусто, слишком
  // длинно) — результат с именем и событие parse_failed.
  async parseOrder(slug, orderId, { actor, cause = 'tool' } = {}) {
    const shop = await this.shop(slug);
    if (shop.mode === 'off') throw bad('Разбор выключен — включите «Сравнение» или «Помощь» на экране заявок');
    const order = await this.orderOf(shop, orderId);
    const event = (type, data) => ({
      stream: 'order', scope: shop.id, subjectId: order.id, type,
      data: { number: order.number, ...data }, actor, cause,
    });
    const synonyms = new Synonyms(await this.repository.synonyms(shop.id));
    let result;
    const started = performance.now(); // время помощника — настоящее, не часы журнала
    try {
      result = await (await this.toolOf(shop)).run({ text: order.text }, { synonyms });
    } catch (err) {
      if (!err.refusal) throw err;
      await this.repository.appendEvents([event('parse_failed', { code: err.code, reason: err.message })]);
      return { ok: false, number: order.number, code: err.code, message: err.message };
    }
    const { draft, facts, failures } = result;
    await this.repository.saveDraft(shop.id, order.id, draft.lines, [
      event('parsed', {
        source: facts.source, lines: facts.lines, rule: facts.rule, model: facts.model, raw: facts.raw,
        verify: facts.verify, skipped: facts.skipped, modelCalls: facts.modelCalls, failures: failures.map((f) => f.code),
        ms: Math.round(performance.now() - started),
      }),
      event('draft_ready', {
        lines: facts.lines, accepted: facts.accepted, ask: facts.ask, missing: facts.missing,
        questions: facts.questions, sum: facts.sum,
      }),
    ]);
    return { ok: true, number: order.number, summary: facts.summary, failures };
  }

  // «Распознать нейросетью» (по кнопке, решение пользователя 19.10.2026): модель читает
  // заявку целиком от имени того, кто нажал (его квота, П37), её строки проходят то же
  // сопоставление с каталогом. Результат — событие model_parsed рядом с механическим
  // черновиком, а не вместо него. В «Сравнении» — только после счёта менеджера (иначе замер
  // «до» испорчен), и тогда же — сверка с его счётом.
  async readByModel(slug, orderId, { actor, user = null } = {}) {
    const shop = await this.shop(slug);
    if (shop.mode === 'off') throw bad('Разбор выключен — включите «Сравнение» или «Помощь» на экране заявок');
    const order = await this.orderOf(shop, orderId);
    const sent = await this.sentOf(order);
    if (shop.mode === 'shadow' && !sent) throw bad('Сравнение: нейросеть — после вашего счёта, иначе замер «до» испортится');
    if (!this.llm) throw bad('Нейросеть не подключена');
    const tool = await this.toolOf(shop);
    const synonyms = new Synonyms(await this.repository.synonyms(shop.id));
    const started = performance.now();
    let result;
    try {
      result = await tool.run({ text: order.text }, { llm: this.llm.forActor(user), synonyms, whole: true });
    } catch (err) {
      if (err.refusal) throw bad(err.message);
      throw err;
    }
    const { draft, facts, failures } = result;
    if (!facts.model) throw bad(`Нейросеть не ответила: ${failures.map((f) => f.detail).join('; ') || 'пустой ответ'}`);
    const lines = draft.lines.map((l) => ({
      position: l.position, source: l.source, name: l.name, qty: l.qty, unit: l.unit, origin: l.origin, verify: l.verify,
      sku: l.sku, confidence: l.confidence, state: l.state, candidates: l.candidates, invoiceQty: l.invoiceQty, price: l.price, question: l.question,
    }));
    const invoice = sent && sent.data.invoiceLines
      ? tool.compare(lines.map((l) => ({ sku: l.sku, invoice_qty: l.invoiceQty })), sent.data.invoiceLines) : null;
    const data = {
      number: order.number, lines, rule: facts.rule, model: facts.model, raw: facts.raw, verify: facts.verify,
      accepted: facts.accepted, ask: facts.ask, missing: facts.missing, ms: Math.round(performance.now() - started),
      failures: failures.map((f) => f.code),
      ...(invoice ? { invoice: { matched: invoice.matched, base: invoice.base, accuracy: invoice.accuracy } } : {}),
    };
    await this.repository.appendEvents([{ stream: 'order', scope: shop.id, subjectId: order.id, type: 'model_parsed', data, actor, cause: 'model' }]);
    return data;
  }

  // Строки черновиков магазина: новые заявки первыми, внутри — по порядку строк.
  async draftLines(slug) {
    const shop = await this.shop(slug);
    return this.repository.lines(shop.id);
  }

  async synonymsOf(slug) {
    const shop = await this.shop(slug);
    return this.repository.synonyms(shop.id);
  }

  // Заявки со сводкой черновика: сколько строк принято, к выбору, нет в каталоге;
  // последний исход разбора и отправленный счёт — из журнала.
  async drafts(slug) {
    const shop = await this.shop(slug);
    const [orders, lines, events] = await Promise.all([
      this.repository.orders(shop.id),
      this.repository.lines(shop.id),
      this.journal.history(shop.id),
    ]);
    const outcome = new Map(); // заявка → последнее draft_ready | parse_failed
    const sent = new Map();    // заявка → invoice_sent
    for (const e of events) {
      if (e.type === 'draft_ready' || e.type === 'parse_failed') outcome.set(e.subject_id, e);
      if (e.type === 'invoice_sent') sent.set(e.subject_id, e);
    }
    return orders.map((order) => {
      const own = lines.filter((l) => l.order_id === order.id);
      const count = (pred) => own.filter(pred).length;
      return {
        order,
        lines: own.length,
        accepted: count((l) => l.state === 'accepted'),
        ask: count((l) => l.state === 'ask'),
        missing: count((l) => l.state === 'missing'),
        questions: count((l) => l.question),
        reviewed: count((l) => l.review),
        sum: Math.round(own.reduce((s, l) => s + (l.invoice_qty && l.price ? l.invoice_qty * l.price : 0), 0) * 100) / 100,
        outcome: outcome.get(String(order.id)) || null,
        sent: sent.get(String(order.id)) || null,
      };
    }).reverse();
  }

  // Правка менеджера (§6.5 п. 6): принять строки, заменить позицию, исправить количество.
  // Замена и подтверждение кандидата рождают синоним «фраза клиента → позиция».
  async review(slug, lineIds, change = {}, actor) {
    const shop = await this.shop(slug);
    const ids = [...new Set((lineIds || []).map(String))];
    if (!ids.length) throw bad('Не выбрано ни одной строки');
    const lines = await this.repository.linesByIds(ids);
    if (lines.length !== ids.length || lines.some((l) => l.shop_id !== shop.id)) throw notFound('Строка черновика не найдена');
    if (change.verdict !== 'accepted' && lines.length > 1) throw bad('Позицию или количество меняют у одной строки за раз');

    const tool = await this.toolOf(shop);
    const patches = [];
    const synonyms = [];
    const events = [];
    for (const line of lines) {
      const { patch, synonym, data } = this.reviewOf(line, change, tool);
      patches.push({ id: line.id, review: change.verdict, reviewedBy: actor, ...patch });
      if (synonym) synonyms.push({ shopId: shop.id, phrase: Synonyms.phrase(line.name), sku: synonym, example: line.source, createdBy: actor });
      events.push({
        stream: 'order', scope: shop.id, subjectId: line.order_id, type: 'reviewed',
        data: {
          number: line.number, line: line.position, verdict: change.verdict, ...data,
          ...(synonym ? { synonym: Synonyms.phrase(line.name) } : {}), ...(change.via ? { via: change.via } : {}), // via: 'model' — взято у нейросети
        },
        actor, cause: 'review',
      });
    }
    await this.repository.reviewLines(lines.map((l) => l.order_id), patches, synonyms, events);
    return { lines: patches.length, synonyms: synonyms.length };
  }

  // ---------- шаг 3: счёт, тень и помощь, замеры ----------

  async orderLines(shop, order) {
    const lines = (await this.repository.lines(shop.id)).filter((l) => l.order_id === order.id);
    if (!lines.length) throw bad(`Заявка №${order.number} ещё не разобрана`);
    return lines;
  }

  async sentOf(order) {
    return (await this.journal.forSubject('order', order.id)).find((e) => e.type === 'invoice_sent') || null;
  }

  // Строки, которые видит менеджер: черновик открыт в «Помощи»; в «Сравнении» и при
  // выключенном разборе — только у заявок, к которым менеджер уже приложил свой счёт.
  async managerLines(slug) {
    const shop = await this.shop(slug);
    const lines = await this.repository.lines(shop.id);
    if (shop.mode === 'help') return lines;
    const sent = new Set((await this.journal.history(shop.id)).filter((e) => e.type === 'invoice_sent').map((e) => e.subject_id));
    return lines.filter((l) => sent.has(String(l.order_id)));
  }

  // Черновик в работе менеджера — только в «Помощи».
  helpOnly(shop, shadowText) {
    if (shop.mode === 'off') throw bad('Разбор выключен — черновиков нет');
    if (shop.mode === 'shadow') throw bad(`Сравнение: ${shadowText}`);
  }

  // Выгрузка черновика в xlsx для 1С: решение — событие, файл — чистое чтение (invoiceFile).
  async exportInvoice(slug, orderId, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'черновик скрыт — счёт делается в 1С как обычно, потом «Мой счёт готов»');
    const order = await this.orderOf(shop, orderId);
    const file = (await this.toolOf(shop)).exportFile(await this.orderLines(shop, order));
    await this.repository.appendEvents([{
      stream: 'order', scope: shop.id, subjectId: order.id, type: 'invoice_exported',
      data: { number: order.number, lines: file.included, left: file.left, sum: file.sum }, actor, cause: 'export',
    }]);
    return { orderId: order.id, number: order.number, included: file.included, left: file.left, sum: file.sum };
  }

  async invoiceFile(slug, orderId) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'выгрузки черновика нет');
    const order = await this.orderOf(shop, orderId);
    const file = (await this.toolOf(shop)).exportFile(await this.orderLines(shop, order));
    return { buffer: file.buffer, filename: `schet-zayavka-${order.number}.xlsx` };
  }

  // Помощь: счёт ушёл клиенту. Точность — доля строк черновика без правки менеджера.
  async invoiceSent(slug, orderId, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'нажмите «Мой счёт готов» и вставьте свой счёт из 1С — так считается точность черновика');
    const order = await this.orderOf(shop, orderId);
    if (await this.sentOf(order)) throw bad(`Счёт по заявке №${order.number} уже отправлен`);
    const lines = await this.orderLines(shop, order);
    const events = await this.journal.forSubject('order', order.id);
    const lastDraft = events.map((e) => e.type).lastIndexOf('draft_ready');
    const edited = new Set(events.slice(lastDraft + 1)
      .filter((e) => e.type === 'reviewed' && (e.data.verdict === 'edited' || e.data.verdict === 'replaced'))
      .map((e) => e.data.line)).size;
    const right = lines.length - edited;
    const sum = Math.round(lines.reduce((s, l) => s + (l.state === 'accepted' && l.invoice_qty != null && l.price != null ? l.invoice_qty * l.price : 0), 0) * 100) / 100;
    const data = { number: order.number, mode: 'help', source: 'draft', draft: lines.length, edited, right, base: lines.length, accuracy: right / lines.length, sum };
    await this.repository.appendEvents([{ stream: 'order', scope: shop.id, subjectId: order.id, type: 'invoice_sent', data, actor, cause: 'invoice' }]);
    return data;
  }

  // Сравнение: «Мой счёт готов» — менеджер вставляет табличную часть своего счёта из 1С;
  // черновик, если его ещё нет, строится тут же — сверка идёт с тем, что инструмент дал
  // бы без человека. Строки счёта — в событии: по ним «глаз» карточки сверяет построчно.
  async attachInvoice(slug, orderId, text, { actor, user = null } = {}) {
    const shop = await this.shop(slug);
    if (shop.mode === 'help') throw bad('Помощь: счёт отмечают кнопкой «Счёт отправлен»');
    if (shop.mode === 'off') throw bad('Разбор выключен — сравнивать не с чем');
    const order = await this.orderOf(shop, orderId);
    if (await this.sentOf(order)) throw bad(`Счёт по заявке №${order.number} уже приложен`);
    const tool = await this.toolOf(shop);
    const final = tool.readInvoice(text);
    if (!final.lines.length) throw bad('В тексте нет строк счёта — вставьте табличную часть счёта из 1С');
    let lines = (await this.repository.lines(shop.id)).filter((l) => l.order_id === order.id);
    if (!lines.length) {
      const parsed = await this.parseOrder(slug, order.id, { actor, user });
      if (!parsed.ok) throw bad(`Черновик не построен: ${parsed.message}`);
      lines = await this.orderLines(shop, order);
    }
    const cmp = tool.compare(lines, final.lines);
    const data = {
      number: order.number, mode: 'shadow', source: 'attached', ...cmp, unknown: final.unknown.length,
      invoiceLines: final.lines.map(({ sku, qty }) => ({ sku, qty })),
    };
    await this.repository.appendEvents([{ stream: 'order', scope: shop.id, subjectId: order.id, type: 'invoice_sent', data, actor, cause: 'invoice' }]);
    return data;
  }

  // Замеры магазина: отчёт из журнала, режим, мера для помощи и последняя смена режима.
  async measures(slug) {
    const shop = await this.shop(slug);
    const spec = this.specOf(shop);
    const measures = this.measuresOf(shop, spec);
    const now = this.clock().getTime();
    const events = await this.journal.history(shop.id);
    const report = measures.report(events, { now, mode: shop.mode });
    const since = new Date(shop.mode_since).getTime();
    const current = measures.metrics(report.cards.filter((c) => c.mode === shop.mode && c.receivedAt >= since), now);
    const shadowDays = spec.shadowDays ?? this.baseline.shadowDays;
    const decision = shop.mode !== 'help' ? this.baseline.decide({ shop, metrics: current, now, shadowDays }) : null;
    const switched = events.filter((e) => e.type === 'mode_changed').pop() || null;
    return {
      shop, report, current, decision, days: this.baseline.daysOf(shop, now), shadowDays, switched, minLines: this.baseline.minLines,
    };
  }

  // Тумблер разбора: «Выключен» и «Сравнение» — всегда (сравнение — новая база «до»);
  // «Помощь» — по мере, а без неё — только подтверждением: событие помечает «без меры».
  async switchMode(slug, to, actor, { confirm = false } = {}) {
    if (!MODES.includes(to)) throw bad(`Неизвестный режим: ${to}`);
    const { shop, current, decision, days } = await this.measures(slug);
    if (shop.mode === to) throw bad(ALREADY[to]);
    if (to === 'help' && !decision.ok && !confirm) throw unmeasured(decision.reason);
    const data = to === 'help'
      ? {
        from: shop.mode, to, reason: decision.reason, snapshot: this.baseline.snapshot(current, days),
        ...(decision.ok ? {} : { unmeasured: true }),
      }
      : { from: shop.mode, to, reason: to === 'shadow' ? 'новая база «до»' : 'разбор выключен: только доска' };
    await this.repository.setMode(shop.id, shop.mode, to, [{
      stream: 'shop', scope: shop.id, subjectId: shop.id, type: 'mode_changed', data, actor, cause: 'decision',
    }]);
    return data;
  }

  // ---------- карточка заявки «две колонки» ----------

  // Слева — текст покупателя целиком, справа — как понял помощник, и где в тексте каждая
  // строка черновика. Черновик виден в «Помощи» и у заявки, к которой менеджер уже
  // приложил свой счёт; в «Сравнении» до счёта строк здесь нет вовсе — замер «до» честный.
  // После счёта — пары «черновик ↔ счёт менеджера» и время: менеджер — рабочие минуты
  // от заявки до счёта, помощник — секунды разбора.
  async orderCard(slug, orderId) {
    const shop = await this.shop(slug);
    const order = await this.orderOf(shop, orderId);
    const [all, events] = await Promise.all([this.repository.lines(shop.id), this.journal.forSubject('order', order.id)]);
    const lines = all.filter((l) => l.order_id === order.id).sort((a, b) => a.position - b.position);
    const last = (type) => events.filter((e) => e.type === type).pop() || null;
    const received = events.find((e) => e.type === 'received') || null;
    const parsed = last('parsed');
    const failed = last('parse_failed');
    const sent = last('invoice_sent');
    const reading = last('model_parsed'); // третья колонка: разбор нейросетью по кнопке
    const visible = shop.mode === 'help' || Boolean(sent);
    const tool = await this.toolOf(shop);
    const text = anchorText(order.text, visible ? lines.map((l) => l.source) : []);
    const shown = visible ? lines.map((l, i) => ({ ...l, anchors: text.anchors[i] })) : [];
    const read = visible && reading ? anchorText(order.text, reading.data.lines.map((l) => l.source)) : null;
    const modelLines = read ? reading.data.lines.map((l, i) => ({ ...l, anchors: read.anchors[i] })) : [];
    const invoiceLines = sent && sent.data.invoiceLines;
    return {
      shop,
      order,
      text: text.lines,
      lines: shown,
      drafted: lines.length > 0,
      failure: failed && (!parsed || ms(failed.at) > ms(parsed.at)) ? failed.data.reason : null,
      sent: sent ? { ...sent.data, at: sent.at } : null,
      pairs: visible && invoiceLines ? tool.pair(lines, invoiceLines) : null,
      managerMinutes: sent && received ? this.measuresOf(shop, this.specOf(shop)).hours.minutes(ms(received.at), ms(sent.at)) : null,
      helperMs: parsed && parsed.data.ms != null ? parsed.data.ms : null,
      // механика справилась плохо — совет распознать нейросетью; варианты строк «выбрать»
      advice: visible && lines.length ? tool.advice(lines) : null,
      choices: new Map(shown.filter((l) => l.state !== 'accepted' && l.origin !== 'raw').map((l) => [l.id, tool.alternatives(l)])),
      reading: read ? { ...reading.data, lines: modelLines, at: reading.at, actor: reading.actor } : null,
      readingPairs: read ? pairByPlace(shown, modelLines) : null,                       // нейросеть ↔ механика на том же месте
      readingInvoice: read && invoiceLines ? tool.pair(modelLines.map((l) => ({ ...l, invoice_qty: l.invoiceQty })), invoiceLines) : null,
    };
  }

  // Строка черновика этой заявки этого магазина — для действий карточки.
  async cardLine(shop, orderId, lineId) {
    const [line] = await this.repository.linesByIds([String(lineId)]);
    if (!line || line.shop_id !== shop.id || String(line.order_id) !== String(orderId)) throw notFound('Строка черновика не найдена');
    return line;
  }

  // Вариант строки «выбрать» (из 3 лучших или «ещё N»): позиция строки — подтверждение
  // (accepted), другой — замена (replaced); оба рождают синоним «фраза клиента → позиция».
  async pickCandidate(slug, orderId, lineId, sku, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'черновик скрыт до вашего счёта');
    const line = await this.cardLine(shop, orderId, lineId);
    const pick = String(sku ?? '').trim();
    const { top, more } = (await this.toolOf(shop)).alternatives(line);
    if (pick !== line.sku && ![...top, ...more].some((c) => c.sku === pick)) throw bad(`«${pick}» — не вариант строки ${line.position}`);
    return this.review(slug, [line.id], pick === line.sku ? { verdict: 'accepted' } : { verdict: 'replaced', sku: pick }, actor);
  }

  // «Спросить клиента» у строки «выбрать»: вопрос из отличия лучших вариантов («какое
  // покрытие — оцинк. или нерж. A2?») — к вопросам строки: карточка заявки и лист
  // «Вопросы и пропуски» выгрузки для 1С. Работа менеджера, не правка черновика.
  async askClient(slug, orderId, lineId, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'черновик скрыт до вашего счёта');
    const line = await this.cardLine(shop, orderId, lineId);
    const { question } = (await this.toolOf(shop)).alternatives(line);
    if (!question) throw bad('Спрашивать не о чем: подходит один вариант');
    if (String(line.question || '').includes(question)) throw bad('Этот вопрос уже в вопросах клиенту');
    await this.repository.setQuestion(line.id, line.question ? `${line.question}; ${question}` : question, [{
      stream: 'order', scope: shop.id, subjectId: line.order_id, type: 'client_asked',
      data: { number: line.number, line: line.position, question }, actor, cause: 'review',
    }]);
    return { question };
  }

  // «Взять как нейросеть»: строка механики на том же месте текста получает позицию и
  // количество из разбора нейросетью — это правка менеджера (replaced / edited, via:
  // 'model'), синоним учит бесплатную механику на следующий раз.
  async takeModelLine(slug, orderId, position, actor) {
    const pair = (await this.modelPairs(slug, orderId)).find((p) => p.line.position === Number(position));
    if (!pair) throw notFound('Строки нейросети нет — обновите карточку');
    const lines = await this.takeOne(slug, pair, actor);
    if (!lines) throw bad('Механика уже поняла эту строку так же');
    return { lines };
  }

  // «Взять всё у нейросети»: каждая строка, где нейросеть нашла позицию иначе, чем механика.
  async takeAllModel(slug, orderId, actor) {
    const pairs = (await this.modelPairs(slug, orderId)).filter((p) => p.line.sku && p.base && !sameLine(p.base, p.line));
    if (!pairs.length) throw bad('Брать нечего: где нейросеть нашла позицию, механика поняла так же');
    let lines = 0;
    for (const p of pairs) lines += await this.takeOne(slug, p, actor);
    return { lines };
  }

  async modelPairs(slug, orderId) {
    const card = await this.orderCard(slug, orderId);
    this.helpOnly(card.shop, 'черновик скрыт до вашего счёта');
    if (card.sent) throw bad(`Счёт по заявке №${card.order.number} уже отправлен`);
    if (!card.reading) throw bad('Нейросеть ещё не читала заявку — нажмите «Распознать нейросетью»');
    return card.readingPairs;
  }

  // пара { line: строка нейросети, base: строка механики } → сколько строк черновика изменилось
  async takeOne(slug, { line, base }, actor) {
    if (!base) throw bad('В механическом черновике этой строки нет — добавьте позицию вручную');
    if (!line.sku) throw bad('Нейросеть тоже не нашла позицию в каталоге');
    let changed = 0;
    if (line.sku !== base.sku) {
      await this.review(slug, [base.id], { verdict: 'replaced', sku: line.sku, via: 'model' }, actor);
      changed = 1;
    }
    const [now] = await this.repository.linesByIds([String(base.id)]);
    if (line.invoiceQty != null && !sameLine(now, line)) {
      await this.review(slug, [base.id], { verdict: 'edited', qty: line.invoiceQty, via: 'model' }, actor);
      changed = 1;
    }
    return changed;
  }

  // «Принять всё зелёное»: строки, которые помощник принял сам, менеджер подтверждает разом.
  async acceptConfident(slug, orderId, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'черновик скрыт до вашего счёта');
    const order = await this.orderOf(shop, orderId);
    const green = (await this.orderLines(shop, order)).filter((l) => l.state === 'accepted' && !l.review);
    if (!green.length) throw bad('Зелёных строк без отметки не осталось');
    return this.review(slug, green.map((l) => l.id), { verdict: 'accepted' }, actor);
  }

  // Правка строки из карточки: замена позиции или количество — та же дверь review.
  async reviseLine(slug, orderId, lineId, change, actor) {
    const shop = await this.shop(slug);
    this.helpOnly(shop, 'черновик скрыт до вашего счёта');
    const line = await this.cardLine(shop, orderId, lineId);
    return this.review(slug, [line.id], change, actor);
  }

  // Решение по одной строке: новые поля, синоним (артикул) или null, данные события.
  reviewOf(line, change, tool) {
    const keep = {
      sku: line.sku, qty: line.qty, unit: line.unit, confidence: line.confidence, state: line.state,
      invoiceQty: line.invoice_qty, price: line.price, question: line.question,
    };
    const revised = (r) => ({ sku: r.sku, qty: r.qty, unit: r.unit, invoiceQty: r.invoiceQty, price: r.price, question: r.question });
    switch (change.verdict) {
      case 'accepted': {
        if (!line.sku) throw bad(`Строка ${line.position}: позиции нет — замените её артикулом`);
        // подтверждённое сомнение — знание магазина; принятое и так — не новость
        return { patch: { ...keep, state: 'accepted' }, synonym: line.state === 'accepted' ? null : line.sku, data: { sku: line.sku } };
      }
      case 'replaced': {
        const raw = String(change.sku ?? '').trim();
        const pick = /^\d{1,2}$/.test(raw) ? (line.candidates[Number(raw) - 1] || {}).sku : raw;
        if (!pick || !tool.item(pick)) throw bad(raw ? `Нет позиции «${raw}» в каталоге` : 'Укажите артикул или номер кандидата');
        return {
          patch: { ...keep, ...revised(tool.revise(line, { sku: pick })), confidence: 1, state: 'accepted' },
          synonym: pick,
          data: { from: line.sku, to: pick },
        };
      }
      case 'edited': {
        const qty = Number(String(change.qty ?? '').replace(',', '.').replace(/\s/g, ''));
        if (!Number.isFinite(qty) || qty <= 0) throw bad('Количество — число больше нуля');
        if (!line.sku) throw bad(`Строка ${line.position}: сначала выберите позицию`);
        return { patch: { ...keep, ...revised(tool.revise(line, { qty })) }, synonym: null, data: { from: line.qty, to: qty } };
      }
      default:
        throw bad(`Неизвестное решение: ${change.verdict}`);
    }
  }
}

module.exports = { BackboneDesk };
