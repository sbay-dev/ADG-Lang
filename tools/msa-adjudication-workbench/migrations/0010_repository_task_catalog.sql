CREATE TABLE repository_task_packets (
  task_version_id TEXT PRIMARY KEY
    REFERENCES task_versions(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL UNIQUE,
  packet_merkle_root TEXT NOT NULL CHECK (
    length(packet_merkle_root) = 64
    AND packet_merkle_root GLOB '[0-9a-f]*'
  ),
  manifest_json TEXT NOT NULL CHECK (
    length(manifest_json) >= 2 AND length(manifest_json) <= 1000000
  ),
  immutable_manifest_sha256 TEXT NOT NULL CHECK (
    length(immutable_manifest_sha256) = 64
    AND immutable_manifest_sha256 GLOB '[0-9a-f]*'
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
    length(source_commit_sha) = 40
    AND source_commit_sha GLOB '[0-9a-f]*'
  ),
  first_synced_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_repository_task_packets_status
  ON repository_task_packets(status, lane, assignment_mode, updated_at);

CREATE TABLE task_assignments (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE CASCADE,
  holdout_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2')
  ),
  email_hash TEXT NOT NULL CHECK (length(email_hash) = 64),
  email_ciphertext TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN ('invited', 'claimed', 'submitted', 'cancelled')
  ),
  submission_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE SET NULL,
  invited_at INTEGER NOT NULL,
  claimed_at INTEGER,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_version_id, round_id, role)
);

CREATE INDEX idx_task_assignments_email
  ON task_assignments(email_hash, status, updated_at);

CREATE INDEX idx_task_assignments_user
  ON task_assignments(user_id, status, updated_at);

CREATE UNIQUE INDEX idx_task_assignments_holdout_user
  ON task_assignments(holdout_id, user_id)
  WHERE user_id IS NOT NULL
    AND status IN ('invited', 'claimed', 'submitted');

CREATE TABLE operational_task_claims (
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
  claimed_at INTEGER NOT NULL,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_version_id, user_id)
);

CREATE INDEX idx_operational_task_claims_user
  ON operational_task_claims(user_id, status, updated_at);

CREATE TABLE repository_task_syncs (
  nonce TEXT PRIMARY KEY,
  source_commit_sha TEXT NOT NULL UNIQUE CHECK (
    length(source_commit_sha) = 40
    AND source_commit_sha GLOB '[0-9a-f]*'
  ),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 GLOB '[0-9a-f]*'
  ),
  synced_at INTEGER NOT NULL
);

ALTER TABLE drafts ADD COLUMN content_sha256 TEXT;

CREATE TABLE draft_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  content_sha256 TEXT,
  completion_percent INTEGER NOT NULL,
  completed_fields INTEGER NOT NULL,
  total_fields INTEGER NOT NULL,
  saved_at INTEGER NOT NULL
);

CREATE INDEX idx_draft_revisions_lookup
  ON draft_revisions(user_id, packet_id, role, saved_at DESC);
