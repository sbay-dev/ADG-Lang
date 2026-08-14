ALTER TABLE cpoly_backup_sets
  ADD COLUMN descriptor_json TEXT CHECK (
    descriptor_json IS NULL OR length(descriptor_json) <= 262144
  );

ALTER TABLE cpoly_backup_sets
  ADD COLUMN descriptor_sha256 TEXT CHECK (
    descriptor_sha256 IS NULL
    OR (length(descriptor_sha256) = 64 AND descriptor_sha256 GLOB '[0-9a-f]*')
  );
