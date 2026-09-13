# Эксперименты Vesha — как добавлять новый квадратик

Документ для агента и для человека. В новом чате достаточно сказать: прочитай `docs/experiments.md` и сделай эксперимент «…».

## Зачем это

Vesha — тонкий Express + статика. Главный продукт не один: на `/experiments/` сетка **квадратных плиток**. Каждая плитка — отдельный мини-проект со своей страницей, стилями и (если нужно) своим API. Эксперименты живут рядом, но не должны ломать друг друга.

Подзаголовок каталога: «Произвольные песочницы. Каждая плитка — отдельный проект.»

## Как просить агента в новом контексте

Скопируй и дополни:

```text
Прочитай docs/experiments.md и существующие эксперименты как образец.
Сделай новый эксперимент:

- id: kebab-case-имя (латиница, совпадает с папкой)
- title: человекочитаемое имя на плитке
- description: одно короткое предложение
- tech: список меток, например ["js", "ffmpeg"]
- что делает пользователь: …
- нужен ли бэкенд / БД / секреты: да/нет, какие
- llm: да/нет. Если да — вставь блок **llm-picker** (не собирай выбор модели с нуля)
- ограничения: не ломать другие эксперименты, vanilla JS, без новых фреймворков
```

Если идея ещё сырая — сначала спроси агента набросать `id`, title, description и решить, клиент-only это или с API. Потом уже кодить.

## Ментальная модель

```
/                     главная Vesha, ссылка «Эксперименты →»
/experiments/         каталог квадратиков (читает registry.json)
/experiments/<id>/    страница мини-проекта
/api/<namespace>/     опциональный бэкенд этого мини-проекта
```

Каталог **не хардкодится в HTML**. `public/experiments/index.html` делает `fetch('/experiments/registry.json')` и рисует плитки. Чтобы квадратик появился на сетке, достаточно записи в реестре и папки со страницей.

## Карта файлов

| Роль | Где |
|------|-----|
| Каталог плиток | `public/experiments/index.html` |
| Реестр (источник плиток) | `public/experiments/registry.json` |
| Страница эксперимента | `public/experiments/<id>/index.html` (+ свои `.css` / `.js`) |
| Общие стили и кнопки | `public/style.css` |
| Общий логин (виджет) | `public/auth.js` |
| Блок выбора LLM | `public/llm-picker.js` + `public/llm-picker.css` |
| Точка входа сервера | `main.js` |
| Конфиг / env | `server/config.js`, `.env.example` |
| Роуты API | `server/routes/*.js` |
| Бизнес-логика | `server/services/*.js` |
| Идентичность (гость + сессия) | `server/middleware/identity.js` |
| Миграции Postgres | `db/migrations/NNN_name.sql` |
| Архитектурные планы отдельных штук | `docs/` (например `docs/podborka-architecture.md`) |

Статика раздаётся из `public/`. URL `/experiments/roc/` → файл `public/experiments/roc/index.html`. Отдельный Express-маршрут для HTML не нужен.

Сервер: `npm run dev` (watch) или `npm start`. По умолчанию `http://localhost:3000`.

## Реестр плитки

Файл: `public/experiments/registry.json`.

```json
{
  "id": "extract-audio",
  "title": "Извлечение аудио",
  "description": "Достаём звук из видео через локальный ffmpeg.exe",
  "href": "/experiments/extract-audio/",
  "status": "wip",
  "tech": ["js", "ffmpeg"]
}
```

Поля:

- **`id`** — уникальный kebab-case. Совпадает с именем папки.
- **`title`** — заголовок на плитке и обычно `<h1>` страницы.
- **`description`** — коротко, помещается в квадрат.
- **`href`** — всегда `/experiments/<id>/` со слэшем в конце.
- **`status`** — `wip` (по умолчанию), `live` (зелёный бейдж), `archived`.
- **`tech`** — короткие метки через ` · ` на плитке. Не стек «для резюме», а намёк что внутри.

Порядок в массиве `experiments` = порядок на сетке.

Плитка — квадрат (`aspect-ratio: 1`), сетка `minmax(220px, 1fr)`. Не пихай в description длинный абзац.

## Что уже есть (ориентиры по масштабу)

| id | Тип | Что взять за образец |
|----|-----|----------------------|
| `roc` | Только клиент, canvas | Минимальный песочный эксперимент. Своя вёрстка, без общего хрома. |
| `extract-audio` | Клиент + узкий API | Типичный новый лабораторный эксперимент: общая шапка, свои css/js, `/api/extract-audio/*`. |
| `summarize` | Клиент + очередь + медиабинарники + AI | Долгие джобы, SSE/поллинг, история в Postgres. |
| `podborka` | Полноценный мини-продукт | Upload, vision, поиск, квоты гостя/юзера, `/api/looks`. План: `docs/podborka-architecture.md`. |

Новый эксперимент почти всегда ближе к `extract-audio` или `roc`, а не к `podborka`. Не тащи Postgres и OAuth «на всякий случай».

