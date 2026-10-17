-- Костяк MVP, шаг 6 — то, что решается кодом (docs/backbone-architecture.md §8, §10):
-- магазин заводится из кабинета, без правки кода; каталог магазина — из его выгрузки
-- (1С, МойСклад, прайс в xlsx), а не из фикстуры.

-- Описание магазина, которое раньше жило в коде (SHOPS в backbone/index.js).
ALTER TABLE backbone_shops
  ADD COLUMN hours JSONB,                -- { days: [1..7], from: 'чч:мм', to: 'чч:мм' }; NULL — пн–сб 09:00–19:00
  ADD COLUMN reply_to TEXT,              -- почта магазина: ответ клиента на квитанцию уходит сюда
  ADD COLUMN shadow_days INT CHECK (shadow_days IS NULL OR shadow_days >= 0), -- NULL — срок тени по умолчанию (14)
  ADD COLUMN catalog_version INT NOT NULL DEFAULT 0;  -- 0 — выгрузку ещё не загружали

-- Демо-магазин заводился из кода: его часы и тень без срока переезжают в таблицу.
UPDATE backbone_shops
  SET hours = '{"days": [1, 2, 3, 4, 5, 6], "from": "09:00", "to": "19:00"}'::jsonb, shadow_days = 0
  WHERE slug = 'demo-krepezh';

-- Каталог магазина — последняя успешно прочитанная выгрузка целиком (О17):
-- подмена — одной транзакцией вместе с версией каталога и событием журнала.
CREATE TABLE backbone_catalog_items (
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  item_group TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'шт',
  pack NUMERIC(12, 3) NOT NULL DEFAULT 1,
  price NUMERIC(12, 2) NOT NULL,
  stock NUMERIC(14, 3),                  -- NULL — остатка в выгрузке нет
  position INT NOT NULL,                 -- порядок строк выгрузки
  PRIMARY KEY (shop_id, sku)
);

-- Загрузка выгрузки: ожидает сопоставления колонок (файл лежит здесь), загружена
-- или отказ. Что не загрузилось — списком в rejects; файл после решения не храним.
CREATE TABLE backbone_catalog_loads (
  id BIGSERIAL PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'loaded', 'refused')),
  file_name TEXT NOT NULL,
  file BYTEA,                            -- только пока pending
  header_row INT,                        -- номер строки шапки на листе (с 1)
  columns JSONB NOT NULL DEFAULT '[]'::jsonb, -- колонки листа: [{ index, letter, header, samples }]
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb, -- поле каталога → номер колонки листа (с 0)
  rows INT NOT NULL DEFAULT 0,           -- строк данных под шапкой
  loaded INT NOT NULL DEFAULT 0,
  rejected INT NOT NULL DEFAULT 0,
  rejects JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ row, reason, cells }] — первые сотни
  reason TEXT,                           -- почему каталог не подменён
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX backbone_catalog_loads_shop_idx ON backbone_catalog_loads (shop_id, id DESC);
