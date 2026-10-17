-- Костяк MVP, шаг 4 (docs/backbone-architecture.md §6.1, §6.3, §10): витрина.
-- Заявка с сайта получает ссылку на окно статуса (токен), ключ «контакт + содержимое»
-- против дублей и отметку согласия на обработку персональных данных (152-ФЗ).
-- Квитанции клиенту — исходящие письма: проекция журнала, доставка — отдельно от
-- перехода (П35); курсор проекции живёт у магазина.

ALTER TABLE backbone_orders
  ADD COLUMN status_token TEXT,
  ADD COLUMN content_key TEXT,          -- контакт + содержимое заявки: тот же список дважды — одна заявка
  ADD COLUMN consent_at TIMESTAMPTZ;    -- согласие на обработку персональных данных (заявка с сайта)

CREATE UNIQUE INDEX backbone_orders_status_token_idx ON backbone_orders (status_token) WHERE status_token IS NOT NULL;
CREATE UNIQUE INDEX backbone_orders_content_key_idx ON backbone_orders (shop_id, content_key) WHERE content_key IS NOT NULL;

ALTER TABLE backbone_shops
  ADD COLUMN receipts_cursor BIGINT NOT NULL DEFAULT 0;  -- id последнего события журнала, разобранного в квитанции

CREATE TABLE backbone_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES backbone_orders(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL UNIQUE,      -- событие, ради которого квитанция: повтор проекции не дублирует
  kind TEXT NOT NULL CHECK (kind IN ('received', 'waiting', 'done', 'refused')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'none')),
  address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX backbone_receipts_shop_idx ON backbone_receipts (shop_id, created_at DESC);
CREATE INDEX backbone_receipts_pending_idx ON backbone_receipts (status) WHERE status IN ('pending', 'failed');
