CREATE TABLE task_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL CHECK (task_version >= 1),
  packet_id TEXT NOT NULL,
  holdout_id TEXT NOT NULL,
  packet_merkle_root TEXT NOT NULL CHECK (length(packet_merkle_root) = 64),
  guideline_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  metric_policy_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'draft',
      'open',
      'independent-review',
      'discussion',
      'final-review',
      'approved',
      'published',
      'escalated',
      'reissued',
      'revoked',
      'failed'
    )
  ),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round >= 1),
  last_event_id TEXT,
  active_final_receipt_id TEXT,
  appeal_deadline_at INTEGER,
  repository_status TEXT NOT NULL DEFAULT 'not-sent' CHECK (
    repository_status IN (
      'not-sent',
      'pending',
      'accepted',
      'rejected'
    )
  ),
  github_issue_number INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  published_at INTEGER,
  revoked_at INTEGER,
  UNIQUE (task_id, task_version),
  UNIQUE (packet_id, packet_merkle_root)
);

CREATE INDEX idx_task_versions_state
  ON task_versions(state, updated_at);

CREATE INDEX idx_task_versions_holdout
  ON task_versions(holdout_id, task_version);

CREATE UNIQUE INDEX idx_task_versions_packet_id
  ON task_versions(packet_id);

CREATE TABLE consensus_rounds (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('open', 'closed', 'superseded', 'failed')
  ),
  reissue_reason TEXT CHECK (
    reissue_reason IS NULL OR reissue_reason IN (
      'missing-quorum-deadline',
      'accepted-recusal',
      'j2-disagreement',
      'accepted-appeal',
      'material-evidence-defect',
      'low-independent-agreement',
      'novel-primary-decision'
    )
  ),
  opened_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  closed_at INTEGER,
  prior_round_id TEXT REFERENCES consensus_rounds(id) ON DELETE SET NULL,
  UNIQUE (task_version_id, round_number)
);

CREATE INDEX idx_consensus_rounds_deadline
  ON consensus_rounds(status, deadline_at);

CREATE TABLE consensus_events (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES consensus_rounds(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_subject_hash TEXT,
  reason_code TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  prior_state_hash TEXT,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_consensus_events_task_time
  ON consensus_events(task_version_id, created_at);

CREATE TABLE task_participations (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE CASCADE,
  holdout_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2', 'appeal-reviewer')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('assigned', 'submitted', 'recused', 'replaced')
  ),
  submission_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_version_id, user_id),
  UNIQUE (holdout_id, user_id)
);

CREATE UNIQUE INDEX idx_task_participations_round_role
  ON task_participations(round_id, role)
  WHERE role IN ('A', 'B', 'J1', 'J2');

CREATE INDEX idx_task_participations_task_role
  ON task_participations(task_version_id, role, status);

ALTER TABLE submissions ADD COLUMN task_version_id TEXT
  REFERENCES task_versions(id) ON DELETE RESTRICT;
ALTER TABLE submissions ADD COLUMN round_id TEXT
  REFERENCES consensus_rounds(id) ON DELETE RESTRICT;
ALTER TABLE submissions ADD COLUMN holdout_id TEXT;
ALTER TABLE submissions ADD COLUMN guideline_version TEXT;
ALTER TABLE submissions ADD COLUMN data_version TEXT;
ALTER TABLE submissions ADD COLUMN protocol_version TEXT;
ALTER TABLE submissions ADD COLUMN consensus_role TEXT;
ALTER TABLE submissions ADD COLUMN consensus_round INTEGER;
ALTER TABLE submissions ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE submissions ADD COLUMN superseded_by_receipt_id TEXT
  REFERENCES submissions(receipt_id) ON DELETE SET NULL;

ALTER TABLE result_access ADD COLUMN task_version_id TEXT
  REFERENCES task_versions(id) ON DELETE CASCADE;
ALTER TABLE result_access ADD COLUMN round_id TEXT
  REFERENCES consensus_rounds(id) ON DELETE CASCADE;

ALTER TABLE discussion_comments ADD COLUMN task_version_id TEXT
  REFERENCES task_versions(id) ON DELETE CASCADE;
ALTER TABLE discussion_comments ADD COLUMN round_id TEXT
  REFERENCES consensus_rounds(id) ON DELETE CASCADE;

UPDATE result_access
   SET task_version_id = (
         SELECT task_version_id
           FROM submissions
          WHERE receipt_id = result_access.source_receipt_id
       ),
       round_id = (
         SELECT round_id
           FROM submissions
          WHERE receipt_id = result_access.source_receipt_id
       );

UPDATE discussion_comments
   SET task_version_id = (
         SELECT task_version_id
           FROM submissions
          WHERE receipt_id = discussion_comments.source_receipt_id
       ),
       round_id = (
         SELECT round_id
           FROM submissions
          WHERE receipt_id = discussion_comments.source_receipt_id
       );

CREATE INDEX idx_result_access_task_user
  ON result_access(task_version_id, round_id, user_id);

CREATE INDEX idx_discussion_comments_task_round
  ON discussion_comments(task_version_id, round_id, created_at);

DROP INDEX idx_submissions_unique_user_task_role;

CREATE UNIQUE INDEX idx_submissions_unique_user_packet
  ON submissions(user_id, packet_id);

