ALTER TABLE submissions ADD COLUMN participant_pseudonym TEXT;
ALTER TABLE submissions ADD COLUMN artifact_type TEXT;
ALTER TABLE submissions ADD COLUMN artifact_json TEXT;
ALTER TABLE submissions
  ADD COLUMN repository_status TEXT NOT NULL DEFAULT 'pending-validation';

ALTER TABLE users ADD COLUMN verified_email_hash TEXT;

CREATE UNIQUE INDEX idx_users_verified_email_hash
  ON users(verified_email_hash)
  WHERE verified_email_hash IS NOT NULL;

CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (
    attempts >= 0 AND attempts <= 5
  ),
  expires_at INTEGER NOT NULL,
  resend_after INTEGER NOT NULL,
  verified_at INTEGER,
  verification_token_hash TEXT,
  token_expires_at INTEGER,
  reserved_at INTEGER,
  reservation_id TEXT,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_email_verifications_email_time
  ON email_verifications(email_hash, created_at);

CREATE INDEX idx_email_verifications_request_time
  ON email_verifications(request_fingerprint, created_at);

CREATE INDEX idx_email_verifications_expiry
  ON email_verifications(expires_at, token_expires_at);

ALTER TABLE webauthn_challenges
  ADD COLUMN email_verification_id TEXT
    REFERENCES email_verifications(id) ON DELETE SET NULL;

ALTER TABLE webauthn_challenges
  ADD COLUMN verified_email_hash TEXT;

CREATE UNIQUE INDEX idx_submissions_unique_user_task_role
  ON submissions(user_id, packet_id, role);

CREATE INDEX idx_submissions_packet_time
  ON submissions(packet_id, submitted_at);

CREATE TABLE result_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  source_receipt_id TEXT NOT NULL
    REFERENCES submissions(receipt_id) ON DELETE CASCADE,
  first_viewed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, packet_id)
);

CREATE TABLE discussion_comments (
  comment_id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_pseudonym TEXT NOT NULL,
  source_receipt_id TEXT NOT NULL
    REFERENCES submissions(receipt_id) ON DELETE CASCADE,
  target_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE CASCADE,
  parent_comment_id TEXT
    REFERENCES discussion_comments(comment_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN (
      'agreement',
      'disagreement',
      'question',
      'clarification',
      'evidence',
      'final-result',
      'consensus-proposal',
      'escalation',
      'appeal',
      'recusal'
    )
  ),
  body TEXT NOT NULL,
  sentence_id TEXT,
  token_id INTEGER,
  mentions_json TEXT NOT NULL,
  references_json TEXT NOT NULL,
  github_status TEXT NOT NULL DEFAULT 'pending-validation' CHECK (
    github_status IN (
      'pending-validation',
      'imported',
      'rejected'
    )
  ),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_discussion_comments_packet_time
  ON discussion_comments(packet_id, created_at);

CREATE INDEX idx_discussion_comments_target
  ON discussion_comments(target_receipt_id, created_at);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'comment',
      'mention',
      'final-result-difference'
    )
  ),
  packet_id TEXT NOT NULL,
  comment_id TEXT REFERENCES discussion_comments(comment_id) ON DELETE CASCADE,
  source_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE CASCADE,
  context_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'skipped')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX idx_notification_outbox_ready
  ON notification_outbox(status, next_attempt_at);
