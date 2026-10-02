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
