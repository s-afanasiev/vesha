// Честный простой узел (О6): контракт BackboneRepository в памяти — для тестов
// и прогона без базы. Те же отказы, что у Postgres: версия доски, перенос из
// чужой колонки, колонка с карточками не удаляется, черновик с правками менеджера
// не перезаписывается повторным разбором.

const crypto = require('node:crypto');

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

class MemoryRepository {
  constructor(journal) {
    this.journal = journal;
    this.shopRows = [];
    this.boards = new Map(); // shopId → колонки
    this.rows = [];           // заявки
    this.draftLines = [];     // строки черновиков
    this.synonymRows = [];    // синонимы магазинов
    this.receiptRows = [];    // исходящие квитанции
    this.items = new Map();   // shopId → позиции каталога
    this.loads = [];          // загрузки выгрузок каталога
    this.loadSeq = 0;
    this.staffRows = [];      // сотрудники магазинов: почта × магазин
  }

  async shopBySlug(slug) {
    const shop = this.shopRows.find((s) => s.slug === slug);
    return shop ? { ...shop } : null;
  }

  async shops() {
    return this.shopRows.map((s) => ({ ...s }));
  }

  async createShop({ slug, name, niche, mode = 'shadow', hours = null, replyTo = null, shadowDays = null }, columns, makeEvents, { exists = 'return' } = {}) {
    const existing = await this.shopBySlug(slug);
    if (existing && exists !== 'return') throw conflict(`Адрес магазина «${slug}» уже занят`);
    if (existing) return existing;
    const now = this.journal.now();
    const shop = {
      id: crypto.randomUUID(), slug, name, niche, tz: 'Europe/Moscow', board_version: 1, mode, mode_since: now, receipts_cursor: 0, created_at: now,
      hours, reply_to: replyTo, shadow_days: shadowDays, catalog_version: 0,
    };
    this.shopRows.push(shop);
    this.boards.set(shop.id, columns.map((c, position) => ({ ...c, position })));
    await this.journal.appendIn(null, makeEvents(shop));
    return { ...shop };
  }

  async columns(shopId) {
    return (this.boards.get(shopId) || []).map((c) => ({ ...c }));
  }

  async orders(shopId) {
    return this.rows.filter((o) => o.shop_id === shopId).map((o) => ({ ...o }));
  }

  async orderById(id) {
    const order = this.rows.find((o) => o.id === id);
    return order ? { ...order } : null;
  }

  async ordersOfClient(shopId, clientKey) {
    return this.rows.filter((o) => o.shop_id === shopId && o.client_key === clientKey)
      .sort((a, b) => b.number - a.number).map((o) => ({ ...o }));
  }

  async createOrder(shopId, columnId, draft, makeEvents) {
    const now = this.journal.now();
    const number = this.rows.filter((o) => o.shop_id === shopId).reduce((m, o) => Math.max(m, o.number), 0) + 1;
    if (draft.contentKey && this.rows.some((o) => o.shop_id === shopId && o.content_key === draft.contentKey)) {
      throw Object.assign(new Error('duplicate content_key'), { code: '23505' }); // как уникальный индекс Postgres
    }
    const order = {
      id: crypto.randomUUID(), shop_id: shopId, number, column_id: columnId,
      client: draft.client, contact: draft.contact, text: draft.text, channel: draft.channel || 'manual',
      status_token: draft.statusToken || null, content_key: draft.contentKey || null, consent_at: draft.consentAt || null,
      client_key: draft.clientKey || null, created_at: now, updated_at: now,
    };
    this.rows.push(order);
    await this.journal.appendIn(null, makeEvents({ ...order }));
    return { ...order };
  }

  async moveOrder(orderId, fromColumnId, toColumnId, events) {
    const order = this.rows.find((o) => o.id === orderId && o.column_id === fromColumnId);
    if (!order) throw conflict('Заявка уже переместилась — обновите доску');
    order.column_id = toColumnId;
    order.updated_at = this.journal.now();
    await this.journal.appendIn(null, events);
    return { ...order };
  }

  async setMode(shopId, from, to, events) {
    const shop = this.shopRows.find((s) => s.id === shopId && s.mode === from);
    if (!shop) throw conflict('Режим магазина уже изменился — обновите страницу');
    Object.assign(shop, { mode: to, mode_since: this.journal.now() });
    await this.journal.appendIn(null, events);
    return { ...shop };
  }

  async updateShop(shopId, { name, hours, replyTo }, events) {
    const shop = this.shopRows.find((s) => s.id === shopId);
    if (!shop) throw conflict('Магазин не найден');
    Object.assign(shop, { name, hours, reply_to: replyTo });
    await this.journal.appendIn(null, events);
    return { ...shop };
  }

  // ---------- сотрудники магазина (025) ----------

  async staff() {
    return this.staffRows.map((r) => {
      const shop = this.shopRows.find((s) => s.id === r.shop_id);
      return { ...r, slug: shop.slug, name: shop.name };
    });
  }

  async isStaff(shopId, email) {
    return this.staffRows.some((r) => r.shop_id === shopId && r.email === email);
  }

