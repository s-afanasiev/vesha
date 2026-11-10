# Раскладка проектов: разделы, серверы, бэкенды

Три раздела — это три разных SLA, а не три папки. Раздел решает, где проект
живёт, кто его видит и что будет, если он упадёт.

| Раздел | `kind` | Кто видит | Где живёт | Если упал |
|---|---|---|---|---|
| Эксперименты | `experiment` | вы | зона `lab` | ничего |
| Портфолио | `showcase` | все | `edge` / `showcase` | стыдно |
| Индивидуальные заказы | `client` | заказчик | отдельный VDS | деньги и договор |

Правило: **раздел — свойство проекта, а не репозитория**. Переезд
`experiment → showcase` — это смена `kind` и пересборка профиля, а не перенос
кода и папок.

---

## 1. Таблица проектов

Колонки: **Ф** — фронт, **API** — серверные маршруты, **БД** — нужен Postgres,
**Внешнее** — бинарники и сервисы, **Форма** — как деплоится (см. §2),
**Куда** — зона.

### Внутренние проекты (`C:\CODE\vesha`)

| Проект | Раздел | Ф | API | БД | Внешнее | Готовность | Форма | Куда |
|---|---|---|---|---|---|---|---|---|
| `roc` | experiment | ✅ | — | — | — | wip | S | edge/lab |
| `podborka` | experiment | ✅ | `/api/looks` | 002 | sharp, Replicate, LLM | wip | A | lab |
| `summarize` | experiment | ✅ | `/api/summarize` | 003–004 | ffmpeg, yt-dlp, LLM | wip | A+M | lab |
| `extract-audio` | experiment | ✅ | `/api/extract-audio` | — | ffmpeg, yt-dlp | wip | M | lab |
| `notes-export` | experiment | ✅ | `/api/notes-export` | — | LLM | wip | A | lab |
| `pain-radar` | experiment | ✅ | `/api/pain-radar` | 005, 014–017 | парсеры, LLM | wip | A | lab |
| `idea-radar` | experiment | ✅ | `/api/idea-radar` | 005–006, 008–011 | RSS, pdf-parse, LLM | wip | A | lab |
| `super-notes` | experiment | ✅ | `/api/super-notes` | 007, pgvector | — | wip | A | lab |
| `chat-engine` | experiment | ✅ | `/api/chat-engine` | 012 | LLM | wip | A | lab |
| `automation-leads` | experiment | ✅ | `/api/automation-leads` | 021 | парсеры, LLM | wip, admin | A | lab |
| `playwright-mcp` | experiment | ✅ | `/api/playwright-mcp` | — | Playwright, браузер | wip, admin | B | lab (отдельно) |
| `scene-builder` | showcase | ✅ | — | — | three.js | wip | S | edge |
| `showcases` | showcase | ✅ | — | — | — | demo | S | edge |
| `ocenka-site` | showcase | ✅ | — | — | — | demo | S | edge |
| `backbone` | **client** | ✅ | `/api/backbone`, `/api/backbone-public` | 018–020, 022–031 | LLM, bcrypt, pdf-parse | demo | C | VDS заказчика |

Читается так:

- **Чистый фронт** — `roc`, `scene-builder`, `showcases`, `ocenka-site`. У них
  `routes: []`, процесс Node не нужен вообще: Caddy отдаёт файлы, RAM = 0.
- **Бэкенд без БД** — `extract-audio`, `notes-export`, `playwright-mcp`. Процесс
  нужен, база — нет.
- **Бэкенд + БД** — остальные эксперименты и `backbone`.
- **Медиа** — `summarize` и `extract-audio` требуют `ffmpeg`/`yt-dlp` на машине.
  Это не отдельная форма деплоя, а пометка «на этой машине должны стоять
  бинарники».
- **Браузер** — `playwright-mcp` тянет Chromium и легко съедает 300–500 МБ.
  Ему нужна отдельная машина или отдельный лимит, рядом с ним лучше ничего не
  селить.

Миграция `005` создаёт `radar_regions` и `radar_niches` — общий фундамент обоих
радаров, поэтому стоит в обеих строках. `008` добавляет `excludes` в ниши и
нужна только `idea-radar`.

Решения перенесены в манифесты (`projects/*/project.json`):

- `backbone` → `kind: client`, `client: backbone`;
- `showcases`, `ocenka-site` → `kind: showcase`, `status: demo`;
- `scene-builder` → `kind: showcase`, `status: wip` (доводим).

`npm run catalog:build` после этого оставил в каталоге экспериментов 11 записей:
витринные и заказной проекты из него ушли.

### Внешнее портфолио (`s-afanasiev.github.io`)

Пока не трогаем — только ссылки с лендинга. Это статика на GitHub Pages, у неё
нет ни бэкенда, ни базы, ни нашего VDS.

| Проект | Раздел | Стек | Форма | Где |
|---|---|---|---|---|
| `mech-arena-playable` | showcase | three.js, playable ad | L | GitHub Pages |
| `merge-guard-playable` | showcase | PixiJS, playable ad | L | GitHub Pages |
| `bastion-td-playable` | showcase | PixiJS, tower defense | L | GitHub Pages |
| `region-selector-3d` | showcase | three.js, геометрия | L | GitHub Pages |

