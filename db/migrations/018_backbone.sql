-- Костяк MVP, шаг 1 (docs/backbone-architecture.md §6.1–6.2, §10): магазин, доска с
-- колонками смысловых типов, заявка и общий журнал событий. Журнал — общий кирпич:
-- те же события пишет лид automation-leads (поле stream различает потоки).
-- Каталог, строки заявки и квитанции — следующими миграциями, вместе со своими шагами.

CREATE TABLE backbone_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  board_version INT NOT NULL DEFAULT 1,  -- оптимистичная блокировка конструктора доски
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Тип колонки — смысл, на котором держатся окно статуса и замеры; название — вкус владельца.
CREATE TABLE backbone_board_columns (
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inbox', 'working', 'waiting_client', 'done', 'refused')),
  position INT NOT NULL,
  color TEXT,
  wip_limit INT CHECK (wip_limit IS NULL OR wip_limit > 0),
  PRIMARY KEY (shop_id, id)
);

-- Заявка ссылается на колонку своего магазина: удалить колонку с карточками
-- без переноса не даст сама база (второй рубеж после правила Board).
CREATE TABLE backbone_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  number INT NOT NULL,
  column_id TEXT NOT NULL,
  client TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number),
  FOREIGN KEY (shop_id, column_id) REFERENCES backbone_board_columns (shop_id, id)
);

CREATE INDEX backbone_orders_board_idx ON backbone_orders (shop_id, column_id, created_at);

-- События — факты: кто, когда, почему. Доска, окно статуса и замеры — проекции.
-- stream: order | board | (позже) lead; scope — чей это журнал (id магазина);
-- subject_id — заявка, доска магазина или лид.
CREATE TABLE journal_events (
  id BIGSERIAL PRIMARY KEY,
  stream TEXT NOT NULL,
  scope TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT 'manual',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX journal_events_subject_idx ON journal_events (stream, subject_id, id);
CREATE INDEX journal_events_scope_idx ON journal_events (scope, id);
