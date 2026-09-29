-- Радар идей, фаза 1: источники, опросы, сырые публикации (docs/idea-radar-architecture.md).
-- Сюжеты, предметы и сдвиги появятся отдельной миграцией в фазе 2.

CREATE TABLE idea_radar_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL
    CHECK (kind IN ('gov', 'news', 'events', 'jobs', 'initiatives', 'serendipity')),
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  adapter TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  region_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL,
  rubric TEXT,
  niche_hint_id UUID REFERENCES radar_niches(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_to TIMESTAMPTZ
);

CREATE TABLE idea_radar_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES idea_radar_sources(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('ok', 'partial', 'failed')),
  items_seen INT NOT NULL DEFAULT 0,
  items_new INT NOT NULL DEFAULT 0,
  error_code TEXT,
  error TEXT
);

CREATE INDEX idea_radar_polls_source_started_idx
  ON idea_radar_polls (source_id, started_at DESC);

-- У СМИ храним заголовок, лид и ссылку; body — только для официальных документов.
-- published_at пустой, если у источника нет даты: такая публикация не участвует в трендах.
CREATE TABLE idea_radar_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES idea_radar_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  lead TEXT,
  body TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_poll_id UUID REFERENCES idea_radar_polls(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  relevance TEXT NOT NULL DEFAULT 'unknown'
    CHECK (relevance IN ('unknown', 'relevant', 'off_topic')),
  UNIQUE (source_id, external_id)
);

CREATE INDEX idea_radar_publications_published_idx
  ON idea_radar_publications (published_at DESC NULLS LAST);
CREATE INDEX idea_radar_publications_source_published_idx
  ON idea_radar_publications (source_id, published_at DESC NULLS LAST);

-- Шесть источников для персоны «ремонт авто» в Курской области: госакты, новости, вакансии.
-- Событий пока нет: API Timepad требует токен организатора.
INSERT INTO idea_radar_sources
  (slug, kind, name, site_url, adapter, settings, region_id, rubric, niche_hint_id, sort_order)
SELECT v.slug, v.kind, v.name, v.site_url, v.adapter, v.settings::jsonb,
       r.id, v.rubric, n.id, v.sort_order
FROM (VALUES
  ('pravo-46', 'gov', 'Официальное опубликование: Курская область', 'http://publication.pravo.gov.ru/',
   'pravo', '{"block": "region46", "pageSize": 100, "maxPages": 3}', 'ru-46', 'правовые акты', NULL, 1),
  ('kursk-izvestia', 'news', 'Курские известия', 'https://kursk-izvestia.ru/',
   'rss', '{"feedUrl": "https://kursk-izvestia.ru/news/rss/"}', 'ru-46', 'новости региона', NULL, 2),
  ('gtrk-kursk', 'news', 'ГТРК «Курск»', 'https://gtrkkursk.ru/',
   'rss', '{"feedUrl": "https://gtrkkursk.ru/rss/"}', 'ru-46', 'новости региона', NULL, 3),
  ('46tv', 'news', '46ТВ', 'https://46tv.ru/',
   'rss', '{"feedUrl": "https://46tv.ru/rss.xml"}', 'ru-46', 'новости региона', NULL, 4),
  ('kolesa', 'news', 'Колёса.ру', 'https://www.kolesa.ru/',
   'rss', '{"feedUrl": "https://www.kolesa.ru/export/rss.xml"}', 'ru', 'авторынок', 'auto', 5),
  ('trudvsem-46-auto', 'jobs', 'Работа России: авто-вакансии', 'https://trudvsem.ru/',
   'trudvsem',
   '{"regionCode": "4600000000000", "queries": ["автомеханик", "автослесарь", "автоэлектрик", "моторист", "маляр", "кузов", "мойщик", "шиномонтаж"], "keepTitle": "авто|шин|кузов|моторист|эвакуат|вулканиз|жестянщ|маляр.*(авто|кузов|машин)|мойщик.*(авто|машин)"}',
   'ru-46', 'вакансии', 'auto', 6)
) AS v(slug, kind, name, site_url, adapter, settings, region_code, rubric, niche_slug, sort_order)
LEFT JOIN radar_regions r ON r.code = v.region_code
LEFT JOIN radar_niches n ON n.slug = v.niche_slug;
