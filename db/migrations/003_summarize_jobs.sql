CREATE TABLE summarize_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'url'
    CHECK (kind IN ('url', 'file', 'mic')),
  source_url TEXT,
  source_host TEXT,
  source_title TEXT,
  source_bytes BIGINT,
  audio_only BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT,
  duration_sec DOUBLE PRECISION,
  audio_bytes BIGINT,
  audio_file TEXT,
  has_audio BOOLEAN NOT NULL DEFAULT false,
  has_summary BOOLEAN NOT NULL DEFAULT false,
  summary_title TEXT,
  language TEXT,
  provider TEXT,
  model TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX summarize_jobs_user_created_idx
  ON summarize_jobs (user_id, created_at DESC);

CREATE INDEX summarize_jobs_guest_created_idx
  ON summarize_jobs (guest_id, created_at DESC);