  async shopsOfStaff(email) {
    const ids = new Set(this.staffRows.filter((r) => r.email === email).map((r) => r.shop_id));
    return this.shopRows.filter((s) => ids.has(s.id)).map((s) => ({ ...s }));
  }

  async addStaff(shopId, { email, addedBy }, events) {
    if (await this.isStaff(shopId, email)) throw conflict(`${email} уже сотрудник этого магазина`);
    const row = { shop_id: shopId, email, added_by: addedBy, added_at: this.journal.now() };
    this.staffRows.push(row);
    await this.journal.appendIn(null, events);
    return { ...row };
  }

  async removeStaff(shopId, email, events) {
    if (!(await this.isStaff(shopId, email))) throw conflict(`У магазина нет сотрудника ${email} — обновите список`);
    this.staffRows = this.staffRows.filter((r) => !(r.shop_id === shopId && r.email === email));
    await this.journal.appendIn(null, events);
  }

  // ---------- каталог магазина (шаг 6) ----------

  async catalogItems(shopId) {
    return (this.items.get(shopId) || []).map((i) => ({ ...i }));
  }

  async catalogLoads(shopId, { limit = 50 } = {}) {
    return this.loads.filter((l) => l.shop_id === shopId).reverse().slice(0, limit).map(({ file, ...l }) => ({ ...l }));
  }

  async pendingLoad(shopId, { withFile = false } = {}) {
    const load = this.loads.filter((l) => l.shop_id === shopId && l.status === 'pending').pop();
    if (!load) return null;
    const { file, ...rest } = load;
    return withFile ? { ...rest, file } : { ...rest };
  }

  async savePendingLoad(shopId, { fileName, file, headerRow, columns, mapping, rows, actor }) {
    this.loads = this.loads.filter((l) => !(l.shop_id === shopId && l.status === 'pending'));
    const id = String(++this.loadSeq);
    this.loads.push({
      id, shop_id: shopId, status: 'pending', file_name: fileName, file, header_row: headerRow, columns, mapping, rows,
      loaded: 0, rejected: 0, rejects: [], reason: null, actor, created_at: this.journal.now(), decided_at: null,
    });
    return id;
  }

  async setLoadMapping(loadId, mapping) {
    const load = this.loads.find((l) => l.id === loadId && l.status === 'pending');
    if (!load) throw conflict('Загрузка уже решена — загрузите файл заново');
    load.mapping = mapping;
  }

  pending(shopId, loadId) {
    const load = this.loads.find((l) => l.id === loadId && l.shop_id === shopId && l.status === 'pending');
    if (!load) throw conflict('Загрузка уже решена — загрузите файл заново');
    return load;
  }

  async noteLoadAttempt(shopId, loadId, { rows, loaded, rejected, rejects, reason }, events) {
    Object.assign(this.pending(shopId, loadId), { rows, loaded, rejected, rejects, reason });
    await this.journal.appendIn(null, events);
  }

  async replaceCatalog(shopId, loadId, { items, rows, rejected, rejects }, events) {
    Object.assign(this.pending(shopId, loadId), {
      status: 'loaded', file: null, rows, loaded: items.length, rejected, rejects, reason: null, decided_at: this.journal.now(),
    });
    this.items.set(shopId, items.map((i) => ({ ...i, group: i.group || '' })));
    const shop = this.shopRows.find((s) => s.id === shopId);
    shop.catalog_version += 1;
    await this.journal.appendIn(null, events);
    return { ...shop };
  }

  async refusedLoad(shopId, { fileName, reason, actor }, events) {
    const now = this.journal.now();
    this.loads.push({
      id: String(++this.loadSeq), shop_id: shopId, status: 'refused', file_name: fileName, file: null, header_row: null, columns: [], mapping: {},
      rows: 0, loaded: 0, rejected: 0, rejects: [], reason, actor, created_at: now, decided_at: now,
    });
    await this.journal.appendIn(null, events);
  }

  // ---------- витрина и квитанции (шаг 4) ----------

  async shopById(id) {
    const shop = this.shopRows.find((s) => s.id === id);
    return shop ? { ...shop } : null;
  }

  async orderByToken(token) {
    const order = this.rows.find((o) => o.status_token === token);
    return order ? { ...order } : null;
  }

  async orderByContentKey(shopId, key) {
    const order = this.rows.find((o) => o.shop_id === shopId && o.content_key === key);
    return order ? { ...order } : null;
  }

  async receiptsCursor(shopId) {
    const shop = this.shopRows.find((s) => s.id === shopId);
    return shop ? shop.receipts_cursor : 0;
  }

  async saveReceipts(shopId, fromCursor, toCursor, rows) {
    const shop = this.shopRows.find((s) => s.id === shopId);
    if (!shop || shop.receipts_cursor !== fromCursor) return false;
    const now = this.journal.now();
    for (const r of rows) {
      if (this.receiptRows.some((x) => x.event_id === r.eventId)) continue;
      this.receiptRows.push({
        id: crypto.randomUUID(), shop_id: shopId, order_id: r.orderId, event_id: r.eventId, kind: r.kind,
        channel: r.channel, address: r.address, subject: r.subject, body: r.body, status: r.status,
        attempts: 0, last_error: r.lastError, created_at: now, sent_at: null,
      });
    }
    shop.receipts_cursor = toCursor;
    return true;
  }