Их ценность — доказательство навыка. Держать их у себя на VDS незачем: GitHub
Pages бесплатен, быстр и не падает вместе с нашими экспериментами.

---

## 2. Формы деплоя

| Форма | Что это | Процесс | RAM | Пример |
|---|---|---|---|---|
| **S** static | файлы, `file_server` | нет | 0 | `roc`, `scene-builder`, лендинг |
| **A** app | Node + Postgres | systemd | 100–250 МБ | `super-notes`, `chat-engine` |
| **M** media | Node + `ffmpeg`/`yt-dlp` | systemd | 150–400 МБ + пики | `summarize`, `extract-audio` |
| **B** browser | Node + Chromium | systemd | 400–800 МБ | `playwright-mcp` |
| **C** client | отдельный VDS, свой Caddy, своя БД | systemd | по договору | `backbone` |
| **L** link | внешний URL | нет | 0 | GitHub Pages |

Форма — не свойство кода, а решение о том, как его запускать. Один и тот же
`backbone` в лаборатории может быть формой A, а у заказчика — формой C.

---

## 3. Серверы

```
                     vesha.pro
                        │
              ┌─────────┴─────────┐
              │  edge  (1/1)      │  Caddy + статика
              │  лендинг, ссылки  │  без Node
              └─────────┬─────────┘
                        │ ссылки/субдомены
        ┌───────────────┼────────────────┐
        │               │                │
   lab (2/2)      showcase (2/4)    client-<id> (2/2…)
   эксперименты   портфолио с API   один заказчик = один VDS
   PROFILE=lab    PROFILE=showcase  PROFILE=client:<id>
```

| Зона | Машина | Что | SLA |
|---|---|---|---|
| `edge` | 1 CPU / 1 ГБ | лендинг, статические демо, ссылки | всегда |
| `lab` | 2 CPU / 2 ГБ | все эксперименты, общая база `vesha_lab` | можно ронять |
| `showcase` | 2 CPU / 4 ГБ | портфолио с бэкендами | всегда |
| `client:<id>` | 2 CPU / 2–4 ГБ | один заказчик, своя база | договор |
| `ci` | 2 CPU / 2 ГБ | GitFlic runner | по возможности |

Сейчас в работе «Эконом»: `edge` + `lab`. `showcase` с бэкендами не нужен, пока
в портфолио только внешние ссылки и статика. Как появится первый реальный
проект с API — поднимаем третью машину.

**DNS — не центральный прокси.** Каждый субдомен указывает A-записью на свою
машину, на каждой машине свой Caddy. Нет лишнего хопа и единой точки отказа.

```
vesha.pro           → edge
lab.vesha.pro       → lab
<project>.vesha.pro → showcase (когда появится)
```

---

## 4. Как живёт один бэкенд

Один проект = один процесс = один порт = один `.env` = одна база (или схема).

```
/srv/vesha/
  super-notes/
    main.js            # сборка профиля или репозиторий
    node_modules/
    .env               # PORT, DATABASE_URL, ключи только этого проекта
    data/              # файлы, если нужны
```

Юнит systemd:

```ini
# /etc/systemd/system/vesha-super-notes.service
[Unit]
Description=vesha super-notes
After=network.target postgresql.service

[Service]
Type=simple
User=vesha
WorkingDirectory=/srv/vesha/super-notes
EnvironmentFile=/srv/vesha/super-notes/.env
ExecStart=/usr/bin/node main.js
Restart=always
RestartSec=3
MemoryMax=512M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/srv/vesha/super-notes/data

[Install]
WantedBy=multi-user.target
```

Caddy на той же машине:

```caddyfile
notes.vesha.pro {
    reverse_proxy 127.0.0.1:3003
}
```

Порт слушает только `127.0.0.1`. Наружу открыты 22/80/443, всё остальное
закрыто UFW. Caddy — единственная публичная точка.

---

## 5. Несколько бэкендов на одной машине

Два способа, оба без Docker.

### 5.1 Один процесс на зону (сейчас)

`PROFILE=lab node main.js` монтирует все эксперименты в один Node-процесс.
Плюсы: одна база, один порт, 100–200 МБ на всё. Минусы: падение или утечка
одного эксперимента роняет всю лабораторию.

Это нормально для `lab`: эксперименты и должны падать вместе. Для витрины и
заказчика — нет.

### 5.2 Процесс на проект (витрина, заказчики)

Каждый проект — свой systemd-юнит, свой порт, свой `.env`, своя база:

```
127.0.0.1:3001  summarize
127.0.0.1:3002  extract-audio
127.0.0.1:3003  super-notes
127.0.0.1:3004  chat-engine
```

Caddy разводит по именам:

