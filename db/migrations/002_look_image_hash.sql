-- Deduplicate uploads by content hash of the image file

ALTER TABLE look_images
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS look_images_content_hash_idx ON look_images(content_hash);

-- Latest look per owner + hash (partial unique for non-null hashes would need user/guest join;
-- uniqueness enforced in app on upload).
CREATE INDEX IF NOT EXISTS look_images_hash_look_idx ON look_images(content_hash, look_id);
