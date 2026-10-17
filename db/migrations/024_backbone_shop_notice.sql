-- Письмо менеджеру о новой заявке (docs/backbone-handover.md §7, docs/backbone-architecture.md §6.1):
-- та же проекция журнала и та же таблица исходящих, что у квитанций клиенту. Одно
-- событие теперь может дать два письма — клиенту и магазину, поэтому ключ против
-- дублей — «событие + адресат», а не одно событие.

ALTER TABLE backbone_receipts
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'client' CHECK (audience IN ('client', 'shop')),
  ADD COLUMN reply_to TEXT;             -- куда уйдёт ответ на письмо; NULL — на почту магазина

ALTER TABLE backbone_receipts DROP CONSTRAINT backbone_receipts_event_id_key;
ALTER TABLE backbone_receipts ADD CONSTRAINT backbone_receipts_event_audience_key UNIQUE (event_id, audience);

-- again — магазину: тот же список с того же контакта пришёл ещё раз (received_again).
ALTER TABLE backbone_receipts DROP CONSTRAINT backbone_receipts_kind_check;
ALTER TABLE backbone_receipts ADD CONSTRAINT backbone_receipts_kind_check
  CHECK (kind IN ('received', 'waiting', 'done', 'refused', 'again'));