## Общая платформа — переиспользуй, не копируй заново

### Хром страницы эксперимента

Образец: `public/experiments/extract-audio/index.html`.

```html
<link rel="stylesheet" href="/style.css" />
<link rel="stylesheet" href="./my-experiment.css" />
<body class="page-experiments">
  <main class="experiments">
    <div class="experiments__nav">
      <a class="back-link" href="/experiments/">← Эксперименты</a>
      <div data-vesha-auth-widget></div>
    </div>
    <header class="experiments__header">
      <h1>…</h1>
      <p>…</p>
    </header>
    <!-- содержимое мини-проекта -->
  </main>
  <script src="/theme.js"></script>
  <script src="/auth.js"></script>
  <script src="./my-experiment.js"></script>
</body>
```

- Класс `page-experiments` на `body` включает тёмную сетку и выравнивание каталога.
- Ссылка «← Эксперименты» обязательна (кроме совсем сырых песочниц вроде `roc`).
- Виджет `[data-vesha-auth-widget]` + `/auth.js` — общий логин/гость. Не собирай вторую форму логина.
- Если нужен выбор модели: блок **llm-picker**, см. ниже. Не копируй его в папку эксперимента.
- Кнопки: `vesha-btn`, `vesha-btn--primary`, `vesha-btn--outline`, `vesha-btn--sm`.
- Свои стили — отдельный файл в папке эксперимента, не раздувай глобальный `style.css`, если класс не общий.

Клиентский JS — **vanilla**, без React/Vue/сборщика. Так исторически (в т.ч. задел под browser extension у подборки). Новый бандлер только если без него нельзя, и только внутри папки эксперимента.

### Auth и гость

`/api/*` проходит через `identityMiddleware`: cookie гостя `vesha_guest` и сессия `vesha_session`. На клиенте `window.VeshaAuth.getMe()`, `login`, `register`, `logout`, событие `auth:change`.

Квоты (лимиты загрузок) уже есть для подборки. Новый эксперимент подключает их только если реально нужны.

Секреты (Gemini, OpenAI, OAuth, …) живут **только на сервере**. В клиентский JS ключи не класть. Исключение — блок **llm-picker**: пользователь может вставить свой ключ в UI; ключ живёт только в памяти страницы до её закрытия и уходит на бэкенд как override. В `localStorage` сохраняются только несекретные настройки.

### Блок llm-picker (выбор нейросети)

Готовый UI-блок. В новом чате достаточно: «вставь **llm-picker**». Не собирай радиокнопки провайдеров заново.

Провайдеры:

- **Gemini** — URL и модель на сервере. В UI только API-ключ (пусто = ключ из `.env`).
- **YandexGPT** — URL и модель на сервере. Для своего ключа можно указать Folder ID; иначе используется серверный каталог.
- **OpenAI-совместимый** — Base URL, модель, ключ, температура, max tokens.

Подключение на странице эксперимента:

```html
<link rel="stylesheet" href="/llm-picker.css" />
...
<div data-vesha-llm-picker></div>
...
<script src="/llm-picker.js"></script>
```

Клиент:

```js
const llm = window.VeshaLlm.getPayload();
// Объект зависит от provider; apiKey присутствует только в момент вызова.
await fetch('/api/<id>/…', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ …, llm }),
});
document.addEventListener('llm:change', () => { /* VeshaLlm.isReady() */ });
```

Бэкенд эксперимента вызывает общий сервис, не пишет свой HTTP-клиент:

```js
const { completeChat } = require('../services/llm');
const result = await completeChat({
  selection: req.body.llm,
  messages: [
    { role: 'system', content: '…' },
    { role: 'user', content: '…' },
  ],
});
// result.text, result.provider, result.model
```

Статус ключей без секретов: `GET /api/llm/status`. Код виджета: `public/llm-picker.js`, стили `public/llm-picker.css`, сервис `server/services/llm.js`, роут `server/routes/llm.js`. Образец в UI: `public/experiments/notes-export/`.

