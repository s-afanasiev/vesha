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

Остальное по месту: `SESSION_SECRET` (длинная случайная строка), ключ LLM
(`GEMINI_API_KEY` или `OPENAI_*`), за reverse proxy — `TRUST_PROXY=true`.

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

