import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPostgresFixture, dockerAvailable, runNodeScript } from "./postgres-test-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const migrationScriptPath = path.join(
  projectRoot,
  "scripts",
  "migrate-d1-export-to-postgres.mjs"
);
const applySchemaScriptPath = path.join(
  projectRoot,
  "scripts",
  "apply-postgres-schema.mjs"
);
const testWorkRoot = path.join(__dirname, ".work");

test("PostgreSQL schema apply script is idempotent", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("schema");
  try {
    const first = await runNodeScript(applySchemaScriptPath, [], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(first.status, 0, first.stderr);
    const second = await runNodeScript(applySchemaScriptPath, [], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(second.status, 0, second.stderr);
  } finally {
    await fixture.close();
  }
});

test("D1 export migration CLI stays dry-run by default for PostgreSQL", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createMigrationFixture("dry-run");
  try {
    const result = await runNodeScript(migrationScriptPath, [
      "--source",
      fixture.exportPath
    ], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.dryRun, true);
    assert.equal(report.apply, false);
    assert.equal(report.success, true);
    assert.deepEqual(
      report.tables.map(table => table.name),
      ["users", "sessions"]
    );
    assert.deepEqual(
      report.tables.map(table => table.validation),
      ["skipped-dry-run", "skipped-dry-run"]
    );
    assert.equal(Number((await fixture.sql`
      SELECT COUNT(*) AS count FROM users
    `)[0].count), 0);
    assert.equal(Number((await fixture.sql`
      SELECT COUNT(*) AS count FROM sessions
    `)[0].count), 0);
    assert.equal(result.stdout.includes("ciphertext-user-a"), false);
    assert.equal(report.tempDatabase.deleted, true);
    assert.equal(
      existsSync(path.join(projectRoot, report.tempDatabase.path)),
      false
    );
  } finally {
    await fixture.close();
  }
});

