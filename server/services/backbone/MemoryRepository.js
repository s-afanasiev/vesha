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
    this.shops = [];
    this.boards = new Map(); // shopId → колонки
    this.rows = [];           // заявки
    this.draftLines = [];     // строки черновиков
    this.synonymRows = [];    // синонимы магазинов
  }

  async shopBySlug(slug) {
    const shop = this.shops.find((s) => s.slug === slug);
    return shop ? { ...shop } : null;
  }

  async createShop({ slug, name, niche, mode = 'shadow' }, columns, makeEvents) {
    const existing = await this.shopBySlug(slug);
    if (existing) return existing;
    const now = this.journal.now();
    const shop = { id: crypto.randomUUID(), slug, name, niche, tz: 'Europe/Moscow', board_version: 1, mode, mode_since: now, created_at: now };
    this.shops.push(shop);
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

  async createOrder(shopId, columnId, draft, makeEvents) {
    const now = this.journal.now();
    const number = this.rows.filter((o) => o.shop_id === shopId).reduce((m, o) => Math.max(m, o.number), 0) + 1;
    const order = {
      id: crypto.randomUUID(), shop_id: shopId, number, column_id: columnId,
      client: draft.client, contact: draft.contact, text: draft.text, channel: draft.channel || 'manual',
      created_at: now, updated_at: now,
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
    const shop = this.shops.find((s) => s.id === shopId && s.mode === from);
    if (!shop) throw conflict('Режим магазина уже изменился — обновите страницу');
    Object.assign(shop, { mode: to, mode_since: this.journal.now() });
    await this.journal.appendIn(null, events);
    return { ...shop };
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
    const shop = this.shops.find((s) => s.id === shopId);
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
