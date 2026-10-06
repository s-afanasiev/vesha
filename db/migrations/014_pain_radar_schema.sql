-- Радар болей: схема данных (пункт 1.6, pain-radar-plan-schema.md).
-- Два слоя по В1 (collectors-architecture.md): сырьё хранит каркас (collector_items),
-- радар — интерпретацию со ссылкой на item (переразметка без пересбора источника).
-- Города и ниши — общий слой радаров (radar_regions / radar_niches), своих словарей не заводим.

-- ---------- Каркас сборщиков (ступень 2, collectors-architecture.md) ----------

-- Реестр ресурсов: темп и терпение источника держит каркас, домена здесь нет.
CREATE TABLE collector_resources (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,                       -- maps | catalog | news | gov | ...
  adapter TEXT NOT NULL,                    -- 'twogis-reviews', 'twogis-listing', ...
  settings JSONB NOT NULL DEFAULT '{}',     -- фронтовый ключ API, потолки страниц
  poll_every_min INT NOT NULL DEFAULT 0,    -- 0 = только по запросу
  min_interval_sec INT NOT NULL DEFAULT 2,
  page_timeout_ms INT NOT NULL DEFAULT 20000,
  throttle_ms INT NOT NULL DEFAULT 1200,
  active_from TIMESTAMPTZ,
  active_to TIMESTAMPTZ
);

-- Сырьё как есть: один item = один сырой факт (отзыв, карточка, страница листинга).
-- Повторный сбор upsert'ит payload — тот же факт не храним дважды (решение о бане — без риска).
CREATE TABLE collector_items (
  id SERIAL PRIMARY KEY,
  resource_id INT NOT NULL REFERENCES collector_resources(id),
  kind TEXT NOT NULL,                       -- review | branch | listing_page | ...
  external_id TEXT NOT NULL,                -- review_id / branch_id / URL страницы
  url TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT,                        -- sha256 payload: заметить изменение факта
  payload JSONB NOT NULL,
  UNIQUE (resource_id, kind, external_id)
);

CREATE INDEX collector_items_resource_idx ON collector_items (resource_id, fetched_at DESC);

-- ---------- Справочники источника ----------

-- Рубрики 2ГИС: стабильные ID разведки (/город/rubrics). Иерархия самосвязью:
-- метарубрика (Поесть 110539) → группа → конечная rubric (Шиномонтаж 7689).
CREATE TABLE pain_radar_rubrics (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT '2gis',
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- metarubric | rubric | pseudorubric
  parent_id INT REFERENCES pain_radar_rubrics(id) ON DELETE SET NULL,
  branch_count INT,                         -- «Места N»: счётчик источника
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

-- Организации: branch_id стабилен, карточка даёт контакты. website null = сайта нет —
-- для сценария А это база первых клиентов с доказанной болью.
CREATE TABLE pain_radar_organizations (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT '2gis',
  external_id TEXT NOT NULL,                -- branch_id
  name TEXT NOT NULL,
  address TEXT,
  city_region_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  rating REAL,
  reviews_count INT,                        -- счётчик источника (оценки ≠ отзывы с текстом)
  website TEXT,
  phones JSONB NOT NULL DEFAULT '[]',
  socials JSONB NOT NULL DEFAULT '[]',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

-- ---------- Джобы и отзывы ----------

-- Джобы сбора — как summarize_jobs: пользователь или гость.
CREATE TABLE pain_radar_jobs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT '2gis',
  query TEXT,                               -- URL организации или поисковый запрос
  city_region_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL,
  niche_id UUID REFERENCES radar_niches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new',       -- new | running | done | failed | paused
  progress INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Отзывы: интерпретация, не сырьё. Текст дублирует payload item'а сознательно —
-- он нужен постоянно (цитаты, SQL-агрегации); истина при расхождении — payload.
-- ПДн автора не храним (дедуп по content_hash текста). Официальный ответ — колонки:
-- 1:1 к отзыву и читается вместе с ним (сам факт «организация отвечает» — сигнал).
CREATE TABLE pain_radar_reviews (
  id SERIAL PRIMARY KEY,
  job_id INT REFERENCES pain_radar_jobs(id) ON DELETE SET NULL,
  org_id INT NOT NULL REFERENCES pain_radar_organizations(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,                -- review_id 2ГИС
  content_hash TEXT NOT NULL,
  rating INT NOT NULL,                      -- 1..5; негатив — ≤ 3
  review_date TIMESTAMPTZ,                  -- date_created
  edited_date TIMESTAMPTZ,                  -- date_edited: свежесть правки (полураспад веса)
  provider TEXT NOT NULL DEFAULT '2gis',    -- 2gis | flamp | tbank | ... (агрегация источника)
  text TEXT NOT NULL DEFAULT '',
  official_answer TEXT,
  official_answer_date TIMESTAMPTZ,
  item_id INT REFERENCES collector_items(id) ON DELETE SET NULL,
  prompt_version INT NOT NULL DEFAULT 0,    -- версия разметки: 0 = не размечен (сырой)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id)
);

CREATE INDEX pain_radar_reviews_org_idx ON pain_radar_reviews (org_id);
CREATE INDEX pain_radar_reviews_date_idx ON pain_radar_reviews (review_date DESC);
CREATE INDEX pain_radar_reviews_unmarked_idx ON pain_radar_reviews (prompt_version)
  WHERE prompt_version = 0;

-- Боли: LLM-разметка отзыва по таксономии v1 (+ класс wish по Ф2, приёмник other).
-- Статистика — SQL-агрегация поверх этой таблицы (топ категорий × ниши × город).
CREATE TABLE pain_radar_pains (
  id SERIAL PRIMARY KEY,
  review_id INT NOT NULL REFERENCES pain_radar_reviews(id) ON DELETE CASCADE,
  category TEXT NOT NULL,                   -- booking_access | ... | missing_service | wish | other
  summary TEXT NOT NULL,                    -- каноническая формулировка (Ф4, ODI: «минимизировать время …»)
  quote TEXT,                               -- дословная цитата-доказательство
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pain_radar_pains_category_idx ON pain_radar_pains (category);
CREATE INDEX pain_radar_pains_review_idx ON pain_radar_pains (review_id);

-- Идеи (сценарий Б): профиль + собранные боли → выдача LLM. Структура ideas — в архитектуре.
CREATE TABLE pain_radar_ideas (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  profile JSONB NOT NULL,
  city_region_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL,
  ideas JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