test("D1 export migration CLI applies PostgreSQL imports and replays idempotently", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createMigrationFixture("apply");
  try {
    const first = await runNodeScript(migrationScriptPath, [
      "--source",
      fixture.exportPath,
      "--apply"
    ], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(first.status, 0, first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.success, true);
    assert.deepEqual(
      firstReport.tables.map(table => table.validation),
      ["matched", "matched"]
    );
    assert.equal(Number((await fixture.sql`
      SELECT COUNT(*) AS count FROM users
    `)[0].count), 2);
    assert.equal(Number((await fixture.sql`
      SELECT COUNT(*) AS count FROM sessions
    `)[0].count), 2);

    const second = await runNodeScript(migrationScriptPath, [
      "--source",
      fixture.exportPath,
      "--apply"
    ], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(second.status, 0, second.stderr);
    const secondReport = JSON.parse(second.stdout);
    assert.equal(secondReport.success, true);
    assert.deepEqual(
      secondReport.tables.map(table => table.validation),
      ["matched", "matched"]
    );
  } finally {
    await fixture.close();
  }
});

test("D1 export migration CLI fails when PostgreSQL target rows diverge", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createMigrationFixture("mismatch");
  try {
    await fixture.sql.unsafe(`
      INSERT INTO users (
        id, profile_ciphertext, consent_json, verified_email_hash, created_at, updated_at
      ) VALUES (
        'user-extra', 'ciphertext-extra', '{}', 'hash-extra', 3, 3
      )
    `);
    const result = await runNodeScript(migrationScriptPath, [
      "--source",
      fixture.exportPath,
      "--apply"
    ], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.equal(report.tables[0].name, "users");
    assert.equal(report.tables[0].validation, "mismatch");
    assert.match(report.error.message, /did not match the source count\/hash/u);
  } finally {
    await fixture.close();
  }
});

test("D1 export migration CLI excludes D1-only CPOLY recovery tables from migrated exports", {
  skip: !dockerAvailable
}, async () => {
  const fixtureDirectory = path.join(
    testWorkRoot,
    `full-export-${process.pid}`
  );
  mkdirSync(fixtureDirectory, { recursive: true });
  const exportPath = path.join(fixtureDirectory, "wrangler-d1-export-full.sql");
  writeFileSync(exportPath, buildMigratedExportSql(), "utf8");
  const fixture = await createPostgresFixture("full-export");
  try {
    const result = await runNodeScript(migrationScriptPath, [
      "--source",
      exportPath
    ], {
      POSTGRES_CONNECTION_STRING: fixture.connectionString
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const names = new Set(report.tables.map(table => table.name));
    assert.equal(names.has("users"), true);
    assert.equal(names.has("sessions"), true);
    for (const excluded of [
      "cpoly_backup_sets",
      "cpoly_backup_chunks",
      "cpoly_backup_chunk_inventory",
      "cpoly_signed_api_nonces",
      "cpoly_pg_write_journal",
      "cpoly_recovery_runtime"
    ]) {
      assert.equal(names.has(excluded), false, excluded);
    }
  } finally {
    await fixture.close();
    rmSync(fixtureDirectory, { recursive: true, force: true });
    if (existsSync(testWorkRoot)) {
      try {
        rmSync(testWorkRoot, { recursive: false });
      } catch {
        // another fixture directory still exists
      }
    }
  }
});

async function createMigrationFixture(tag) {
  const fixtureDirectory = path.join(
    testWorkRoot,
    `${tag}-${process.pid}`
  );
  mkdirSync(fixtureDirectory, { recursive: true });
  const exportPath = path.join(fixtureDirectory, "wrangler-d1-export.sql");
  writeFileSync(exportPath, buildExportSql(), "utf8");
  const fixture = await createPostgresFixture(tag);
  return {
    ...fixture,
    exportPath,
    async close() {
      await fixture.close();
      rmSync(fixtureDirectory, { recursive: true, force: true });
      if (existsSync(testWorkRoot)) {
        try {
          rmSync(testWorkRoot, { recursive: false });
        } catch {
          // Another fixture directory still exists.
        }
      }
    }
  };
}

function buildExportSql() {
  return [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    "CREATE TABLE users (",
    "  id TEXT PRIMARY KEY,",
    "  profile_ciphertext TEXT NOT NULL,",
    "  verified_email_hash TEXT,",
    "  consent_json TEXT NOT NULL DEFAULT '{}',",
    "  created_at INTEGER NOT NULL,",
    "  updated_at INTEGER NOT NULL",
    ");",
    "CREATE TABLE sessions (",
    "  token_hash TEXT PRIMARY KEY,",
    "  user_id TEXT NOT NULL,",
    "  expires_at INTEGER NOT NULL,",
    "  created_at INTEGER NOT NULL,",
    "  FOREIGN KEY(user_id) REFERENCES users(id)",
    ");",
    "CREATE TABLE d1_migrations (name TEXT PRIMARY KEY);",
    "CREATE TABLE internal_probe (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  value TEXT NOT NULL",
    ");",
    "INSERT INTO internal_probe(value) VALUES ('probe');",
    "DROP TABLE internal_probe;",
    "INSERT INTO users VALUES ('user-a', 'ciphertext-user-a', 'hash-a', '{}', 1, 1);",
    "INSERT INTO users VALUES ('user-b', 'ciphertext-user-b', NULL, '{}', 2, 2);",
    "INSERT INTO sessions VALUES ('session-a', 'user-a', 111, 11);",
    "INSERT INTO sessions VALUES ('session-b', 'user-b', 222, 22);",
    "COMMIT;"
  ].join("\n");
}

function buildMigratedExportSql() {
  const migrations = [
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
      "migrations/0012_task_state_repository_receipts.sql"
  ].map(relativePath => readFileSync(
    path.join(projectRoot, relativePath),
    "utf8"
  ));
  return [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    ...migrations,
    "INSERT INTO users VALUES ('user-a', 'ciphertext-user-a', 'hash-a', '{}', 1, 1);",
    "INSERT INTO sessions VALUES ('session-a', 'user-a', 111, 11);",
    "INSERT INTO cpoly_backup_sets (id, status, created_at, updated_at, expires_at, uploaded_bytes, uploaded_chunks) VALUES ('11111111-1111-4111-8111-111111111111', 'uploading', 1, 1, 2, 0, 0);",
    "INSERT INTO cpoly_backup_chunk_inventory (backup_id, chunk_index, kv_key, plaintext_size_bytes, plaintext_sha256, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 0, 'cpoly-backups/v1/11111111-1111-4111-8111-111111111111/chunks/000000', 1, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1);",
    "INSERT INTO cpoly_signed_api_nonces (nonce, request_method, request_path, body_sha256, created_at, expires_at) VALUES ('22222222-2222-4222-8222-222222222222', 'GET', '/api/internal/cpoly-backups/latest', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 2);",
    "INSERT INTO cpoly_pg_write_journal (request_id, payload_hash, operation_kind, statement_count, status, ciphertext, attempts, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'run', 1, 'pending', x'01', 0, 1, 1);",
    "COMMIT;"
  ].join("\n");
}
