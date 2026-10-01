-- Журнал разметки сюжетов: факт «сюжет размечен этой версией промпта» и сколько
-- сдвигов нашлось. Сюжеты без сдвигов тоже записываются — иначе они вечно «в ожидании»
-- (docs/idea-radar-architecture.md, раздел «Разметка сдвигов», И8).
CREATE TABLE idea_radar_markings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES idea_radar_stories(id) ON DELETE CASCADE,
  shifts_found INT NOT NULL DEFAULT 0,
  prompt_version TEXT NOT NULL,
  model TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idea_radar_markings_story_idx ON idea_radar_markings (story_id, prompt_version);
