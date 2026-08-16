BEGIN;

SET search_path TO adjudication, public;

CREATE TABLE IF NOT EXISTS portal_issue_reports (
  id TEXT PRIMARY KEY CHECK (
    id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'access',
      'task-inbox',
      'autosave',
      'adjudication',
      'submission',
      'display',
      'other'
    )
  ),
  summary TEXT NOT NULL CHECK (
    length(summary) >= 10 AND length(summary) <= 160
  ),
  payload_json TEXT NOT NULL CHECK (
    length(payload_json) >= 2 AND length(payload_json) <= 12000
  ),
  content_sha256 TEXT NOT NULL CHECK (
    content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'published')
  ),
  claim_nonce TEXT,
  claim_expires_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  github_issue_number BIGINT CHECK (
    github_issue_number IS NULL OR github_issue_number > 0
  ),
  github_issue_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT,
  CHECK (
    status <> 'published'
    OR (
      github_issue_number IS NOT NULL
      AND github_issue_url IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_issue_reports_ready
  ON portal_issue_reports(status, claim_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_portal_issue_reports_user
  ON portal_issue_reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_issue_report_claims (
  nonce TEXT PRIMARY KEY CHECK (
    nonce ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  requested_at BIGINT NOT NULL,
  claimed_at BIGINT NOT NULL
);

COMMIT;
