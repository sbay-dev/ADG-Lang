ALTER TABLE cpoly_backup_sets
  ADD COLUMN manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL
    OR (length(manifest_sha256) = 64 AND manifest_sha256 GLOB '[0-9a-f]*')
  );
