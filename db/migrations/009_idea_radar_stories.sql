-- Сюжеты — кластеры перепечаток (И10, ступень B): один факт, покрытый несколькими
-- изданиями, считается один сигнал, охват — число независимых источников
-- (docs/idea-radar-architecture.md, раздел «Сюжеты и склейка перепечаток»).
CREATE TABLE idea_radar_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE idea_radar_publications
  ADD COLUMN story_id UUID REFERENCES idea_radar_stories(id) ON DELETE SET NULL;

CREATE INDEX idea_radar_publications_story_idx ON idea_radar_publications (story_id);
