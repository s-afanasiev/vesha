-- Костяк MVP, шаг 2 (docs/backbone-architecture.md §6.5, §10): строки заявки —
-- черновик счёта после разбора OrderToInvoice, — и синонимы магазина, которые
-- растут из правок менеджера. События разбора и правок — в journal_events (018).

-- Строка черновика: что написал клиент, как её понял разбор, какая позиция
-- каталога и с какой уверенностью, что спросить у клиента, что решил менеджер.
-- Позиция хранится артикулом: каталог — внешний мир (выгрузка), а не таблица здесь.
CREATE TABLE backbone_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES backbone_orders(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  position INT NOT NULL,                       -- номер строки в черновике
  source TEXT NOT NULL,                        -- исходная строка, как в тексте заявки
  name TEXT NOT NULL,                          -- наименование после разбора
  qty NUMERIC(12, 3),                          -- количество клиента; NULL — не указано
  unit TEXT,                                   -- единица клиента: шт, уп, кг, м…
  origin TEXT NOT NULL CHECK (origin IN ('rule', 'model', 'raw')), -- правило, модель или «не разобрано»
  verify TEXT,                                 -- что проверить: цифры модели не нашлись в тексте
  sku TEXT,                                    -- выбранная позиция каталога
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('accepted', 'ask', 'missing')), -- от порогов autoAccept / ask
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ sku, score }] — 2–3 кандидата при «ask»
  invoice_qty NUMERIC(12, 3),                  -- сколько в счёт, в единице позиции
  price NUMERIC(12, 2),
  question TEXT,                               -- вопрос клиенту: упаковка, остаток, единица
  review TEXT CHECK (review IN ('accepted', 'edited', 'replaced')), -- решение менеджера
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, position)
);

CREATE INDEX backbone_order_lines_shop_idx ON backbone_order_lines (shop_id, order_id, position);

-- Синоним — фраза клиента (нормализованная) → позиция магазина. Рождается из
-- правки менеджера: замена позиции или подтверждение кандидата.
CREATE TABLE backbone_synonyms (
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,                        -- ключ: Synonyms.phrase(наименование)
  sku TEXT NOT NULL,
  example TEXT NOT NULL,                       -- как написал клиент в первый раз
  hits INT NOT NULL DEFAULT 1,                 -- сколько раз менеджер подтвердил
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, phrase)
);
