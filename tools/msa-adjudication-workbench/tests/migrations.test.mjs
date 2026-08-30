import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "migrations/0001_passkeys.sql",
    "migrations/0002_admin_progress.sql",
    "migrations/0003_results_discussion.sql",
    "migrations/0004_consensus_state.sql",
    "migrations/0005_cpoly_recovery.sql",
    "migrations/0006_cpoly_backup_contract.sql",
    "migrations/0007_cpoly_recovery_state.sql",
    "migrations/0008_cpoly_backup_metadata_hash.sql",
    "migrations/0009_cpoly_backup_kv_lane.sql",
    "migrations/0010_repository_task_catalog.sql",
    "migrations/0011_portal_issue_reports.sql",
    "migrations/0012_task_state_repository_receipts.sql",
    "migrations/0013_cpoly_journal_disposition.sql"
  ]) {
    database.exec(readFileSync(path, "utf8"));
  }
  return database;
}

test("migrations create verified-email identity constraints", () => {
  const database = migratedDatabase();
  const userColumns = database.prepare("PRAGMA table_info(users)").all();
  assert.ok(userColumns.some(column => column.name === "verified_email_hash"));
  const challengeColumns = database.prepare(
    "PRAGMA table_info(webauthn_challenges)"
  ).all();
  assert.ok(
    challengeColumns.some(column => column.name === "email_verification_id")
  );
  assert.ok(
    challengeColumns.some(column => column.name === "verified_email_hash")
  );
});

test("email verification send cooldown can be claimed atomically", () => {
  const database = migratedDatabase();
  const insert = database.prepare(
    `INSERT INTO email_verifications
      (id, email_hash, request_fingerprint, code_hash, attempts,
       expires_at, resend_after, created_at)
     SELECT ?, ?, ?, ?, 0, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
          FROM email_verifications
         WHERE email_hash = ?
           AND created_at > ? - 60000
      )`
  );
  const first = insert.run(
    "v1",
    "email-hash",
    "request-hash",
    "code-1",
    700000,
    160000,
    100000,
    "email-hash",
    100000
  );
  const second = insert.run(
    "v2",
    "email-hash",
    "request-hash",
    "code-2",
    700001,
    160001,
    100001,
    "email-hash",
    100001
  );
  assert.equal(first.changes, 1);
  assert.equal(second.changes, 0);
});

test("formal discussion categories are accepted by the database", () => {
  const database = migratedDatabase();
  database.prepare(
    `INSERT INTO users
      (id, profile_ciphertext, consent_json, created_at, updated_at)
     VALUES ('u1', 'ciphertext', '{}', 1, 1)`
  ).run();
  database.prepare(
    `INSERT INTO submissions
      (receipt_id, user_id, packet_id, role, artifact_sha256, submitted_at)
     VALUES ('r1', 'u1', 'packet-1', 'A', 'hash', 1)`
  ).run();
  const insert = database.prepare(
    `INSERT INTO discussion_comments
      (comment_id, packet_id, author_user_id, participant_pseudonym,
       source_receipt_id, category, body, mentions_json, references_json,
       created_at)
     VALUES (?, 'packet-1', 'u1', 'adg-test', 'r1', ?, 'سبب موثق',
             '[]', '[]', 1)`
  );
  for (const category of [
    "consensus-proposal",
    "escalation",
    "appeal",
    "recusal"
  ]) {
    insert.run(`comment-${category}`, category);
  }
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) AS count FROM discussion_comments"
    ).get().count,
    4
  );
});

test("consensus migration binds discussions and held evidence to task rounds", () => {
  const database = migratedDatabase();
  for (const table of ["result_access", "discussion_comments"]) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    assert.ok(columns.some(column => column.name === "task_version_id"));
    assert.ok(columns.some(column => column.name === "round_id"));
  }
  const indexes = database.prepare(
    "PRAGMA index_list(task_versions)"
  ).all();
  assert.ok(indexes.some(index =>
    index.name === "idx_task_versions_packet_id"
      && Number(index.unique) === 1));
  const outboxSql = database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = 'evidence_outbox'`
  ).get().sql;
  assert.match(outboxSql, /'held'/);
  assert.match(outboxSql, /'cancelled'/);
});

test("repository task migration isolates operational claims and draft history", () => {
  const database = migratedDatabase();
  const tables = new Set(database.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'`
  ).all().map(row => row.name));
  for (const name of [
    "repository_task_packets",
    "task_assignments",
    "operational_task_claims",
    "repository_task_syncs",
    "draft_revisions"
  ]) {
    assert.ok(tables.has(name), `missing ${name}`);
  }
  const taskColumns = new Set(database.prepare(
    "PRAGMA table_info(repository_task_packets)"
  ).all().map(column => column.name));
  assert.ok(taskColumns.has("lane"));
  assert.ok(taskColumns.has("immutable_manifest_sha256"));
  const draftColumns = new Set(database.prepare(
    "PRAGMA table_info(drafts)"
  ).all().map(column => column.name));
  assert.ok(draftColumns.has("content_sha256"));
  const operationalSql = database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = 'operational_task_claims'`
  ).get().sql;
  assert.match(operationalSql, /'claimed', 'submitted'/);
});

test("issue-report migration separates private linkage from public publishing", () => {
  const database = migratedDatabase();
  const tables = new Set(database.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'`
  ).all().map(row => row.name));
  assert.ok(tables.has("portal_issue_reports"));
  assert.ok(tables.has("portal_issue_report_claims"));
  const columns = new Set(database.prepare(
    "PRAGMA table_info(portal_issue_reports)"
  ).all().map(column => column.name));
  for (const name of [
    "user_id",
    "payload_json",
    "content_sha256",
    "claim_nonce",
    "github_issue_number",
    "github_issue_url"
  ]) {
    assert.ok(columns.has(name), `missing ${name}`);
  }
});

