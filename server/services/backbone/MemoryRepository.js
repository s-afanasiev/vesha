// Честный простой узел (О6): контракт BackboneRepository в памяти — для тестов
// и прогона без базы. Те же отказы, что у Postgres: версия доски, перенос из
// чужой колонки, колонка с карточками не удаляется.

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
  }

  async shopBySlug(slug) {
    const shop = this.shops.find((s) => s.slug === slug);
    return shop ? { ...shop } : null;
  }

  async createShop({ slug, name, niche }, columns, makeEvents) {
    const existing = await this.shopBySlug(slug);
    if (existing) return existing;
    const shop = { id: crypto.randomUUID(), slug, name, niche, tz: 'Europe/Moscow', board_version: 1, created_at: new Date().toISOString() };
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
    const now = new Date().toISOString();
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
    order.updated_at = new Date().toISOString();
    await this.journal.appendIn(null, events);
    return { ...order };
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
