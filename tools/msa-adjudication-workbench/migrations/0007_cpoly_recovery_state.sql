ALTER TABLE cpoly_backup_sets
  ADD COLUMN snapshot_generation INTEGER CHECK (
    snapshot_generation IS NULL OR snapshot_generation >= 1
  );

ALTER TABLE cpoly_backup_sets
  ADD COLUMN snapshot_watermark INTEGER CHECK (
    snapshot_watermark IS NULL OR snapshot_watermark >= 0
  );

ALTER TABLE cpoly_backup_sets
  ADD COLUMN verified_at INTEGER CHECK (
    verified_at IS NULL OR verified_at >= 0
  );

ALTER TABLE cpoly_backup_sets
  ADD COLUMN restore_lease_expires_at INTEGER CHECK (
    restore_lease_expires_at IS NULL OR restore_lease_expires_at >= 0
  );

CREATE INDEX idx_cpoly_backup_sets_snapshot_order
  ON cpoly_backup_sets(
    status,
    snapshot_generation DESC,
    snapshot_watermark DESC,
    verified_at DESC,
    created_at DESC
  );

CREATE INDEX idx_cpoly_backup_sets_restore_lease
  ON cpoly_backup_sets(restore_lease_expires_at, status, expires_at);

ALTER TABLE cpoly_pg_write_journal
  ADD COLUMN postgres_generation INTEGER CHECK (
    postgres_generation IS NULL OR postgres_generation >= 1
  );

ALTER TABLE cpoly_pg_write_journal
  ADD COLUMN postgres_receipt_seq INTEGER CHECK (
    postgres_receipt_seq IS NULL OR postgres_receipt_seq >= 0
  );

CREATE INDEX idx_cpoly_pg_write_journal_coverage
  ON cpoly_pg_write_journal(
    status,
    postgres_generation,
    postgres_receipt_seq,
    created_at
  );

CREATE TABLE cpoly_recovery_runtime (
  slot TEXT PRIMARY KEY CHECK (slot = 'global'),
  state TEXT NOT NULL CHECK (state IN ('ready', 'recovering')),
  ready_generation INTEGER NOT NULL CHECK (ready_generation >= 1),
  target_generation INTEGER CHECK (
    target_generation IS NULL OR target_generation >= 1
  ),
  recovery_id TEXT,
  restore_backup_id TEXT
    REFERENCES cpoly_backup_sets(id) ON DELETE SET NULL,
  restore_snapshot_generation INTEGER CHECK (
    restore_snapshot_generation IS NULL OR restore_snapshot_generation >= 1
  ),
  restore_snapshot_watermark INTEGER CHECK (
    restore_snapshot_watermark IS NULL OR restore_snapshot_watermark >= 0
  ),
  restore_lease_expires_at INTEGER CHECK (
    restore_lease_expires_at IS NULL OR restore_lease_expires_at >= 0
  ),
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_error TEXT,
  CHECK (
    state = 'recovering'
    OR (
      state = 'ready'
      AND recovery_id IS NULL
      AND target_generation IS NULL
      AND restore_backup_id IS NULL
      AND restore_snapshot_generation IS NULL
      AND restore_snapshot_watermark IS NULL
      AND restore_lease_expires_at IS NULL
      AND started_at IS NULL
    )
  )
);

INSERT INTO cpoly_recovery_runtime (
  slot,
  state,
  ready_generation,
  target_generation,
  recovery_id,
  restore_backup_id,
  restore_snapshot_generation,
  restore_snapshot_watermark,
  restore_lease_expires_at,
  started_at,
  updated_at,
  completed_at,
  last_error
)
SELECT
  'global',
  'ready',
  1,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  NULL,
  NULL
WHERE NOT EXISTS (
  SELECT 1
    FROM cpoly_recovery_runtime
   WHERE slot = 'global'
);
