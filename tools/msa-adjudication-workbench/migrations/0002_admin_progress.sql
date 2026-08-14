ALTER TABLE drafts ADD COLUMN completion_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drafts ADD COLUMN completed_fields INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drafts ADD COLUMN total_fields INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drafts ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE submissions (
  receipt_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);

CREATE INDEX idx_submissions_user_task
  ON submissions(user_id, packet_id, role, submitted_at);

CREATE TABLE admin_oidc_states (
  state_hash TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_oidc_states_expiry
  ON admin_oidc_states(expires_at);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL,
  identity_ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_sessions_expiry
  ON admin_sessions(expires_at);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  subject_hash TEXT,
  event_type TEXT NOT NULL,
  success INTEGER NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_audit_created
  ON admin_audit(created_at);