  async pendingReceipts(maxAttempts, limit) {
    return this.receiptRows
      .filter((r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < maxAttempts))
      .slice(0, limit).map((r) => ({ ...r }));
  }

  async markReceipt(id, { status, error = null }) {
    const r = this.receiptRows.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, { status, attempts: r.attempts + 1, last_error: error, sent_at: status === 'sent' ? this.journal.now() : r.sent_at });
  }

  async receipts(shopId) {
    return this.receiptRows.filter((r) => r.shop_id === shopId)
      .map((r) => ({ ...r, number: (this.rows.find((o) => o.id === r.order_id) || {}).number }))
      .reverse();
  }

  // ---------- черновик счёта (шаг 2): те же отказы, что у Postgres ----------

  async appendEvents(events) {
    await this.journal.appendIn(null, events);
  }

  withNumber(line) {
    const order = this.rows.find((o) => o.id === line.order_id);
    return { ...line, candidates: [...line.candidates], number: order ? order.number : null };
  }

  async lines(shopId) {
    return this.draftLines
      .filter((l) => l.shop_id === shopId)
      .map((l) => this.withNumber(l))
      .sort((a, b) => b.number - a.number || a.position - b.position);
  }

  async linesByIds(ids) {
    const wanted = new Set(ids);
    return this.draftLines.filter((l) => wanted.has(l.id)).map((l) => this.withNumber(l))
      .sort((a, b) => a.number - b.number || a.position - b.position);
  }

  async synonyms(shopId) {
    return this.synonymRows.filter((s) => s.shop_id === shopId).map((s) => ({ ...s }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async saveDraft(shopId, orderId, lines, events) {
    if (this.draftLines.some((l) => l.order_id === orderId && l.review)) {
      throw conflict('Черновик уже правили — повторный разбор стёр бы правки');
    }
    this.draftLines = this.draftLines.filter((l) => l.order_id !== orderId);
    const now = this.journal.now();
    for (const l of lines) {
      this.draftLines.push({
        id: crypto.randomUUID(), order_id: orderId, shop_id: shopId, position: l.position,
        source: l.source, name: l.name, qty: l.qty, unit: l.unit, origin: l.origin, verify: l.verify,
        sku: l.sku, confidence: l.confidence, state: l.state, candidates: [...(l.candidates || [])],
        invoice_qty: l.invoiceQty, price: l.price, question: l.question,
        review: null, reviewed_by: null, reviewed_at: null, created_at: now,
      });
    }
    await this.journal.appendIn(null, events);
  }

  async reviewLines(_orderIds, patches, synonyms, events) {
    const targets = patches.map((p) => this.draftLines.find((l) => l.id === p.id));
    if (targets.some((l) => !l)) throw conflict('Строка черновика изменилась — обновите черновик');
    const now = this.journal.now();
    patches.forEach((p, i) => Object.assign(targets[i], {
      sku: p.sku, qty: p.qty, unit: p.unit, confidence: p.confidence, state: p.state,
      invoice_qty: p.invoiceQty, price: p.price, question: p.question,
      review: p.review, reviewed_by: p.reviewedBy, reviewed_at: now,
    }));
    for (const s of synonyms) {
      const known = this.synonymRows.find((r) => r.shop_id === s.shopId && r.phrase === s.phrase);
      if (known) Object.assign(known, { hits: known.sku === s.sku ? known.hits + 1 : 1, sku: s.sku, updated_at: now });
      else this.synonymRows.push({ shop_id: s.shopId, phrase: s.phrase, sku: s.sku, example: s.example, hits: 1, created_by: s.createdBy, created_at: now, updated_at: now });
    }
    await this.journal.appendIn(null, events);
  }

  async saveBoard(shopId, version, columns, moves, events, movedEvent) {
    const shop = this.shopRows.find((s) => s.id === shopId);
    if (!shop || shop.board_version !== version) throw conflict('Доска изменилась — обновите и повторите');
    const moveEvents = [];
    for (const move of moves) {
      for (const order of this.rows.filter((o) => o.shop_id === shopId && o.column_id === move.from)) {
        order.column_id = move.to;
        moveEvents.push(movedEvent({ id: order.id, number: order.number }, move));
      }
    }
    const ids = new Set(columns.map((c) => c.id));
    if (this.rows.some((o) => o.shop_id === shopId && !ids.has(o.column_id))) {
      throw conflict('Колонка изменилась — обновите доску');
    }
    this.boards.set(shopId, columns.map((c, position) => ({ ...c, position })));
    shop.board_version += 1;
    await this.journal.appendIn(null, [...events, ...moveEvents]);
    return shop.board_version;
  }
}

module.exports = { MemoryRepository };
