-- Adapted from the portal PostgreSQL schema for the CPOLY operator.
-- Operator-owned migration tracking is adjudication.schema_migrations(name, checksum_sha256).
-- This file intentionally contains no private schema_migrations table and no outer transaction.

CREATE SCHEMA IF NOT EXISTS adjudication AUTHORIZATION adg_owner;

CREATE TABLE IF NOT EXISTS adjudication.users (
  id TEXT PRIMARY KEY,
  profile_ciphertext TEXT NOT NULL,
  consent_json TEXT NOT NULL,
  verified_email_hash TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email_hash
  ON adjudication.users(verified_email_hash)
  WHERE verified_email_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS adjudication.email_verifications (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (
    attempts >= 0 AND attempts <= 5
  ),
  expires_at BIGINT NOT NULL,
  resend_after BIGINT NOT NULL,
  verified_at BIGINT,
  verification_token_hash TEXT,
  token_expires_at BIGINT,
  reserved_at BIGINT,
  reservation_id TEXT,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email_time
  ON adjudication.email_verifications(email_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_email_verifications_request_time
  ON adjudication.email_verifications(request_fingerprint, created_at);

CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry
  ON adjudication.email_verifications(expires_at, token_expires_at);

CREATE TABLE IF NOT EXISTS adjudication.webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id TEXT,
  profile_ciphertext TEXT,
  consent_json TEXT,
  email_verification_id TEXT
    REFERENCES adjudication.email_verifications(id) ON DELETE SET NULL,
  verified_email_hash TEXT,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry
  ON adjudication.webauthn_challenges(expires_at);

CREATE TABLE IF NOT EXISTS adjudication.passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL,
  transports_json TEXT NOT NULL,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON adjudication.passkeys(user_id);

CREATE TABLE IF NOT EXISTS adjudication.sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON adjudication.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON adjudication.sessions(expires_at);

CREATE TABLE IF NOT EXISTS adjudication.drafts (
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  completion_percent INTEGER NOT NULL DEFAULT 0,
  completed_fields INTEGER NOT NULL DEFAULT 0,
  total_fields INTEGER NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, packet_id, role)
);

CREATE TABLE IF NOT EXISTS adjudication.admin_oidc_states (
  state_hash TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_oidc_states_expiry
  ON adjudication.admin_oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS adjudication.admin_sessions (
  token_hash TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL,
  identity_ciphertext TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON adjudication.admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS adjudication.admin_audit (
  id TEXT PRIMARY KEY,
  subject_hash TEXT,
  event_type TEXT NOT NULL,
  success INTEGER NOT NULL,
  detail TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON adjudication.admin_audit(created_at);

CREATE TABLE IF NOT EXISTS adjudication.task_versions (
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
  appeal_deadline_at BIGINT,
  repository_status TEXT NOT NULL DEFAULT 'not-sent' CHECK (
    repository_status IN (
      'not-sent',
      'pending',
      'accepted',
      'rejected'
    )
  ),
  github_issue_number BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  approved_at BIGINT,
  published_at BIGINT,
  revoked_at BIGINT,
  UNIQUE (task_id, task_version),
  UNIQUE (packet_id, packet_merkle_root)
);

CREATE INDEX IF NOT EXISTS idx_task_versions_state
  ON adjudication.task_versions(state, updated_at);

CREATE INDEX IF NOT EXISTS idx_task_versions_holdout
  ON adjudication.task_versions(holdout_id, task_version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_versions_packet_id
  ON adjudication.task_versions(packet_id);

CREATE TABLE IF NOT EXISTS adjudication.consensus_rounds (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
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
  opened_at BIGINT NOT NULL,
  deadline_at BIGINT NOT NULL,
  closed_at BIGINT,
  prior_round_id TEXT REFERENCES adjudication.consensus_rounds(id) ON DELETE SET NULL,
  UNIQUE (task_version_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_consensus_rounds_deadline
  ON adjudication.consensus_rounds(status, deadline_at);

CREATE TABLE IF NOT EXISTS adjudication.submissions (
  receipt_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  participant_pseudonym TEXT,
  artifact_type TEXT,
  artifact_json TEXT,
  repository_status TEXT NOT NULL DEFAULT 'pending-validation',
  task_version_id TEXT REFERENCES adjudication.task_versions(id) ON DELETE RESTRICT,
  round_id TEXT REFERENCES adjudication.consensus_rounds(id) ON DELETE RESTRICT,
  holdout_id TEXT,
  guideline_version TEXT,
  data_version TEXT,
  protocol_version TEXT,
  consensus_role TEXT,
  consensus_round INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  superseded_by_receipt_id TEXT
    REFERENCES adjudication.submissions(receipt_id) ON DELETE SET NULL,
  submitted_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_task
  ON adjudication.submissions(user_id, packet_id, role, submitted_at);

CREATE INDEX IF NOT EXISTS idx_submissions_packet_time
  ON adjudication.submissions(packet_id, submitted_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_unique_user_packet
  ON adjudication.submissions(user_id, packet_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_round_role
  ON adjudication.submissions(task_version_id, consensus_round, consensus_role)
  WHERE task_version_id IS NOT NULL
    AND consensus_role IN ('A', 'B', 'J1', 'J2');

CREATE INDEX IF NOT EXISTS idx_submissions_task_round
  ON adjudication.submissions(task_version_id, consensus_round, consensus_role);

CREATE TABLE IF NOT EXISTS adjudication.consensus_events (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES adjudication.consensus_rounds(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_user_id TEXT REFERENCES adjudication.users(id) ON DELETE SET NULL,
  actor_subject_hash TEXT,
  reason_code TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  prior_state_hash TEXT,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consensus_events_task_time
  ON adjudication.consensus_events(task_version_id, created_at);

CREATE TABLE IF NOT EXISTS adjudication.task_participations (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE CASCADE,
  holdout_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2', 'appeal-reviewer')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('assigned', 'submitted', 'recused', 'replaced')
  ),
  submission_receipt_id TEXT
    REFERENCES adjudication.submissions(receipt_id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (task_version_id, user_id),
  UNIQUE (holdout_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_participations_round_role
  ON adjudication.task_participations(round_id, role)
  WHERE role IN ('A', 'B', 'J1', 'J2');

CREATE INDEX IF NOT EXISTS idx_task_participations_task_role
  ON adjudication.task_participations(task_version_id, role, status);

CREATE TABLE IF NOT EXISTS adjudication.result_access (
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  source_receipt_id TEXT NOT NULL
    REFERENCES adjudication.submissions(receipt_id) ON DELETE CASCADE,
  first_viewed_at BIGINT NOT NULL,
  task_version_id TEXT REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES adjudication.consensus_rounds(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, packet_id)
);

CREATE INDEX IF NOT EXISTS idx_result_access_task_user
  ON adjudication.result_access(task_version_id, round_id, user_id);

CREATE TABLE IF NOT EXISTS adjudication.discussion_comments (
  comment_id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  participant_pseudonym TEXT NOT NULL,
  source_receipt_id TEXT NOT NULL
    REFERENCES adjudication.submissions(receipt_id) ON DELETE CASCADE,
  target_receipt_id TEXT
    REFERENCES adjudication.submissions(receipt_id) ON DELETE CASCADE,
  parent_comment_id TEXT
    REFERENCES adjudication.discussion_comments(comment_id) ON DELETE CASCADE,
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
  token_id BIGINT,
  mentions_json TEXT NOT NULL,
  references_json TEXT NOT NULL,
  github_status TEXT NOT NULL DEFAULT 'pending-validation' CHECK (
    github_status IN (
      'pending-validation',
      'imported',
      'rejected'
    )
  ),
  task_version_id TEXT REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES adjudication.consensus_rounds(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_comments_packet_time
  ON adjudication.discussion_comments(packet_id, created_at);

CREATE INDEX IF NOT EXISTS idx_discussion_comments_target
  ON adjudication.discussion_comments(target_receipt_id, created_at);

CREATE INDEX IF NOT EXISTS idx_discussion_comments_task_round
  ON adjudication.discussion_comments(task_version_id, round_id, created_at);

CREATE TABLE IF NOT EXISTS adjudication.notification_outbox (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'comment',
      'mention',
      'final-result-difference'
    )
  ),
  packet_id TEXT NOT NULL,
  comment_id TEXT REFERENCES adjudication.discussion_comments(comment_id) ON DELETE CASCADE,
  source_receipt_id TEXT
    REFERENCES adjudication.submissions(receipt_id) ON DELETE CASCADE,
  context_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'skipped')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_ready
  ON adjudication.notification_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS adjudication.consensus_metrics (
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE CASCADE,
  annotation_a_receipt_id TEXT NOT NULL
    REFERENCES adjudication.submissions(receipt_id) ON DELETE RESTRICT,
  annotation_b_receipt_id TEXT NOT NULL
    REFERENCES adjudication.submissions(receipt_id) ON DELETE RESTRICT,
  metrics_json TEXT NOT NULL,
  policy_passed INTEGER NOT NULL CHECK (policy_passed IN (0, 1)),
  computed_at BIGINT NOT NULL,
  PRIMARY KEY (task_version_id, round_id)
);

CREATE TABLE IF NOT EXISTS adjudication.final_results (
  primary_receipt_id TEXT PRIMARY KEY
    REFERENCES adjudication.submissions(receipt_id) ON DELETE RESTRICT,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE RESTRICT,
  secondary_receipt_id TEXT
    REFERENCES adjudication.submissions(receipt_id) ON DELETE RESTRICT,
  final_merkle_root TEXT NOT NULL CHECK (length(final_merkle_root) = 64),
  status TEXT NOT NULL CHECK (
    status IN ('proposed', 'active', 'superseded', 'revoked')
  ),
  supersedes_receipt_id TEXT
    REFERENCES adjudication.final_results(primary_receipt_id) ON DELETE SET NULL,
  proposed_at BIGINT NOT NULL,
  approved_at BIGINT,
  published_at BIGINT,
  revoked_at BIGINT,
  revocation_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_final_results_one_active
  ON adjudication.final_results(task_version_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS adjudication.recusals (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (
    role IN ('A', 'B', 'J1', 'J2', 'appeal-reviewer')
  ),
  scope TEXT NOT NULL CHECK (
    scope IN ('round', 'task-version', 'holdout-family')
  ),
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (round_id, user_id)
);

CREATE TABLE IF NOT EXISTS adjudication.appeals (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE RESTRICT,
  appellant_user_id TEXT REFERENCES adjudication.users(id) ON DELETE SET NULL,
  final_receipt_id TEXT NOT NULL
    REFERENCES adjudication.final_results(primary_receipt_id) ON DELETE RESTRICT,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  reviewer_user_id TEXT REFERENCES adjudication.users(id) ON DELETE SET NULL,
  reviewer_subject_hash TEXT,
  review_reason TEXT,
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT,
  UNIQUE (task_version_id, appellant_user_id, final_receipt_id)
);

CREATE TABLE IF NOT EXISTS adjudication.discussion_moderation (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL
    REFERENCES adjudication.discussion_comments(comment_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (
    state IN ('visible', 'hidden', 'redacted', 'blocked')
  ),
  reason TEXT NOT NULL,
  original_body_hash TEXT NOT NULL CHECK (length(original_body_hash) = 64),
  actor_subject_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_moderation_comment
  ON adjudication.discussion_moderation(comment_id, created_at);

CREATE TABLE IF NOT EXISTS adjudication.repository_receipts (
  id TEXT PRIMARY KEY,
  task_version_id TEXT NOT NULL
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL
    REFERENCES adjudication.consensus_rounds(id) ON DELETE RESTRICT,
  final_merkle_root TEXT NOT NULL CHECK (length(final_merkle_root) = 64),
  nonce TEXT NOT NULL UNIQUE,
  pr_number BIGINT NOT NULL,
  pr_merge_sha TEXT NOT NULL CHECK (length(pr_merge_sha) = 40),
  importer_commit_sha TEXT NOT NULL CHECK (length(importer_commit_sha) = 40),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (length(signature_sha256) = 64),
  received_at BIGINT NOT NULL,
  accepted_at BIGINT NOT NULL,
  UNIQUE (task_version_id, final_merkle_root)
);

CREATE TABLE IF NOT EXISTS adjudication.evidence_repository_receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('submission', 'comment')),
  related_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  pr_number BIGINT NOT NULL,
  pr_merge_sha TEXT NOT NULL CHECK (length(pr_merge_sha) = 40),
  importer_commit_sha TEXT NOT NULL CHECK (length(importer_commit_sha) = 40),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (length(signature_sha256) = 64),
  accepted_at BIGINT NOT NULL,
  UNIQUE (kind, related_id)
);

CREATE TABLE IF NOT EXISTS adjudication.evidence_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN ('submission', 'comment', 'task-state')
  ),
  task_version_id TEXT REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
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
  next_attempt_at BIGINT NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_evidence_outbox_ready
  ON adjudication.evidence_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS adjudication.governance_notification_outbox (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
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
    REFERENCES adjudication.task_versions(id) ON DELETE CASCADE,
  context_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'skipped')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NOT NULL,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_governance_notification_ready
  ON adjudication.governance_notification_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS adjudication.identity_erasure_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES adjudication.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'completed', 'rejected')
  ),
  requested_at BIGINT NOT NULL,
  eligible_after BIGINT NOT NULL,
  completed_at BIGINT,
  UNIQUE (user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_identity_erasure_ready
  ON adjudication.identity_erasure_requests(status, eligible_after);

CREATE TABLE IF NOT EXISTS adjudication.identity_erasure_items (
  request_id TEXT NOT NULL
    REFERENCES adjudication.identity_erasure_requests(id) ON DELETE CASCADE,
  blob_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'deleted')
  ),
  deleted_at BIGINT,
  PRIMARY KEY (request_id, blob_name)
);

CREATE TABLE IF NOT EXISTS adjudication.cpoly_runtime_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  current_generation BIGINT NOT NULL CHECK (current_generation >= 1),
  updated_at BIGINT NOT NULL
);

INSERT INTO adjudication.cpoly_runtime_state (singleton, current_generation, updated_at)
VALUES (TRUE, 1, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS adjudication.cpoly_write_receipts (
  receipt_seq BIGSERIAL PRIMARY KEY,
  generation BIGINT NOT NULL CHECK (generation >= 1),
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('run', 'batch')),
  statement_count INTEGER NOT NULL CHECK (statement_count >= 1),
  applied_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cpoly_write_receipts_generation_seq
  ON adjudication.cpoly_write_receipts(generation, receipt_seq);

CREATE TABLE IF NOT EXISTS adjudication.cpoly_recovery_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_generation BIGINT NOT NULL DEFAULT 0 CHECK (snapshot_generation >= 0),
  postgres_receipt_watermark BIGINT NOT NULL DEFAULT 0 CHECK (postgres_receipt_watermark >= 0),
  worker_recovery_id TEXT,
  worker_status TEXT NOT NULL DEFAULT 'not_ready',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO adjudication.cpoly_recovery_state
  (singleton, ready, snapshot_generation, postgres_receipt_watermark, worker_status)
VALUES (TRUE, FALSE, 0, 0, 'not_ready')
ON CONFLICT (singleton) DO NOTHING;
REVOKE ALL ON adjudication.cpoly_recovery_state FROM PUBLIC, adg_runtime;
GRANT SELECT ON adjudication.cpoly_recovery_state TO adg_runtime, adg_backup;
