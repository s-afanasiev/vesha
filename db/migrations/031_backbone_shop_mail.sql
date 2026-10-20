-- Почта костяка для живых заказчиков (решение пользователя 20.10.2026; docs/backbone-handover.md
-- §4.9, «Ответственность за письма»): по умолчанию письма магазина уходят с нашего домена для
-- рассылки (общий SMTP из .env: «Магазин X» <noreply@…>, Reply-To — почта магазина), а
-- заказчику, который захочет, — с его собственного ящика.

-- Свой ящик магазина — отдельной таблицей, а не колонками backbone_shops: строка магазина
-- (SELECT *) ходит по всему костяку и в журнал, пароль туда не попадает. Заводит и меняет
-- только админ. Пароль приложения — зашифрованным ключом сервера BACKBONE_MAIL_KEY
-- (AES-256-GCM, привязан к магазину): база и бэкап его не выдают. Письма идут со своего
-- ящика, только когда с этими настройками ушло тестовое письмо (checked_at); до проверки и
-- после правки — с общего.
CREATE TABLE backbone_shop_mail (
  shop_id UUID PRIMARY KEY REFERENCES backbone_shops(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username TEXT NOT NULL,
  secret TEXT NOT NULL,              -- пароль приложения: v1:<iv>:<tag>:<шифр> в base64url
  sender TEXT NOT NULL,              -- адрес отправителя: From и конверт письма
  checked_at TIMESTAMPTZ,            -- тестовое письмо с этими настройками ушло; NULL — письма с общего ящика
  check_error TEXT,                  -- почему не ушло последнее тестовое письмо
  revision INT NOT NULL DEFAULT 1,   -- версия настроек: проверка отмечает ту, которую проверяла
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- След отправки для разбора жалоб: с какого адреса ушло письмо (свой ящик магазина или общий).
ALTER TABLE backbone_receipts ADD COLUMN sent_from TEXT;

-- Не больше N писем покупателю на один адрес за сутки (форма витрины — не рассыльщик):
-- счёт писем магазина на адрес за окно.
CREATE INDEX backbone_receipts_address_idx ON backbone_receipts (shop_id, address, created_at) WHERE audience = 'client';
