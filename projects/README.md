# Манифесты проектов

Один проект — одна папка `projects/<id>/project.json`. Код и статика при этом
остаются на своих местах: `public/experiments/<id>/`, `server/routes/*.js`.
Манифест только описывает проект и его API.

```json
{
  "id": "summarize",
  "order": 3,
  "title": "Суммаризация видео или аудио",
  "description": "Краткое содержание из ролика или записи",
  "kind": "experiment",
  "status": "wip",
  "tech": ["js", "yt-dlp", "ffmpeg"],
  "static": "public/experiments/summarize",
  "routes": [{ "mount": "/api/summarize", "module": "server/routes/summarize" }]
}
```

- `kind` — `experiment`, `showcase` или `client`.
- `routes` — массив: у проекта может быть несколько API (`backbone`).
- `client` — обязателен для `kind: client`, используется в `PROFILE=client:<id>`.

## Профили

`PROFILE` в `.env` или окружении:

| Профиль | Что монтирует |
|---|---|
| `full` | всё (по умолчанию) |
| `lab` | только `experiment` |
| `showcase` | только `showcase` |
| `client:<id>` | только проекты этого заказчика |

Платформенные маршруты (`auth`, `llm`, `catalog`) перечислены в
`server/projects.js` и не принадлежат проектам.

## После правки

```bash
npm run catalog:check   # registry.json сходится с манифестами
npm run catalog:build   # пересобрать registry.json
npm test                # в т.ч. граница профилей
```

Схема и обоснование — `docs/portfolio-structure.md`, §4–5.
