BEGIN;

SET search_path TO adjudication, public;

CREATE TABLE IF NOT EXISTS repository_task_packets (
  task_version_id TEXT PRIMARY KEY
    REFERENCES task_versions(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL UNIQUE,
  packet_merkle_root TEXT NOT NULL CHECK (
    packet_merkle_root ~ '^[0-9a-f]{64}$'
  ),
  manifest_json TEXT NOT NULL CHECK (
    length(manifest_json) >= 2 AND length(manifest_json) <= 1000000
  ),
  immutable_manifest_sha256 TEXT NOT NULL CHECK (
    immutable_manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  assignment_mode TEXT NOT NULL CHECK (
    assignment_mode IN ('open', 'assigned')
  ),
  lane TEXT NOT NULL CHECK (
    lane IN ('standard', 'operational-test')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('active', 'withdrawn')
  ),
  source_repository TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  source_commit_sha TEXT NOT NULL CHECK (
    source_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  first_synced_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repository_task_packets_status
  ON repository_task_packets(status, lane, assignment_mode, updated_at);

CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE CASCADE,
  holdout_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2')
  ),
  email_hash TEXT NOT NULL CHECK (
    email_hash ~ '^[0-9a-f]{64}$'
  ),
  email_ciphertext TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN ('invited', 'claimed', 'submitted', 'cancelled')
  ),
  submission_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE SET NULL,
  invited_at BIGINT NOT NULL,
  claimed_at BIGINT,
  submitted_at BIGINT,
  updated_at BIGINT NOT NULL,
  UNIQUE (task_version_id, round_id, role)
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_email
  ON task_assignments(email_hash, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_task_assignments_user
  ON task_assignments(user_id, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_assignments_holdout_user
  ON task_assignments(holdout_id, user_id)
  WHERE user_id IS NOT NULL
    AND status IN ('invited', 'claimed', 'submitted');

CREATE TABLE IF NOT EXISTS operational_task_claims (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('A', 'B')),
  status TEXT NOT NULL CHECK (
    status IN ('claimed', 'submitted')
  ),
  submission_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE SET NULL,
  claimed_at BIGINT NOT NULL,
  submitted_at BIGINT,
  updated_at BIGINT NOT NULL,
  UNIQUE (task_version_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_operational_task_claims_user
  ON operational_task_claims(user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS repository_task_syncs (
  nonce TEXT PRIMARY KEY,
  source_commit_sha TEXT NOT NULL UNIQUE CHECK (
    source_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  payload_sha256 TEXT NOT NULL CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  synced_at BIGINT NOT NULL
);

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

CREATE TABLE IF NOT EXISTS draft_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  content_sha256 TEXT,
  completion_percent INTEGER NOT NULL,
  completed_fields INTEGER NOT NULL,
  total_fields INTEGER NOT NULL,
  saved_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_revisions_lookup
  ON draft_revisions(user_id, packet_id, role, saved_at DESC);

COMMIT;