```caddyfile
summarize.vesha.pro   { reverse_proxy 127.0.0.1:3001 }
extract.vesha.pro     { reverse_proxy 127.0.0.1:3002 }
notes.vesha.pro       { reverse_proxy 127.0.0.1:3003 }
chat.vesha.pro        { reverse_proxy 127.0.0.1:3004 }
```

Что это даёт:

- упал `summarize` — `super-notes` жив;
- у каждого свои лимиты `MemoryMax`, свой пользователь, свой лог;
- откат — подмена каталога и `systemctl restart`, без пересборки соседей;
- секреты не пересекаются: ключ лаборатории не лежит в окружении витрины.

Цена — память. Четыре Node-процесса это ~400–800 МБ. Поэтому на 2 ГБ больше
3–4 бэкендов не селим, на 4 ГБ — 6–8.

### 5.3 Сколько процессов на машину

| Машина | Практический предел |
|---|---|
| 1 ГБ | 1 небольшой Node **без** Postgres, либо только статика |
| 2 ГБ | Postgres + 1–2 Node, либо 3 Node без Postgres |
| 4 ГБ | Postgres + 4–6 Node |
| 8 ГБ | 8–10 Node + Postgres, либо Playwright-ферма |

Цифры приблизительные: `ffmpeg` и Chromium дают пики, которые важнее среднего.

---

## 6. Postgres

**Один кластер на зону, отдельная база на проект.** Не контейнер на проект и не
одна база на всё.

```
lab:
  кластер PostgreSQL 16
    vesha_lab          # эксперименты, можно общую
    vesha_playwright   # если понадобится

showcase:
  кластер
    vesha_<project>    # по базе на проект
    vesha_<project>

client-<id>:
  свой кластер на VDS заказчика
    vesha_<client>
```

Правила:

- у каждой базы свой роль-владелец: `vesha_super_notes`, `vesha_chat`;
- роль не суперпользователь и не имеет доступа к чужим базам;
- миграции проекта лежат в его сборке и накатываются при старте;
- `pg_dump` по каждой базе, отдельным файлом, в `03:15`;
- расширения ставятся в кластер один раз: `pgvector` нужен `super-notes`;
- для лаборатории допустима одна база на все эксперименты — таблицы уже
  разведены префиксами, а падение лаборатории не страшно.

Для заказчика база — **на его машине**. Это не только 152-ФЗ: при передаче
достаточно отдать дамп и доступы, а не переносить чужие данные через свой VDS.

---

## 7. Docker или systemd

Docker **не обязателен**. Это инструмент, а не архитектура. На 1–2 ГБ VDS
демон и слои съедают 150–300 МБ, которые дороже, чем удобство.

| Ситуация | systemd | Docker |
|---|---|---|
| 1–3 Node-приложения на 1–2 ГБ | ✅ | накладно |
| Одна версия Node на всё | ✅ | не нужно |
| Разные версии Node у проектов | неудобно | ✅ |
| Конфликт версий `ffmpeg`/`yt-dlp` | неудобно | ✅ |
| Playwright с системными библиотеками | можно | ✅ проще |
| Жёсткие лимиты памяти/CPU | `MemoryMax`/`CPUQuota` | ✅ cgroups |
| Передача заказчику «одной командой» | нет | ✅ `docker compose up` |
| Быстрый откат | симлинк + restart | тег образа |

Рекомендация:

1. **Старт — systemd.** Один процесс на проект, Caddy спереди, Postgres на
   хосте. Этого хватает для лаборатории и первых витринных проектов.
2. **Docker — когда появится первый из поводов:** другая версия Node, конфликт
   бинарников, Playwright, или заказчик просит передачу в контейнерах.
3. **Postgres не контейнеризуем** без причины: на хосте проще бэкапы, обновления
   и мониторинг. Контейнер — только если это часть контракта на передачу.

Контейнер на проект имеет смысл и тогда, когда проектов на машине больше 5–6 и
хочется единый `compose` вместо десятка юнитов. Но это оптимизация под
количество, а не обязательное условие соседства.

---

## 8. Что делать по шагам

1. ~~Утвердить таблицу §1.~~ Сделано: `backbone` → client, `showcases` и
   `ocenka-site` → showcase, `scene-builder` → showcase (доводим).
2. ~~Перенести решения в манифесты.~~ Сделано: `kind` в
   `projects/<id>/project.json`, `npm run catalog:build`, каталог — 11 записей.
3. **Edge:** лендинг с тремя разделами и ссылками на GitHub-демо. Пока это
   единственное, что видит публика.
4. **Lab:** вторая машина, `PROFILE=lab`, `vesha_lab`, basic auth, `noindex`.
5. **Showcase:** не поднимаем, пока нет реального проекта с бэкендом. Внешние
   демо живут на GitHub Pages.
6. **Клиент:** `backbone` — отдельный VDS, свой Caddy, своя база, передача.

---

## 9. Открытый вопрос

Сколько реальных проектов с бэкендом ожидается в портфолио в ближайшие полгода?
От этого зависит, нужна ли отдельная машина `showcase` вообще: три статических
демо (`showcases`, `ocenka-site`, `scene-builder`) спокойно живут на `edge`.
