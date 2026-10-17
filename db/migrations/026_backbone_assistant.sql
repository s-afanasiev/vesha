-- Костяк MVP, шаг 5 (docs/backbone-architecture.md §6.4, §10): ассистент магазина.
-- Ассистент отвечает о заявках только их клиенту (О20): дверь byClient отдаёт заявки
-- собеседника, а не фильтр в промпте. Собеседник — гость витрины (подписанная cookie
-- платформы); тот же браузер на сайте и в чате — один клиент. Чужой номер заявки
-- ассистент не видит. Ручные заявки ключа не имеют — их в чате не видно никому.
-- Разговоры живут в таблицах chat-engine (012): костяк их не дублирует.

ALTER TABLE backbone_orders
  ADD COLUMN client_key TEXT;           -- кто прислал заявку с витрины или из чата: ключ гостя

CREATE INDEX backbone_orders_client_idx ON backbone_orders (shop_id, client_key) WHERE client_key IS NOT NULL;
