ALTER TABLE summarize_jobs
  ADD COLUMN IF NOT EXISTS source_bytes BIGINT;
