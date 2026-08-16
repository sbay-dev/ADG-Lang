CREATE TABLE portal_issue_reports (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
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
    length(content_sha256) = 64
    AND content_sha256 GLOB '[0-9a-f]*'
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'published')
  ),
  claim_nonce TEXT,
  claim_expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  github_issue_number INTEGER CHECK (
    github_issue_number IS NULL OR github_issue_number > 0
  ),
  github_issue_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  CHECK (
    status <> 'published'
    OR (
      github_issue_number IS NOT NULL
      AND github_issue_url IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);

CREATE INDEX idx_portal_issue_reports_ready
  ON portal_issue_reports(status, claim_expires_at, created_at);

CREATE INDEX idx_portal_issue_reports_user
  ON portal_issue_reports(user_id, created_at DESC);

CREATE TABLE portal_issue_report_claims (
  nonce TEXT PRIMARY KEY CHECK (length(nonce) = 36),
  requested_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL
);
