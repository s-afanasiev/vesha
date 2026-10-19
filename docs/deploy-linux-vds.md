# Деплой Vesha на Linux VDS (без docker)

Слабый VDS с установленным Postgres — достаточная конфигурация: Vesha — тонкий
Express + статика, docker нужен только если осознанно выбран режим `DB_MODE=docker`.

## 1. Что должно быть на сервере

- **Node.js ≥ 20** (`node -v`; notes-export требует 20+).
- **Postgres** — любой установленный (нативный, без docker).
- Опционально `ffmpeg`/`yt-dlp` системные — только для экспериментов summarize /
  extract-audio; чат-движок и радары их не требуют.

## 2. Настройка .env

```bash
cp .env.example .env
```

Ключевая переменная режима — `DB_MODE` (server/config.js):

- **VDS без docker (наш случай): `DB_MODE=native`** — порт по умолчанию 5432,
  подключаемся к установленному Postgres.
- `DB_MODE=docker` — база в контейнере из `docker-compose.yml`, порт 5434.
  Сам контейнер поднимается отдельно (`docker-compose up -d`), сервер docker
  не запускает.

Задать реквизиты базы — строкой или отдельными переменными (они используются
только если `DATABASE_URL` пуст):

```bash
DATABASE_URL=postgres://vesha:пароль@localhost:5432/vesha
# или:
# PGUSER=vesha
# PGPASSWORD=пароль
# PGDATABASE=vesha
# PGHOST=localhost
# PGPORT=5432   # опционально: сильнее DB_MODE
```

Остальное по месту: `SESSION_SECRET` (длинная случайная строка), `ADMIN_EMAILS`
(email админов через запятую — без него служебные части экспериментов недоступны),
ключ LLM (`GEMINI_API_KEY`, `OPENAI_*` для самого OpenAI или `LLM_OPENAI_*` для
стороннего OpenAI-совместимого провайдера), за reverse proxy — `TRUST_PROXY=true`.

## 3. Запуск

```bash
npm ci --omit=dev      # слабому серверу ставим только прод-зависимости
npm run migrate        # применит db/migrations/*.sql (идемпотентно)
npm start              # node main.js; PORT по умолчанию 3000
```

Для постоянной работы — systemd-юнит или `pm2 start main.js --name vesha`.
Миграции вызываются и при старте `main.js`, отдельный `npm run migrate` — для
ручного контроля.

## 4. Проверка работоспособности

- `GET /api/llm/status` — какой LLM-ключ видит сервер (без секретов).
- `/experiments/` — сетка плиток открывается.
- `/experiments/chat-engine/` + `widget.html` — полный цикл чат-движка: он не
  требует ничего, кроме Node и Postgres (pure JS, без бинарников).
- Если `bin/` скопирован с Windows-машины, summarize/extract-audio скажут об
  этом честно: там нужны ELF-файлы (`npm run media-bins` на Linux) или пустые
  заглушки `SUMMARIZE_MOCK=1`.

## 5. Нагрузка

Слабый сервер: LLM-лимиты уже регулируются env (`LLM_MAX_CONCURRENT`,
`LLM_GUEST_REQUESTS_PER_HOUR`) — при нехватке памяти снизьте `LLM_MAX_CONCURRENT`
до 1–2. Счётчики guard живут в памяти процесса — при одном инстансе этого
достаточно (docs/experiments.md, раздел llm-picker).

## 6. Nginx + HTTPS

```nginx
# /etc/nginx/sites-available/vesha.conf
# В server_name — punycode: веша.рф = xn--80adj0f.xn--p1ai
server {
    listen 80;
    server_name xn--80adj0f.xn--p1ai;

    client_max_body_size 2g;   # загрузки файлов (podborka/summarize)

    # аккуратный адрес для показа заказчику (без следов /experiments/)
    location /ocenka/ {
        proxy_pass http://127.0.0.1:3000/experiments/ocenka-site-v2/;
        include /etc/nginx/proxy_params_vesha.conf;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/proxy_params_vesha.conf;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

Общий прокси-фрагмент `/etc/nginx/proxy_params_vesha.conf`:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# LLM-вызовы идут до 3 минут (LLM_TIMEOUT_MS) — дефолтные 60s их режут:
proxy_read_timeout 300s;
proxy_send_timeout 300s;
proxy_buffering off;   # SSE и стриминг не копим в буфере
```

Включение и HTTPS:

```bash
sudo ln -s /etc/nginx/sites-available/vesha.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d xn--80adj0f.xn--p1ai   # сам добавит 443 и редирект
```

В `.env` Vesha за nginx: `TRUST_PROXY=true` (иначе лимиты LLM будут видеть
адрес nginx вместо IP посетителя) и перезапустить Node.


