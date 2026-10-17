-- Костяк: сотрудники магазина (docs/backbone-architecture.md §9). Кабинет магазина
-- открыт админу экземпляра (почта из ADMIN_EMAILS) и сотрудникам этого магазина —
-- почтам, которые админ добавил на экране «Магазины». Вход сотрудника — обычная
-- регистрация с этой почтой; роль живёт у магазина, а не у плиток экспериментов.
-- Добавление и удаление — события журнала stream shop (staff_added / staff_removed).

CREATE TABLE backbone_shop_staff (
  shop_id UUID NOT NULL REFERENCES backbone_shops(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'), -- как users.email после регистрации
  added_by TEXT NOT NULL,                -- почта админа, который добавил
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, email)
);

-- Вход сотрудника: его магазины — по почте.
CREATE INDEX backbone_shop_staff_email_idx ON backbone_shop_staff (email);
