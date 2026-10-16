// Владелец истины backbone_* (docs/backbone-architecture.md §9): все SQL костяка
// живут здесь. Каждое изменение и его события журнала — одна транзакция: факт
// без события или событие без факта невозможны (О15).
//
// Репозиторий решений не принимает: правила — у Board и Path, сценарии — у
// BackboneDesk. Здесь — атомарность и конкурентность: номер заявки под
// блокировкой магазина, версия доски для конструктора, перенос карточки только
// из той колонки, где её видел пользователь.

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

const COLUMN_SQL = 'SELECT id, title, type, color, wip_limit AS "limit", position FROM backbone_board_columns';

class BackboneRepository {
  constructor(db, journal) {
    this.db = db;
    this.journal = journal;
  }

  async tx(fn) {
    return this.db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23503') throw conflict('Колонка изменилась — обновите доску');
        throw err;
      }
    });
  }

  async shopBySlug(slug) {
    const { rows } = await this.db.query('SELECT * FROM backbone_shops WHERE slug = $1', [slug]);
    return rows[0] || null;
  }

  // Магазин с доской из шаблона; если магазин уже есть — вернуть его как есть.
  async createShop({ slug, name, niche }, columns, makeEvents) {
    return this.tx(async (client) => {
      const inserted = await client.query(
        `INSERT INTO backbone_shops (slug, name, niche) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING RETURNING *`,
        [slug, name, niche]
      );
      if (!inserted.rows[0]) {
        const { rows } = await client.query('SELECT * FROM backbone_shops WHERE slug = $1', [slug]);
        return rows[0];
      }
      const shop = inserted.rows[0];
      await this.writeColumns(client, shop.id, columns);
      await this.journal.appendIn(client, makeEvents(shop));
      return shop;
    });
  }

  async columns(shopId) {
    const { rows } = await this.db.query(`${COLUMN_SQL} WHERE shop_id = $1 ORDER BY position`, [shopId]);
    return rows;
  }

  async orders(shopId) {
    const { rows } = await this.db.query(
      'SELECT * FROM backbone_orders WHERE shop_id = $1 ORDER BY created_at, number',
      [shopId]
    );
    return rows;
  }

  async orderById(id) {
    const { rows } = await this.db.query('SELECT * FROM backbone_orders WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async createOrder(shopId, columnId, draft, makeEvents) {
    return this.tx(async (client) => {
      await client.query('SELECT 1 FROM backbone_shops WHERE id = $1 FOR UPDATE', [shopId]);
      const { rows: [{ next }] } = await client.query(
        'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM backbone_orders WHERE shop_id = $1',
        [shopId]
      );
      const { rows: [order] } = await client.query(
        `INSERT INTO backbone_orders (shop_id, number, column_id, client, contact, text, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [shopId, next, columnId, draft.client, draft.contact, draft.text, draft.channel || 'manual']
      );
      await this.journal.appendIn(client, makeEvents(order));
      return order;
    });
  }

  async moveOrder(orderId, fromColumnId, toColumnId, events) {
    return this.tx(async (client) => {
      const { rows: [order] } = await client.query(
        `UPDATE backbone_orders SET column_id = $3, updated_at = now()
         WHERE id = $1 AND column_id = $2 RETURNING *`,
        [orderId, fromColumnId, toColumnId]
      );
      if (!order) throw conflict('Заявка уже переместилась — обновите доску');
      await this.journal.appendIn(client, events);
      return order;
    });
  }

  // Новая доска целиком: колонки, переносы карточек из удалённых колонок, события.
  // version — та версия доски, которую видел пользователь (оптимистичная блокировка).
  async saveBoard(shopId, version, columns, moves, events, movedEvent) {
    return this.tx(async (client) => {
      const { rows: [shop] } = await client.query(
        'SELECT board_version FROM backbone_shops WHERE id = $1 FOR UPDATE',
        [shopId]
      );
      if (!shop || shop.board_version !== version) throw conflict('Доска изменилась — обновите и повторите');
      await this.writeColumns(client, shopId, columns);
      const moveEvents = [];
      for (const move of moves) {
        const { rows } = await client.query(
          `UPDATE backbone_orders SET column_id = $3, updated_at = now()
           WHERE shop_id = $1 AND column_id = $2 RETURNING id, number`,
          [shopId, move.from, move.to]
        );
        for (const order of rows) moveEvents.push(movedEvent(order, move));
      }
      await client.query(
        'DELETE FROM backbone_board_columns WHERE shop_id = $1 AND NOT (id = ANY($2::text[]))',
        [shopId, columns.map((c) => c.id)]
      );
      await client.query('UPDATE backbone_shops SET board_version = board_version + 1 WHERE id = $1', [shopId]);
      await this.journal.appendIn(client, [...events, ...moveEvents]);
      return version + 1;
    });
  }

  async writeColumns(client, shopId, columns) {
    for (const [position, c] of columns.entries()) {
      await client.query(
        `INSERT INTO backbone_board_columns (shop_id, id, title, type, position, color, wip_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (shop_id, id) DO UPDATE
           SET title = EXCLUDED.title, type = EXCLUDED.type, position = EXCLUDED.position,
               color = EXCLUDED.color, wip_limit = EXCLUDED.wip_limit`,
        [shopId, c.id, c.title, c.type, position, c.color || null, c.limit || null]
      );
    }
  }
}

module.exports = { BackboneRepository };