## 7. Костяк: выезд на прод перед первым магазином

Чек-лист шага 6 (docs/backbone-architecture.md §10; передача магазину целиком —
docs/backbone-handover.md): то, что проверяется на
сервере, а не тестами. Идти по порядку; каждый пункт — с проверкой.

Магазин заказчика ставится не всем Vesha, а сборкой `dist/shop`
(`npm run build:shop`, точка входа `shop.js`, служба `shop`; handover §4.4):
кабинет там — `/cabinet/`, корень домена — витрина `SHOP_HOME`. На общем
сервере Vesha костяк живёт в плитке `/experiments/backbone/`. Ниже — оба
варианта.

1. **Миграции.** Накатываются при старте (Vesha — ещё `npm run migrate`). Проверка:
   `SELECT id FROM schema_migrations ORDER BY id;`. Сборка магазина — ровно
   десять строк: `001_shop_init` (только вход и квота гостя), `012_chat_engine`,
   `018_backbone`, `019_backbone_lines`, `020_backbone_mode`, `022_backbone_site`,
   `023_backbone_shops_catalog`, `024_backbone_shop_notice`,
   `025_backbone_shop_staff`, `026_backbone_assistant`; `021_automation_leads`
   в сборку не входит. В Vesha — все от `001` до `026`. 023 переносит часы и
   тень демо-магазина из кода в таблицу и добавляет каталог и загрузки выгрузок;
   024 меняет ключ квитанций — накатывать только вместе с кодом.
2. **Адрес сайта для ссылок.** `BACKBONE_PUBLIC_URL=https://xn--80adj0f.xn--p1ai`
   (punycode: кириллический домен в ссылке письма ломают часть почтовых клиентов).
   Проверка: ссылка «Путь заявки» из квитанции открывает окно статуса снаружи.
3. **`TRUST_PROXY=true` за nginx.** Без него витрина видит один адрес nginx у всех
   клиентов, и частота «5 заявок за 10 минут с адреса» срабатывает на весь сайт.
4. **Модель разбора.** `BACKBONE_MODEL` не задавать (шлюз, квота инициатора);
   нужен серверный пресет `LLM_OPENAI_*`. `recorded` — только для демо без сети.
5. **Почта квитанций.** В `.env`: `BACKBONE_SMTP_HOST`, `BACKBONE_SMTP_PORT`
   (465 — TLS сразу, 587 — STARTTLS), `BACKBONE_SMTP_USER`, `BACKBONE_SMTP_PASS`
   (у Яндекса и Mail.ru — пароль приложения), `BACKBONE_MAIL_FROM` = тот же ящик,
   что `USER` (иначе сервер откажет или письмо уйдёт в спам). Перед этим — что
   провайдер VDS выпускает исходящую почту: `nc -vz smtp.yandex.ru 465`.
   Проверка: заявка с витрины на свой тестовый ящик → в кабинете «Квитанции
   клиентам» статус «отправлена», письмо пришло, «Ответить» уходит на почту
   магазина (Reply-To). Сбой виден в колонке «Почему не ушла»; без SMTP письма
   лежат файлами в `data/backbone-mail/` (папка должна быть доступна на запись).
6. **Витрина снаружи.** С другого устройства (не с сервера):
   `https://<домен>/backbone/?shop=demo-krepezh` (в сборке магазина — ещё
   `https://<домен>/` → витрина `SHOP_HOME`) — каталог ищется, заявка
   уходит, номер и ссылка на статус приходят; на телефоне — без горизонтальной
   прокрутки. API отдельно: `curl -s https://<домен>/api/backbone-public/shops/demo-krepezh`.
   Сборка магазина слушает только `127.0.0.1` (`HOST`): `http://<IP>:3000` снаружи
   не открывается — так и задумано.
7. **Кабинет — за входом.** Без входа `GET /api/backbone/c/shops/rows` → 401,
   вошедший не админ — 403. Войти почтой из `ADMIN_EMAILS` →
   `/cabinet/?page=shops` (сборка магазина) или `/experiments/backbone/?page=shops` (Vesha).
8. **Первый магазин.** «Магазины» → «Завести магазин» (адрес, название, ниша,
   часы, почта магазина) → разбор — «Сравнение» → экран «Каталог»: «Загрузить файл
   выгрузки» (xlsx из 1С, МойСклад или прайс) → проверить колонки → «Загрузить
   каталог» → прочитать список «Не загружено». Ссылку на витрину
   `/backbone/?shop=<адрес>` — владельцу.
9. **152-ФЗ.** Сервер и база — в России; страница политики обработки ПДн по
   ссылке из формы витрины — до приёма заявок живых клиентов.
