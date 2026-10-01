-- Сдвиги, фаза 2 (И3): направление — свойство связи «сдвиг × адресат», ниши — M:N.
-- Один сдвиг почти всегда мультинишевый; маркировка — threat производителю и
-- opportunity тому, кто помогает её внедрить (docs/idea-radar-architecture.md).

-- Канон предмета: «маркировка пивной продукции» приводится к «маркировке пива».
CREATE TABLE idea_radar_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  niche_id UUID REFERENCES radar_niches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
  merged_into UUID REFERENCES idea_radar_subjects(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idea_radar_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES idea_radar_stories(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'new_duty', 'new_permission', 'public_money', 'tech_enabler',
    'platform_change', 'infrastructure', 'behavior_shift', 'demography', 'other'
  )),
  region_id UUID REFERENCES radar_regions(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES idea_radar_subjects(id) ON DELETE SET NULL,
  subject_raw TEXT,
  effective_date DATE,
  summary TEXT NOT NULL,
  quote TEXT,
  quote_verified BOOLEAN NOT NULL DEFAULT false,
  taxonomy_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idea_radar_shifts_story_idx ON idea_radar_shifts (story_id);
CREATE INDEX idea_radar_shifts_effective_idx ON idea_radar_shifts (effective_date);

-- Адресат сдвига: ниша × направление. Одна пара — один вердикт; двойной вердикт
-- одной нише («duty и opportunity») — это два разных сдвига.
CREATE TABLE idea_radar_shift_addressees (
  shift_id UUID NOT NULL REFERENCES idea_radar_shifts(id) ON DELETE CASCADE,
  niche_id UUID NOT NULL REFERENCES radar_niches(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('duty', 'opportunity', 'threat')),
  PRIMARY KEY (shift_id, niche_id)
);

CREATE INDEX idea_radar_shift_addressees_niche_idx ON idea_radar_shift_addressees (niche_id);