Env: `GEMINI_API_KEY`, `YANDEX_API_KEY` или `YANDEX_IAM_TOKEN`, `YANDEX_FOLDER_ID`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`. Для локального keyless endpoint нужен явный `OPENAI_ALLOW_KEYLESS=true`.

Правила gateway:

- Без пользовательского ключа OpenAI URL и модель всегда берутся из server preset. Клиент не может направить серверный ключ на другой хост.
- Пользовательские URL в production по умолчанию выключены. Для них нужны `LLM_ENABLE_CUSTOM_ENDPOINTS=true` и allowlist `LLM_ALLOWED_OPENAI_HOSTS`.
- Локальные и private IP блокируются; разрешить их можно только явным `LLM_ALLOW_PRIVATE_ENDPOINTS=true`.
- Редиректы endpoint запрещены, чтобы ключ не ушёл на другой хост.
- Каждый LLM-route должен выполнять вызов через `runGuarded(req, task)` из `server/services/llmGuard.js`.
- Guard ограничивает гостя одновременно по guest cookie и IP, пользователя — по user ID; лимиты и общая конкурентность задаются через `LLM_*`.
- Счётчики guard хранятся в памяти процесса. Для нескольких Node-инстансов их нужно вынести в Redis/Postgres.
- За одним доверенным Nginx/Caddy задайте `TRUST_PROXY=true`, иначе IP-лимит будет видеть адрес proxy.
- Событие `llm:change` содержит только provider/ready/statusLabel — API-ключ в событие не попадает.

### Бэкенд, если он нужен

1. `server/routes/<id>.js` — Express Router.
2. `server/services/…` — логика, файлы, внешние API.
3. В `main.js`: `app.use('/api/<id>', require('./server/routes/<id>'))`.
4. Префикс API = id эксперимента или явный домен (`/api/looks` у подборки). Не вешай ручки на чужой namespace и не используй голый `/api/do-stuff`.
5. JSON-ошибки уже ловит общий handler в `main.js` (`err.status`, `err.message`).
6. Загрузки: `multer`, лимиты в `server/config.js`. Временные файлы — в каталог эксперимента, не в чужой `uploads/` без нужды.
7. Новые env — в `.env.example` и `server/config.js` с безопасным дефолтом.

Postgres поднимается через `docker-compose.yml` (порт хоста **5434** → 5432 контейнера). Миграции: `db/migrations/`, сортировка по имени файла, таблица `schema_migrations`. Новая таблица = новый файл `00N_short_name.sql`. Не править уже применённые миграции; добавляй следующую.

`main.js` при старте вызывает `migrate()`. Если БД нет — сервер всё равно слушает порт, API с Postgres упадёт, статика и клиент-only эксперименты работают.

## Пошаговая процедура нового эксперимента

Делай по порядку. Не пропускай реестр: без него квадратика на сетке не будет.

1. **Выбери `id`.** Латиница, kebab-case, коротко: `extract-audio`, `podborka`, `summarize`. Папка = id.
2. **Реши слой.** Только HTML/JS? Нужен Express? Нужна таблица? Нужен ключ в `.env`? Минимальный слой, который закрывает задачу.
3. **Папка** `public/experiments/<id>/`:
   - `index.html` — страница с общим хромом;
   - `<id>.css` — свои стили;
   - `<id>.js` — логика UI (IIFE, как в соседних экспериментах).
4. **Запись в** `public/experiments/registry.json` (обычно в конец массива, `status: "wip"`).
5. **Если нужен API** — роут + сервис + `app.use` в `main.js`. Имена URL и полей согласуй с клиентом сразу.
6. **Если нужна БД** — новая миграция, обращение через `server/db.js` (`query` / `withClient`). Привязка к `req.user` / `req.guest` как в summarize/podborka, если есть история на пользователя.
7. **Если нужен секрет или путь** — `.env.example` + `config`.
8. **Проверка в браузере:** `/experiments/` показывает новую плитку → клик открывает страницу → основной сценарий пользователя работает → «← Эксперименты» возвращает в каталог. Соседние плитки не сломаны.

Для большого эксперимента (как подборка) сначала можно положить план в `docs/<id>-architecture.md`, потом каркас плитки, потом API. Для лабораторной штуки план не обязателен.

## Чего не делать

- Не добавлять плитку только в HTML каталога — только через `registry.json`.
- Не менять чужие эксперименты «заодно», кроме общего хрома (`style.css` / `auth.js`), и то минимально.
- Не класть React/Vite/Tailwind на весь репозиторий из-за одного квадратика.
- Не монтировать API без префикса и не писать в таблицы другого эксперимента.
- Не коммитить `.env`, `uploads/`, `bin/`.
- Не переводить `status` в `live`, пока основной сценарий не открывается с каталога и не отрабатывает.

## Чеклист для агента перед «готово»

- [ ] Папка `public/experiments/<id>/` с рабочей `index.html`
- [ ] Запись в `registry.json` (`id`, `title`, `description`, `href`, `status`, `tech`)
- [ ] На `/experiments/` виден квадратик, ссылка ведёт на страницу
- [ ] Есть «← Эксперименты» (если это не голая песочница)
- [ ] Подключён `/style.css`; свои стили локальные
- [ ] Если нужен логин — виджет + `/auth.js`, не своя auth-система
- [ ] Если нужен выбор LLM — блок `llm-picker` (`/llm-picker.js` + `/api/llm` + `completeChat`), не своя форма провайдеров
- [ ] Если нужен бэкенд — `/api/<namespace>/…` подключён в `main.js`
- [ ] Если нужна БД — новая миграция, не правка старых
- [ ] Секреты только на сервере, `.env.example` обновлён
- [ ] Соседние эксперименты не задеты
- [ ] Основной пользовательский сценарий проверен в браузере

## Шаблон записи в реестре

```json
{
  "id": "my-lab",
  "title": "Название на плитке",
  "description": "Одно предложение, что умеет.",
  "href": "/experiments/my-lab/",
  "status": "wip",
  "tech": ["js"]
}
```
