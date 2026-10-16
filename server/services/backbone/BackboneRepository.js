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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NUMERIC приходит из pg строкой — строка черновика наружу уходит с числами.
const num = (v) => (v == null ? null : Number(v));
function lineRow(r) {
  return { ...r, qty: num(r.qty), confidence: num(r.confidence), invoice_qty: num(r.invoice_qty), price: num(r.price) };
}

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

  // ---------- черновик счёта: строки заявки и синонимы (шаг 2) ----------

  async appendEvents(events) {
    return this.tx((client) => this.journal.appendIn(client, events));
  }

  async lines(shopId) {
    const { rows } = await this.db.query(
      `SELECT l.*, o.number FROM backbone_order_lines l JOIN backbone_orders o ON o.id = l.order_id
       WHERE l.shop_id = $1 ORDER BY o.number DESC, l.position`,
      [shopId]
    );
    return rows.map(lineRow);
  }

  async linesByIds(ids) {
    const { rows } = await this.db.query(
      `SELECT l.*, o.number FROM backbone_order_lines l JOIN backbone_orders o ON o.id = l.order_id
       WHERE l.id = ANY($1::uuid[]) ORDER BY o.number, l.position`,
      [ids.filter((id) => UUID.test(id))]
    );
    return rows.map(lineRow);
  }

  async synonyms(shopId) {
    const { rows } = await this.db.query(
      'SELECT * FROM backbone_synonyms WHERE shop_id = $1 ORDER BY updated_at DESC',
      [shopId]
    );
    return rows;
  }

  // Черновик целиком: строки прошлого разбора заменяются, если менеджер их ещё не правил.
  async saveDraft(shopId, orderId, lines, events) {
    return this.tx(async (client) => {
      await client.query('SELECT 1 FROM backbone_orders WHERE id = $1 FOR UPDATE', [orderId]);
      const { rows: [{ reviewed }] } = await client.query(
        'SELECT count(*)::int AS reviewed FROM backbone_order_lines WHERE order_id = $1 AND review IS NOT NULL',
        [orderId]
      );
      if (reviewed) throw conflict('Черновик уже правили — повторный разбор стёр бы правки');
      await client.query('DELETE FROM backbone_order_lines WHERE order_id = $1', [orderId]);
      for (const l of lines) {
        await client.query(
          `INSERT INTO backbone_order_lines (order_id, shop_id, position, source, name, qty, unit, origin, verify,
             sku, confidence, state, candidates, invoice_qty, price, question)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [orderId, shopId, l.position, l.source, l.name, l.qty, l.unit, l.origin, l.verify,
            l.sku, l.confidence, l.state, JSON.stringify(l.candidates || []), l.invoiceQty, l.price, l.question]
        );
      }
      await this.journal.appendIn(client, events);
    });
  }

  // Правка менеджера: строки, синонимы и события — одной транзакцией; заявки
  // блокируются по порядку id, чтобы встречные правки не сцепились.
  async reviewLines(orderIds, patches, synonyms, events) {
    return this.tx(async (client) => {
      for (const id of [...new Set(orderIds)].sort()) {
        await client.query('SELECT 1 FROM backbone_orders WHERE id = $1 FOR UPDATE', [id]);
      }
      for (const p of patches) {
        const { rowCount } = await client.query(
          `UPDATE backbone_order_lines SET sku = $2, qty = $3, unit = $4, confidence = $5, state = $6,
             invoice_qty = $7, price = $8, question = $9, review = $10, reviewed_by = $11, reviewed_at = now()
           WHERE id = $1`,
          [p.id, p.sku, p.qty, p.unit, p.confidence, p.state, p.invoiceQty, p.price, p.question, p.review, p.reviewedBy]
        );
        if (!rowCount) throw conflict('Строка черновика изменилась — обновите черновик');
      }
      for (const s of synonyms) {
        await client.query(
          `INSERT INTO backbone_synonyms (shop_id, phrase, sku, example, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (shop_id, phrase) DO UPDATE
             SET hits = CASE WHEN backbone_synonyms.sku = EXCLUDED.sku THEN backbone_synonyms.hits + 1 ELSE 1 END,
                 sku = EXCLUDED.sku, updated_at = now()`,
          [s.shopId, s.phrase, s.sku, s.example, s.createdBy]
        );
      }
      await this.journal.appendIn(client, events);
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
