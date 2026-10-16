// Дверь территории костяка (П28): снаружи — сценарии магазина, механику
// собирает сама. Заявки и доска меняются только отсюда; правило доски — Board,
// правило пути — Path, истина — репозиторий, события — журнал (О15).
//
// Шаг 1 MVP (docs/backbone-architecture.md §10): заявку создают вручную, проводят
// по колонкам; доску правят конструктором; всё — события журнала.

const { Order } = require('./orders/Order');

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

class BackboneDesk {
  constructor({ repository, journal, board, path, templateOf, shops }) {
    this.repository = repository;
    this.journal = journal;
    this.boardRule = board;
    this.path = path;
    this.templateOf = templateOf;
    this.shops = shops; // slug → { name, niche }: магазины, которые костяк знает
  }

  // Магазин по slug; при первом обращении — с доской из шаблона ниши.
  async shop(slug, actor = 'system') {
    const known = await this.repository.shopBySlug(slug);
    if (known) return known;
    const spec = this.shops[slug];
    if (!spec) throw notFound(`Магазин не найден: ${slug}`);
    const columns = this.boardRule.check(this.templateOf(spec.niche));
    return this.repository.createShop({ slug, name: spec.name, niche: spec.niche }, columns, (shop) => [{
      stream: 'board', scope: shop.id, subjectId: shop.id, type: 'board_created',
      data: { niche: spec.niche, columns: columns.map((c) => c.id) }, actor, cause: 'template',
    }]);
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
    return this.repository.createOrder(shop.id, inbox.id, { ...draft, channel: 'manual' }, (order) => [{
      stream: 'order', scope: shop.id, subjectId: order.id, type: 'received',
      data: { number: order.number, column: inbox.id, columnType: inbox.type, channel: order.channel },
      actor, cause: 'manual',
    }]);
  }

  async moveOrder(slug, orderId, to, { actor, cause = 'manual' } = {}) {
    const { shop, columns } = await this.board(slug);
    const order = await this.repository.orderById(orderId);
    if (!order || order.shop_id !== shop.id) throw notFound('Заявка не найдена');
    const from = columns.find((c) => c.id === order.column_id);
    const move = this.path.transition(from, columns.find((c) => c.id === to));
    return this.repository.moveOrder(order.id, order.column_id, to, [{
      stream: 'order', scope: shop.id, subjectId: order.id, type: move.type,
      data: { number: order.number, ...move.data }, actor, cause,
    }]);
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
    const order = await this.repository.orderById(orderId);
    if (!order || order.shop_id !== shop.id) throw notFound('Заявка не найдена');
    return { order, events: await this.journal.forSubject('order', order.id) };
  }
}

module.exports = { BackboneDesk };
