-- Словарь источников: «откуда парсили» — 2ГИС, Яндекс Карты, третий ресурс.
-- Иерархия каркаса: источник (откуда) → ресурс (что и как собираем, темп) → item (сырой факт).
-- Свободный текст source в радарных таблицах заменяется на FK — рассинхрон «2gis/2ГИС/twogis» исключён.

CREATE TABLE collector_sources (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,          -- '2gis', 'yandex-maps', ...
  title TEXT NOT NULL,                -- '2ГИС', 'Яндекс Карты'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO collector_sources (slug, title) VALUES ('2gis', '2ГИС');

-- Ресурсы принадлежат источнику (у 2ГИС их будет несколько: отзывы, листинг, рейтинги).
ALTER TABLE collector_resources
  ADD COLUMN source_id INT NOT NULL REFERENCES collector_sources(id);

-- Радарные таблицы: TEXT → FK. Таблицы пустые (импортёр ещё не писан) — безопасно.
ALTER TABLE pain_radar_rubrics
  DROP CONSTRAINT pain_radar_rubrics_source_external_id_key,
  DROP COLUMN source,
  ADD COLUMN source_id INT NOT NULL REFERENCES collector_sources(id),
  ADD CONSTRAINT pain_radar_rubrics_source_external_id_key UNIQUE (source_id, external_id);

ALTER TABLE pain_radar_organizations
  DROP CONSTRAINT pain_radar_organizations_source_external_id_key,
  DROP COLUMN source,
  ADD COLUMN source_id INT NOT NULL REFERENCES collector_sources(id),
  ADD CONSTRAINT pain_radar_organizations_source_external_id_key UNIQUE (source_id, external_id);

ALTER TABLE pain_radar_jobs
  DROP COLUMN source,
  ADD COLUMN source_id INT NOT NULL REFERENCES collector_sources(id);

-- pain_radar_reviews: собственной колонки источника не нужно — источник выводится
-- через организацию (org.source_id); provider остаётся площадкой размещения отзыва
-- (2gis / flamp / tbank), это другой уровень.
