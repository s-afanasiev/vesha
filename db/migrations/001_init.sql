-- Подборка одежды — initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'password')),
  provider_subject TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('guest', 'user')),
  subject_id UUID NOT NULL,
  day DATE NOT NULL DEFAULT (CURRENT_DATE),
  uploads_count INT NOT NULL DEFAULT 0,
  searches_count INT NOT NULL DEFAULT 0,
  UNIQUE (subject_type, subject_id, day)
);

CREATE TABLE looks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'analyzing', 'ready', 'failed')),
  title TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
);

CREATE INDEX looks_user_id_idx ON looks(user_id);
CREATE INDEX looks_guest_id_idx ON looks(guest_id);

CREATE TABLE look_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id UUID NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INT,
  height INT,
  bytes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX look_images_look_id_idx ON look_images(look_id);

CREATE TABLE ai_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id UUID NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  raw_response JSONB,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_queries TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_extractions_look_id_idx ON ai_extractions(look_id);

CREATE TABLE search_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id UUID NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'serpapi_yandex',
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  raw_response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX search_jobs_look_id_idx ON search_jobs(look_id);

CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id UUID NOT NULL REFERENCES looks(id) ON DELETE CASCADE,
  search_job_id UUID REFERENCES search_jobs(id) ON DELETE SET NULL,
  shop TEXT NOT NULL DEFAULT 'other'
    CHECK (shop IN ('wildberries', 'ozon', 'other')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price_cents INT,
  currency TEXT DEFAULT 'RUB',
  thumbnail_url TEXT,
  snippet TEXT,
  score REAL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX offers_look_id_idx ON offers(look_id);