CREATE UNIQUE INDEX idx_submissions_round_role
  ON submissions(task_version_id, consensus_round, consensus_role)
  WHERE task_version_id IS NOT NULL
    AND consensus_role IN ('A', 'B', 'J1', 'J2');

CREATE INDEX idx_submissions_task_round
  ON submissions(task_version_id, consensus_round, consensus_role);

CREATE TABLE consensus_metrics (
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE CASCADE,
  annotation_a_receipt_id TEXT NOT NULL
    REFERENCES submissions(receipt_id) ON DELETE RESTRICT,
  annotation_b_receipt_id TEXT NOT NULL
    REFERENCES submissions(receipt_id) ON DELETE RESTRICT,
  metrics_json TEXT NOT NULL,
  policy_passed INTEGER NOT NULL CHECK (policy_passed IN (0, 1)),
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (task_version_id, round_id)
);

CREATE TABLE final_results (
  primary_receipt_id TEXT PRIMARY KEY
    REFERENCES submissions(receipt_id) ON DELETE RESTRICT,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE RESTRICT,
  secondary_receipt_id TEXT
    REFERENCES submissions(receipt_id) ON DELETE RESTRICT,
  final_merkle_root TEXT NOT NULL CHECK (length(final_merkle_root) = 64),
  status TEXT NOT NULL CHECK (
    status IN ('proposed', 'active', 'superseded', 'revoked')
  ),
  supersedes_receipt_id TEXT
    REFERENCES final_results(primary_receipt_id) ON DELETE SET NULL,
  proposed_at INTEGER NOT NULL,
  approved_at INTEGER,
  published_at INTEGER,
  revoked_at INTEGER,
  revocation_reason TEXT
);

CREATE UNIQUE INDEX idx_final_results_one_active
  ON final_results(task_version_id)
  WHERE status = 'active';

CREATE TABLE recusals (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2', 'appeal-reviewer')
  ),
  scope TEXT NOT NULL CHECK (
    scope IN ('round', 'task-version', 'holdout-family')
  ),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (round_id, user_id)
);

CREATE TABLE appeals (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE RESTRICT,
  appellant_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  final_receipt_id TEXT NOT NULL
    REFERENCES final_results(primary_receipt_id) ON DELETE RESTRICT,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewer_subject_hash TEXT,
  review_reason TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  UNIQUE (task_version_id, appellant_user_id, final_receipt_id)
);

CREATE TABLE discussion_moderation (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL
    REFERENCES discussion_comments(comment_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (
    state IN ('visible', 'hidden', 'redacted', 'blocked')
  ),
  reason TEXT NOT NULL,
  original_body_hash TEXT NOT NULL CHECK (length(original_body_hash) = 64),
  actor_subject_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_discussion_moderation_comment
  ON discussion_moderation(comment_id, created_at);

CREATE TABLE repository_receipts (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES consensus_rounds(id) ON DELETE RESTRICT,
  final_merkle_root TEXT NOT NULL CHECK (length(final_merkle_root) = 64),
  nonce TEXT NOT NULL UNIQUE,
  pr_number INTEGER NOT NULL,
  pr_merge_sha TEXT NOT NULL CHECK (length(pr_merge_sha) = 40),
  importer_commit_sha TEXT NOT NULL CHECK (length(importer_commit_sha) = 40),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (length(signature_sha256) = 64),
  received_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  UNIQUE (task_version_id, final_merkle_root)
);

CREATE TABLE evidence_repository_receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('submission', 'comment')),
  related_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_merge_sha TEXT NOT NULL CHECK (length(pr_merge_sha) = 40),
  importer_commit_sha TEXT NOT NULL CHECK (length(importer_commit_sha) = 40),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (length(signature_sha256) = 64),
  accepted_at INTEGER NOT NULL,
  UNIQUE (kind, related_id)
);

CREATE TABLE evidence_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN ('submission', 'comment', 'task-state')
  ),
  task_version_id TEXT
    REFERENCES task_versions(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL,
  public_blob_name TEXT NOT NULL,
  identity_blob_name TEXT,
  public_payload_json TEXT NOT NULL,
  identity_payload_json TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'held',
      'pending',
      'sending',
      'sent',
      'failed',
      'cancelled'
    )
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX idx_evidence_outbox_ready
  ON evidence_outbox(status, next_attempt_at);

CREATE TABLE governance_notification_outbox (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'task-reissued',
      'result-approved',
      'result-published',
      'result-revoked',
      'appeal-opened',
      'appeal-decided'
    )
  ),
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
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

CREATE INDEX idx_governance_notification_ready
  ON governance_notification_outbox(status, next_attempt_at);

CREATE TABLE identity_erasure_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'completed', 'rejected')
  ),
  requested_at INTEGER NOT NULL,
  eligible_after INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (user_id, status)
);

CREATE INDEX idx_identity_erasure_ready
  ON identity_erasure_requests(status, eligible_after);

CREATE TABLE identity_erasure_items (
  request_id TEXT NOT NULL
    REFERENCES identity_erasure_requests(id) ON DELETE CASCADE,
  blob_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'deleted')
  ),
  deleted_at INTEGER,
  PRIMARY KEY (request_id, blob_name)
);
