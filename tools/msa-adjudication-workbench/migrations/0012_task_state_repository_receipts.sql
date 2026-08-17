CREATE TABLE task_state_repository_receipts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  task_version_id TEXT NOT NULL
    REFERENCES task_versions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL
    REFERENCES consensus_events(id) ON DELETE CASCADE,
  to_state TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  pr_merge_sha TEXT NOT NULL CHECK (length(pr_merge_sha) = 40),
  importer_commit_sha TEXT NOT NULL CHECK (
    length(importer_commit_sha) = 40
  ),
  issue_number INTEGER CHECK (
    issue_number IS NULL OR issue_number > 0
  ),
  envelope_json TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (
    length(signature_sha256) = 64
  ),
  accepted_at INTEGER NOT NULL,
  UNIQUE (task_version_id, event_id)
);

CREATE INDEX idx_task_state_repository_receipts_task
  ON task_state_repository_receipts(
    task_version_id,
    state_version,
    accepted_at
  );
