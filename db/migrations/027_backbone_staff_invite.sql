-- Костяк: вход сотрудника — по приглашению, а не по совпадению почты (проверка
-- изоляции магазинов, docs/backbone-architecture.md §9). Регистрация почту не
-- подтверждает: кто первым зарегистрировал почту, которую админ добавил магазину,
-- тот и входил в его кабинет. Теперь админ добавляет почту — сайт выдаёт
-- одноразовую ссылку со сроком; доступ получает аккаунт, который открыл её и вошёл
-- (user_id), почта остаётся подписью строки. В базе — только хэш токена.
--
-- Прежние строки (до этой миграции) — без аккаунта и без ссылки: входа не дают,
-- админ выдаёт приглашение заново той же кнопкой «Добавить сотрудника».

ALTER TABLE backbone_shop_staff
  ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- аккаунт, принявший приглашение
  ADD COLUMN invite_hash TEXT,                                      -- sha256 токена ссылки; NULL — ссылки нет
  ADD COLUMN invite_until TIMESTAMPTZ,                              -- ссылка действует до
  ADD COLUMN joined_at TIMESTAMPTZ;                                 -- когда приглашение принято

CREATE UNIQUE INDEX backbone_shop_staff_invite_idx ON backbone_shop_staff (invite_hash) WHERE invite_hash IS NOT NULL;

-- Вход сотрудника: его магазины — по аккаунту.
CREATE INDEX backbone_shop_staff_user_idx ON backbone_shop_staff (user_id);