test("task-state receipt migration records bounded repository acknowledgements", () => {
  const database = migratedDatabase();
  const columns = new Set(database.prepare(
    "PRAGMA table_info(task_state_repository_receipts)"
  ).all().map(column => column.name));
  for (const name of [
    "task_version_id",
    "event_id",
    "to_state",
    "state_version",
    "pr_merge_sha",
    "importer_commit_sha",
    "issue_number",
    "signature_sha256"
  ]) {
    assert.ok(columns.has(name), `missing ${name}`);
  }
});

test("CPOLY migration ConfigMap ships every PostgreSQL schema step", () => {
  const kustomization = readFileSync(
    "infrastructure/cpoly-postgres/kustomization.yaml",
    "utf8"
  );
  assert.match(
    kustomization,
    /0001_portal_v15\.sql=migrations\/postgresql\/0001_portal_v15\.sql/
  );
  assert.match(
    kustomization,
    /0002_repository_task_catalog\.sql=migrations\/postgresql\/0002_repository_task_catalog\.sql/
  );
  assert.match(
    kustomization,
    /0003_portal_issue_reports\.sql=migrations\/postgresql\/0003_portal_issue_reports\.sql/
  );
  assert.match(
    kustomization,
    /0004_task_state_repository_receipts\.sql=migrations\/postgresql\/0004_task_state_repository_receipts\.sql/
  );
});

test("CPOLY recovery migrations create bounded backup, descriptor, and journal tables", () => {
  const database = migratedDatabase();
  const tables = new Set(database.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'`
  ).all().map(row => row.name));
  for (const name of [
    "cpoly_backup_sets",
    "cpoly_backup_chunks",
    "cpoly_backup_chunk_inventory",
    "cpoly_signed_api_nonces",
    "cpoly_pg_write_journal"
  ]) {
    assert.ok(tables.has(name), `missing ${name}`);
  }
  const inventorySql = database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = 'cpoly_backup_chunk_inventory'`
  ).get().sql;
  assert.match(inventorySql, /kv_key/i);
  assert.match(inventorySql, /plaintext_size_bytes/i);
  const backupSetSql = database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = 'cpoly_backup_sets'`
  ).get().sql;
  assert.match(
    backupSetSql,
    /completed_at IS NULL\s+OR\s+\(\s*total_size_bytes IS NOT NULL/i
  );
  assert.doesNotMatch(
    backupSetSql,
    /status = 'complete' AND completed_at IS NOT NULL/i
  );
  const backupColumns = database.prepare(
    "PRAGMA table_info(cpoly_backup_sets)"
  ).all();
  assert.ok(backupColumns.some(column => column.name === "descriptor_json"));
  assert.ok(backupColumns.some(column => column.name === "descriptor_sha256"));
  const journalSql = database.prepare(
    `SELECT sql
       FROM sqlite_master
      WHERE type = 'table' AND name = 'cpoly_pg_write_journal'`
  ).get().sql;
  assert.match(journalSql, /status IN \('pending', 'applied', 'failed'\)/i);
  assert.match(
    journalSql,
    /recovery_disposition TEXT NOT NULL DEFAULT 'blocking'/i
  );
  assert.match(
    journalSql,
    /recovery_disposition IN \('blocking', 'terminal_rejected'\)/i
  );
  const journalIndexes = new Set(database.prepare(
    "PRAGMA index_list(cpoly_pg_write_journal)"
  ).all().map(index => index.name));
  assert.ok(
    journalIndexes.has("idx_cpoly_pg_write_journal_recovery_disposition")
  );
});
