-- Тумблер разбора заявок (18.10.2026, docs/backbone-architecture.md §6.6): третье
-- положение «Выключен» — только доска, помощник заявки не разбирает. Положения:
-- off («Выключен») | shadow («Сравнение»: черновик скрыт до счёта менеджера) |
-- help («Помощь»: черновик сразу). Смена — событие mode_changed, как раньше.
ALTER TABLE backbone_shops DROP CONSTRAINT IF EXISTS backbone_shops_mode_check;
ALTER TABLE backbone_shops ADD CONSTRAINT backbone_shops_mode_check CHECK (mode IN ('off', 'shadow', 'help'));
