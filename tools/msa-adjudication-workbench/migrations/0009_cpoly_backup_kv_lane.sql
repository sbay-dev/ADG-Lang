CREATE TABLE cpoly_backup_chunk_inventory (
  backup_id TEXT NOT NULL
    REFERENCES cpoly_backup_sets(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (
    chunk_index >= 0 AND chunk_index <= 4096
  ),
  kv_key TEXT NOT NULL CHECK (
    length(kv_key) >= 1 AND length(kv_key) <= 512
  ),
  plaintext_size_bytes INTEGER NOT NULL CHECK (
    plaintext_size_bytes > 0 AND plaintext_size_bytes <= 786432
  ),
  plaintext_sha256 TEXT NOT NULL CHECK (
    length(plaintext_sha256) = 64
    AND plaintext_sha256 GLOB '[0-9a-f]*'
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (backup_id, chunk_index),
  UNIQUE (kv_key)
);

CREATE INDEX idx_cpoly_backup_chunk_inventory_backup_order
  ON cpoly_backup_chunk_inventory(backup_id, chunk_index, kv_key);

INSERT INTO cpoly_backup_chunk_inventory (
  backup_id,
  chunk_index,
  kv_key,
  plaintext_size_bytes,
  plaintext_sha256,
  created_at
)
SELECT
  backup_id,
  chunk_index,
  'legacy-d1:' || lower(backup_id) || ':' || chunk_index,
  plaintext_size_bytes,
  plaintext_sha256,
  created_at
FROM cpoly_backup_chunks
WHERE NOT EXISTS (
  SELECT 1
    FROM cpoly_backup_chunk_inventory inventory
   WHERE inventory.backup_id = cpoly_backup_chunks.backup_id
     AND inventory.chunk_index = cpoly_backup_chunks.chunk_index
);
