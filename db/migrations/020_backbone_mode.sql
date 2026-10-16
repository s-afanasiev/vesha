-- Костяк MVP, шаг 3 (docs/backbone-architecture.md §6.6, §10): режим инструмента у
-- магазина. Тень — инструмент разбирает заявки, но черновик менеджеру не показывает:
-- две недели базы «до» и точность черновика против настоящего счёта из 1С.
-- Помощь — менеджер работает с черновиком. Смена режима — событие mode_changed.

-- Магазины, которые уже работали с черновиками до этой миграции, остаются в помощи;
-- новый магазин начинает с тени.
ALTER TABLE backbone_shops
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'help' CHECK (mode IN ('shadow', 'help')),
  ADD COLUMN mode_since TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE backbone_shops ALTER COLUMN mode SET DEFAULT 'shadow';
