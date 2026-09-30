-- Миграция 007: Суперсправочник (super_notes)
-- Заметки, полезные ссылки, иерархические деревья, теги и семантический поиск

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension is not available on this server; semantic search will use JSON fallback';
END
$$;

-- 1. Основная таблица заметок
CREATE TABLE IF NOT EXISTS super_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_raw TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  color TEXT,
  tsv_content TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS super_notes_user_idx ON super_notes(user_id, is_archived, is_pinned);
CREATE INDEX IF NOT EXISTS super_notes_guest_idx ON super_notes(guest_id, is_archived, is_pinned);
CREATE INDEX IF NOT EXISTS super_notes_tsv_idx ON super_notes USING GIN(tsv_content);

-- Триггер для обновления полнотекстового индекса (русский язык + простой fallback)
CREATE OR REPLACE FUNCTION super_notes_tsv_trigger() RETURNS trigger AS $$
BEGIN
  new.tsv_content := 
    setweight(to_tsvector('russian', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(new.summary, '')), 'B') ||
    setweight(to_tsvector('russian', coalesce(new.content_raw, '')), 'C');
  new.updated_at := now();
  RETURN new;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tsvectorupdate ON super_notes;
CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
  ON super_notes FOR EACH ROW EXECUTE FUNCTION super_notes_tsv_trigger();

-- 2. Таблица тегов
CREATE TABLE IF NOT EXISTS super_note_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS super_note_tags_user_name_uniq 
  ON super_note_tags (user_id, name) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS super_note_tags_guest_name_uniq 
  ON super_note_tags (guest_id, name) WHERE guest_id IS NOT NULL;

-- 3. Связь заметки и тега
CREATE TABLE IF NOT EXISTS super_note_tag_bindings (
  note_id UUID NOT NULL REFERENCES super_notes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES super_note_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS super_note_tag_bindings_tag_idx 
  ON super_note_tag_bindings (tag_id);

-- 4. Семантические эмбеддинги (pgvector с безопасным fallback)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS super_note_embeddings (
      note_id UUID PRIMARY KEY REFERENCES super_notes(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      embedding vector(768),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Индекс HNSW для быстрого косинусного поиска
    CREATE INDEX IF NOT EXISTS super_note_embeddings_hnsw ON super_note_embeddings 
      USING hnsw (embedding vector_cosine_ops);
  ELSE
    CREATE TABLE IF NOT EXISTS super_note_embeddings (
      note_id UUID PRIMARY KEY REFERENCES super_notes(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      embedding_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  END IF;
END
$$;
