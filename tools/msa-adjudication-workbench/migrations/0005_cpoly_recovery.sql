CREATE TABLE cpoly_backup_sets (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('uploading', 'complete', 'failed', 'expired')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  total_size_bytes INTEGER CHECK (
    total_size_bytes IS NULL OR total_size_bytes > 0
  ),
  chunk_count INTEGER CHECK (
    chunk_count IS NULL OR chunk_count > 0
  ),
  sha256 TEXT CHECK (
    sha256 IS NULL OR (length(sha256) = 64 AND sha256 GLOB '[0-9a-f]*')
  ),
  uploaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0),
  uploaded_chunks INTEGER NOT NULL DEFAULT 0 CHECK (uploaded_chunks >= 0),
  completed_at INTEGER,
  CHECK (
    completed_at IS NULL
    OR (
      total_size_bytes IS NOT NULL
      AND chunk_count IS NOT NULL
      AND sha256 IS NOT NULL
    )
  )
);

CREATE INDEX idx_cpoly_backup_sets_status_time
  ON cpoly_backup_sets(status, completed_at, created_at);

CREATE INDEX idx_cpoly_backup_sets_expiry
  ON cpoly_backup_sets(expires_at, created_at);

CREATE TABLE cpoly_backup_chunks (
  backup_id TEXT NOT NULL
    REFERENCES cpoly_backup_sets(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (
    chunk_index >= 0 AND chunk_index <= 4096
  ),
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) <= 1048576),
  plaintext_size_bytes INTEGER NOT NULL CHECK (
    plaintext_size_bytes > 0 AND plaintext_size_bytes <= 786432
  ),
  plaintext_sha256 TEXT NOT NULL CHECK (
    length(plaintext_sha256) = 64
    AND plaintext_sha256 GLOB '[0-9a-f]*'
  ),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (backup_id, chunk_index)
);

CREATE INDEX idx_cpoly_backup_chunks_backup_order
  ON cpoly_backup_chunks(backup_id, chunk_index);

CREATE TABLE cpoly_signed_api_nonces (
  nonce TEXT PRIMARY KEY,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  body_sha256 TEXT NOT NULL CHECK (
    length(body_sha256) = 64 AND body_sha256 GLOB '[0-9a-f]*'
  ),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX idx_cpoly_signed_api_nonces_expiry
  ON cpoly_signed_api_nonces(expires_at, created_at);

CREATE TABLE cpoly_pg_write_journal (
  request_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 64 AND payload_hash GLOB '[0-9a-f]*'
  ),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('run', 'batch')),
  statement_count INTEGER NOT NULL CHECK (
    statement_count >= 1 AND statement_count <= 512
  ),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) <= 1800000),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  applied_at INTEGER,
  CHECK (
    (status = 'applied' AND applied_at IS NOT NULL)
    OR (status <> 'applied')
  )
);

CREATE INDEX idx_cpoly_pg_write_journal_status_time
  ON cpoly_pg_write_journal(status, created_at, updated_at);
