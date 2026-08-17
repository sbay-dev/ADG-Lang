BEGIN;

SET search_path TO adjudication, public;

CREATE TABLE IF NOT EXISTS task_state_repository_receipts (
  id TEXT PRIMARY KEY CHECK (
    id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL
    REFERENCES consensus_events(id) ON DELETE CASCADE,
  to_state TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  repository TEXT NOT NULL,
  pr_number BIGINT NOT NULL CHECK (pr_number > 0),
  pr_merge_sha TEXT NOT NULL CHECK (
    pr_merge_sha ~ '^[0-9a-f]{40}$'
  ),
  importer_commit_sha TEXT NOT NULL CHECK (
    importer_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  issue_number BIGINT CHECK (
    issue_number IS NULL OR issue_number > 0
  ),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (
    signature_sha256 ~ '^[0-9a-f]{64}$'
  ),
  accepted_at BIGINT NOT NULL,
  UNIQUE (task_version_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_task_state_repository_receipts_task
  ON task_state_repository_receipts(
    task_version_id,
    state_version,
    accepted_at
  );

COMMIT;
