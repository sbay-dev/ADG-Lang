ALTER TABLE cpoly_pg_write_journal
  ADD COLUMN recovery_disposition TEXT NOT NULL DEFAULT 'blocking'
  CHECK (recovery_disposition IN ('blocking', 'terminal_rejected'));

CREATE INDEX idx_cpoly_pg_write_journal_recovery_disposition
  ON cpoly_pg_write_journal(status, recovery_disposition, created_at);
