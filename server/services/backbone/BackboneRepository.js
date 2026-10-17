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
const LOAD_COLUMNS = 'id, shop_id, status, file_name, header_row, columns, mapping, rows, loaded, rejected, rejects, reason, actor, created_at, decided_at';
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

  async shops() {
    const { rows } = await this.db.query('SELECT * FROM backbone_shops ORDER BY created_at, slug');
    return rows;
  }

  // Магазин с доской из шаблона. Магазин уже есть: посев из кода получает его как
  // есть (exists = 'return'), заведение из кабинета — отказ «адрес занят».
  async createShop({ slug, name, niche, mode = 'shadow', hours = null, replyTo = null, shadowDays = null }, columns, makeEvents, { exists = 'return' } = {}) {
    return this.tx(async (client) => {
      const inserted = await client.query(
        `INSERT INTO backbone_shops (slug, name, niche, mode, hours, reply_to, shadow_days) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO NOTHING RETURNING *`,
        [slug, name, niche, mode, hours && JSON.stringify(hours), replyTo, shadowDays]
      );
      if (!inserted.rows[0]) {
        if (exists !== 'return') throw conflict(`Адрес магазина «${slug}» уже занят`);
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
        `INSERT INTO backbone_orders (shop_id, number, column_id, client, contact, text, channel, status_token, content_key, consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [shopId, next, columnId, draft.client, draft.contact, draft.text, draft.channel || 'manual',
          draft.statusToken || null, draft.contentKey || null, draft.consentAt || null]
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

  // Режим инструмента (шаг 3): смена — только из того режима, который видел пользователь.
  async setMode(shopId, from, to, events) {
    return this.tx(async (client) => {
      const { rows: [shop] } = await client.query(
        `UPDATE backbone_shops SET mode = $3, mode_since = now()
         WHERE id = $1 AND mode = $2 RETURNING *`,
        [shopId, from, to]
      );
      if (!shop) throw conflict('Режим магазина уже изменился — обновите страницу');
      await this.journal.appendIn(client, events);
      return shop;
    });
  }

  // Описание магазина из кабинета: название, часы, почта; слаг, ниша и режим — не здесь.
  async updateShop(shopId, { name, hours, replyTo }, events) {
    return this.tx(async (client) => {
      const { rows: [shop] } = await client.query(
        'UPDATE backbone_shops SET name = $2, hours = $3, reply_to = $4 WHERE id = $1 RETURNING *',
        [shopId, name, hours && JSON.stringify(hours), replyTo]
      );
      if (!shop) throw conflict('Магазин не найден');
      await this.journal.appendIn(client, events);
      return shop;
    });
  }

  // ---------- каталог магазина (шаг 6): выгрузка целиком или ничего ----------

  async catalogItems(shopId) {
    const { rows } = await this.db.query(
      `SELECT sku, name, item_group AS "group", unit, pack, price, stock FROM backbone_catalog_items
       WHERE shop_id = $1 ORDER BY position`,
      [shopId]
    );
    return rows.map((r) => ({ ...r, pack: num(r.pack), price: num(r.price), stock: num(r.stock) }));
  }

  async catalogLoads(shopId, { limit = 50 } = {}) {
    const { rows } = await this.db.query(
      `SELECT ${LOAD_COLUMNS} FROM backbone_catalog_loads WHERE shop_id = $1 ORDER BY id DESC LIMIT $2`,
      [shopId, limit]
    );
    return rows.map((r) => ({ ...r, id: String(r.id) }));
  }

  // Ожидающая загрузка; сам файл — только для решения (withFile), опросу экрана он не нужен.
  async pendingLoad(shopId, { withFile = false } = {}) {
    const { rows } = await this.db.query(
      `SELECT ${LOAD_COLUMNS}${withFile ? ', file' : ''} FROM backbone_catalog_loads
       WHERE shop_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [shopId]
    );
    return rows[0] ? { ...rows[0], id: String(rows[0].id) } : null;
  }

  // Новый файл вытесняет прежний, не дождавшийся решения: ожидает всегда один.
  async savePendingLoad(shopId, { fileName, file, headerRow, columns, mapping, rows, actor }) {
    return this.tx(async (client) => {
      await client.query("DELETE FROM backbone_catalog_loads WHERE shop_id = $1 AND status = 'pending'", [shopId]);
      const { rows: [load] } = await client.query(
        `INSERT INTO backbone_catalog_loads (shop_id, status, file_name, file, header_row, columns, mapping, rows, actor)
         VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [shopId, fileName, file, headerRow, JSON.stringify(columns), JSON.stringify(mapping), rows, actor]
      );
      return String(load.id);
    });
  }

  async setLoadMapping(loadId, mapping) {
    const { rowCount } = await this.db.query(
      "UPDATE backbone_catalog_loads SET mapping = $2 WHERE id = $1 AND status = 'pending'",
      [loadId, JSON.stringify(mapping)]
    );
    if (!rowCount) throw conflict('Загрузка уже решена — загрузите файл заново');
  }

  // Попытка не прошла (брака больше, чем позиций, и т. п.): каталог не тронут, файл
  // ждёт исправленного сопоставления; брак попытки виден списком.
  async noteLoadAttempt(shopId, loadId, { rows, loaded, rejected, rejects, reason }, events) {
    return this.tx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE backbone_catalog_loads SET rows = $3, loaded = $4, rejected = $5, rejects = $6, reason = $7
         WHERE id = $1 AND shop_id = $2 AND status = 'pending'`,
        [loadId, shopId, rows, loaded, rejected, JSON.stringify(rejects), reason]
      );
      if (!rowCount) throw conflict('Загрузка уже решена — загрузите файл заново');
      await this.journal.appendIn(client, events);
    });
  }

  // Выгрузка прочитана целиком: позиции магазина подменяются разом, версия каталога
  // растёт — одной транзакцией с событием (О17). Файл после решения не храним.
  async replaceCatalog(shopId, loadId, { items, rows, rejected, rejects }, events) {
    return this.tx(async (client) => {
      await client.query('SELECT 1 FROM backbone_shops WHERE id = $1 FOR UPDATE', [shopId]);
      const { rowCount } = await client.query(
        `UPDATE backbone_catalog_loads SET status = 'loaded', file = NULL, rows = $3, loaded = $4, rejected = $5,
           rejects = $6, reason = NULL, decided_at = now()
         WHERE id = $1 AND shop_id = $2 AND status = 'pending'`,
        [loadId, shopId, rows, items.length, rejected, JSON.stringify(rejects)]
      );
      if (!rowCount) throw conflict('Загрузка уже решена — загрузите файл заново');
      await client.query('DELETE FROM backbone_catalog_items WHERE shop_id = $1', [shopId]);
      for (let at = 0; at < items.length; at += 500) {
        const values = [];
        const params = [shopId];
        items.slice(at, at + 500).forEach((i, k) => {
          const p = params.length;
          values.push(`($1, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8})`);
          params.push(i.sku, i.name, i.group || '', i.unit, i.pack, i.price, i.stock, at + k);
        });
        await client.query(
          `INSERT INTO backbone_catalog_items (shop_id, sku, name, item_group, unit, pack, price, stock, position)
           VALUES ${values.join(', ')}`,
          params
        );
      }
      const { rows: [shop] } = await client.query(
        'UPDATE backbone_shops SET catalog_version = catalog_version + 1 WHERE id = $1 RETURNING *', [shopId]
      );
      await this.journal.appendIn(client, events);
      return shop;
    });
  }

  // Файл не прочитан (битый zip, нет шапки): отказ в истории загрузок, каталог прежний.
  async refusedLoad(shopId, { fileName, reason, actor }, events) {
    return this.tx(async (client) => {
      await client.query(
        `INSERT INTO backbone_catalog_loads (shop_id, status, file_name, reason, actor, decided_at)
         VALUES ($1, 'refused', $2, $3, $4, now())`,
        [shopId, fileName, reason, actor]
      );
      await this.journal.appendIn(client, events);
    });
  }

  // ---------- витрина и квитанции (шаг 4) ----------

  async shopById(id) {
    const { rows } = await this.db.query('SELECT * FROM backbone_shops WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async orderByToken(token) {
    const { rows } = await this.db.query('SELECT * FROM backbone_orders WHERE status_token = $1', [token]);
    return rows[0] || null;
  }

  async orderByContentKey(shopId, key) {
    const { rows } = await this.db.query(
      'SELECT * FROM backbone_orders WHERE shop_id = $1 AND content_key = $2', [shopId, key]
    );
    return rows[0] || null;
  }

  async receiptsCursor(shopId) {
    const { rows } = await this.db.query('SELECT receipts_cursor FROM backbone_shops WHERE id = $1', [shopId]);
    return rows[0] ? Number(rows[0].receipts_cursor) : 0;
  }

  // Письма проекции и новый курсор — одной транзакцией; другой проектор успел
  // раньше (курсор уже не тот) — ничего не пишем, повтор безопасен (событие + адресат уникальны).
  async saveReceipts(shopId, fromCursor, toCursor, rows) {
    return this.tx(async (client) => {
      const { rows: [shop] } = await client.query(
        'SELECT receipts_cursor FROM backbone_shops WHERE id = $1 FOR UPDATE', [shopId]
      );
      if (!shop || Number(shop.receipts_cursor) !== fromCursor) return false;
      for (const r of rows) {
        await client.query(
          `INSERT INTO backbone_receipts (shop_id, order_id, event_id, kind, audience, channel, address, reply_to, subject, body, status, last_error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (event_id, audience) DO NOTHING`,
          [shopId, r.orderId, r.eventId, r.kind, r.audience, r.channel, r.address, r.replyTo, r.subject, r.body, r.status, r.lastError]
        );
      }
      await client.query('UPDATE backbone_shops SET receipts_cursor = $2 WHERE id = $1', [shopId, toCursor]);
      return true;
    });
  }

  async pendingReceipts(maxAttempts, limit) {
    const { rows } = await this.db.query(
      `SELECT * FROM backbone_receipts
       WHERE status = 'pending' OR (status = 'failed' AND attempts < $1)
       ORDER BY created_at LIMIT $2`,
      [maxAttempts, limit]
    );
    return rows;
  }

  async markReceipt(id, { status, error = null }) {
    await this.db.query(
      `UPDATE backbone_receipts
       SET status = $2, attempts = attempts + 1, last_error = $3,
           sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
       WHERE id = $1`,
      [id, status, error]
    );
  }

  async receipts(shopId, { limit = 200 } = {}) {
    const { rows } = await this.db.query(
      `SELECT r.*, o.number FROM backbone_receipts r JOIN backbone_orders o ON o.id = r.order_id
       WHERE r.shop_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
      [shopId, limit]
    );
    return rows;
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
