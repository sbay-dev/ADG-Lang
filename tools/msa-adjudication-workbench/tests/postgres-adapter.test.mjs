import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  ensureConsensusTask,
  getCurrentConsensusRound,
  transitionConsensusTask,
  ConsensusConflict
} from "../src/consensus-store.js";
import {
  createRuntimeEnv,
  PostgresD1Database,
  inferStatementMode,
  translateSqliteSqlToPostgres
} from "../src/database.js";
import {
  buildJournalPayload,
  encryptRecoveryString,
  postgresJournalPurpose
} from "../src/cpoly-recovery.js";
import { computePacketMerkleRoot } from "../public/protocol.js";
import { createPostgresFixture, dockerAvailable } from "./postgres-test-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceFiles = [
  path.join(projectRoot, "src", "index.js"),
  path.join(projectRoot, "src", "consensus-store.js")
];
const packetPath = path.join(
  projectRoot,
  "..",
  "..",
  "examples",
  "arabic-text",
  "msa-adjudication-pilot-v1",
  "packet.json"
);

class D1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.bindings),
      meta: { changes: 0 }
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    };
  }
}

class D1ProbeDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0005_cpoly_recovery.sql"),
      "utf8"
    ));
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0006_cpoly_backup_contract.sql"),
      "utf8"
    ));
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0007_cpoly_recovery_state.sql"),
      "utf8"
    ));
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0008_cpoly_backup_metadata_hash.sql"),
      "utf8"
    ));
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0009_cpoly_backup_kv_lane.sql"),
      "utf8"
    ));
    this.database.exec(readFileSync(
      path.join(projectRoot, "migrations", "0013_cpoly_journal_disposition.sql"),
      "utf8"
    ));
    this.database.exec(`
      CREATE TABLE probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        amount INTEGER NOT NULL
      );
    `);
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        const mode = inferStatementMode(statement.sql);
        results.push(mode === "all"
          ? await statement.all()
          : await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

test("Postgres translation covers static Worker SQL statements", () => {
  const statements = collectStaticSqlStatements();
  assert.ok(statements.length > 40, "expected many static SQL statements");
  let orIgnoreCount = 0;
  for (const sql of statements) {
    const translated = translateSqliteSqlToPostgres(sql);
    assert.equal(translated.includes("?"), false, sql);
    if (/INSERT\s+OR\s+IGNORE/iu.test(sql)) {
      orIgnoreCount += 1;
      assert.match(translated, /ON CONFLICT DO NOTHING/iu);
    }
  }
  assert.ok(orIgnoreCount >= 5, "expected INSERT OR IGNORE coverage");
});

test("Postgres adapter matches D1 result shapes and rolls back failed batches", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("adapter");
  const sqlite = new D1ProbeDatabase();
  const masterKey = "cpoly-journal-master-key-test-2026";
  const postgresDb = new PostgresD1Database({
    connectionString: fixture.connectionString,
    recoveryDb: sqlite,
    recoveryMasterKey: masterKey
  }, {
    applicationName: "adg-postgres-adapter-test"
  });

  try {
    await fixture.sql.unsafe(`
      CREATE TABLE probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        amount BIGINT NOT NULL
      );
    `);

    const sqliteInsert = await sqlite.prepare(
      `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
    ).bind("row-a", "alpha", 1).run();
    const postgresInsert = await postgresDb.prepare(
      `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
    ).bind("row-a", "alpha", 1).run();
    assert.equal(postgresInsert.success, true);
    assert.equal(postgresInsert.meta.changes, sqliteInsert.meta.changes);
    const firstJournal = sqlite.database.prepare(
      `SELECT request_id, status, ciphertext
         FROM cpoly_pg_write_journal
        ORDER BY created_at ASC
        LIMIT 1`
    ).get();
    assert.equal(firstJournal.status, "applied");
    assert.equal(
      Buffer.from(firstJournal.ciphertext).includes(Buffer.from("row-a")),
      false
    );

    const sqliteFirst = await sqlite.prepare(
      `SELECT id, value, amount FROM probe WHERE id = ?`
    ).bind("row-a").first();
    const postgresFirst = await postgresDb.prepare(
      `SELECT id, value, amount FROM probe WHERE id = ?`
    ).bind("row-a").first();
    assert.deepEqual({ ...postgresFirst }, { ...sqliteFirst });

    const sqliteBatch = await sqlite.batch([
      sqlite.prepare(
        `INSERT OR IGNORE INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-a", "ignored", 999),
      sqlite.prepare(
        `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-b", "beta", 2)
    ]);
    const postgresBatch = await postgresDb.batch([
      postgresDb.prepare(
        `INSERT OR IGNORE INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-a", "ignored", 999),
      postgresDb.prepare(
        `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-b", "beta", 2)
    ]);
    assert.deepEqual(
      postgresBatch.map(result => result.meta.changes),
      sqliteBatch.map(result => result.meta.changes)
    );

    const sqliteAll = await sqlite.prepare(
      `SELECT id, value, amount FROM probe ORDER BY id`
    ).all();
    const postgresAll = await postgresDb.prepare(
      `SELECT id, value, amount FROM probe ORDER BY id`
    ).all();
    assert.deepEqual(
      postgresAll.results.map(row => ({ ...row })),
      sqliteAll.results.map(row => ({ ...row }))
    );

    await assert.rejects(
      () => postgresDb.batch([
        postgresDb.prepare(
          `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
        ).bind("row-c", "gamma", 3),
        postgresDb.prepare(
          `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
        ).bind("row-b", "duplicate", 4)
      ])
    );
    const remaining = await postgresDb.prepare(
      `SELECT COUNT(*) AS count FROM probe WHERE id = ?`
    ).bind("row-c").first();
    assert.equal(remaining.count, 0);
    const failedJournal = sqlite.database.prepare(
      `SELECT status, recovery_disposition
         FROM cpoly_pg_write_journal
        ORDER BY created_at DESC
        LIMIT 1`
    ).get();
    assert.equal(failedJournal.status, "failed");
    assert.equal(
      failedJournal.recovery_disposition,
      "terminal_rejected"
    );

    sqlite.database.prepare(
      `UPDATE cpoly_pg_write_journal
          SET status = 'pending', applied_at = NULL
        WHERE request_id = ?`
    ).run(firstJournal.request_id);
    await postgresDb.replayRecoveryJournal({ limit: 10 });
    assert.equal(
      (await postgresDb.prepare(
        `SELECT COUNT(*) AS count FROM probe WHERE id = ?`
      ).bind("row-a").first()).count,
      1
    );
    const replayedJournal = sqlite.database.prepare(
      `SELECT status
         FROM cpoly_pg_write_journal
        WHERE request_id = ?`
    ).get(firstJournal.request_id);
    assert.equal(replayedJournal.status, "applied");
  } finally {
    await postgresDb.close();
    sqlite.database.close();
    await fixture.close();
  }
});

test("Postgres journal replay fails closed on request-id payload conflicts", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("journal-conflict");
  const recoveryDb = new D1ProbeDatabase();
  const masterKey = "cpoly-journal-master-key-test-2026";
  const postgresDb = new PostgresD1Database({
    connectionString: fixture.connectionString,
    recoveryDb,
    recoveryMasterKey: masterKey
  }, {
    applicationName: "adg-postgres-journal-conflict-test"
  });
  try {
    await fixture.sql.unsafe(`
      CREATE TABLE probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        amount BIGINT NOT NULL
      );
    `);
    await postgresDb.prepare(
      `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
    ).bind("row-a", "alpha", 1).run();
    const original = recoveryDb.database.prepare(
      `SELECT request_id
         FROM cpoly_pg_write_journal
        ORDER BY created_at ASC
        LIMIT 1`
    ).get();
    const conflictPayload = buildJournalPayload({
      requestId: original.request_id,
      operationKind: "run",
      operations: [{
        mode: "run",
        sql: `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`,
        params: ["row-z", "conflict", 999]
      }]
    });
    const conflictCiphertext = await encryptRecoveryString(
      conflictPayload.json,
      masterKey,
      postgresJournalPurpose()
    );
    recoveryDb.database.prepare(
      `UPDATE cpoly_pg_write_journal
          SET status = 'pending',
              applied_at = NULL,
              payload_hash = ?,
              ciphertext = ?
        WHERE request_id = ?`
    ).run(
      conflictPayload.hash,
      Buffer.from(conflictCiphertext),
      original.request_id
    );
    await postgresDb.replayRecoveryJournal({ limit: 10 });
    const failed = recoveryDb.database.prepare(
      `SELECT status, recovery_disposition
         FROM cpoly_pg_write_journal
        WHERE request_id = ?`
    ).get(original.request_id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.recovery_disposition, "blocking");
    const absent = await postgresDb.prepare(
      `SELECT COUNT(*) AS count FROM probe WHERE id = ?`
    ).bind("row-z").first();
    assert.equal(absent.count, 0);
  } finally {
    await postgresDb.close();
    recoveryDb.database.close();
    await fixture.close();
  }
});

test("Postgres journal cleanup only removes rows covered by verified snapshot watermark", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("journal-cleanup");
  const recoveryDb = new D1ProbeDatabase();
  const postgresDb = new PostgresD1Database({
    connectionString: fixture.connectionString,
    recoveryDb,
    recoveryMasterKey: "cpoly-journal-master-key-test-2026"
  }, {
    applicationName: "adg-postgres-journal-cleanup-test"
  });
  try {
    await fixture.sql.unsafe(`
      CREATE TABLE probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        amount BIGINT NOT NULL
      );
    `);
    for (const [id, amount] of [["row-a", 1], ["row-b", 2], ["row-c", 3]]) {
      await postgresDb.prepare(
        `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind(id, id, amount).run();
    }
    const before = recoveryDb.database.prepare(
      `SELECT request_id, postgres_generation, postgres_receipt_seq
         FROM cpoly_pg_write_journal
        ORDER BY postgres_receipt_seq ASC`
    ).all();
    assert.deepEqual(
      before.map(row => Number(row.postgres_receipt_seq)),
      [1, 2, 3]
    );
    const deleted = await postgresDb.cleanupRecoveryJournal({
      verifiedSnapshot: {
        generation: 1,
        watermark: 2
      },
      limit: 10
    });
    assert.equal(deleted, 2);
    const remaining = recoveryDb.database.prepare(
      `SELECT postgres_generation, postgres_receipt_seq
         FROM cpoly_pg_write_journal
        ORDER BY postgres_receipt_seq ASC`
    ).all();
    assert.deepEqual(
      remaining.map(row => ({
        generation: Number(row.postgres_generation),
        seq: Number(row.postgres_receipt_seq)
      })),
      [{ generation: 1, seq: 3 }]
    );
  } finally {
    await postgresDb.close();
    recoveryDb.database.close();
    await fixture.close();
  }
});

test("Postgres adapter preserves consensus CAS semantics", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("consensus");
  const recoveryDb = new D1ProbeDatabase();
  const db = new PostgresD1Database({
    connectionString: fixture.connectionString,
    recoveryDb,
    recoveryMasterKey: "cpoly-journal-master-key-test-2026"
  }, {
    applicationName: "adg-postgres-consensus-test"
  });
  try {
    const packet = JSON.parse(readFileSync(packetPath, "utf8"));
    const packetRoot = await computePacketMerkleRoot(packet);
    const openedAt = 1735689600000;
    const task = await ensureConsensusTask(db, packet, packetRoot, openedAt);
    const round = await getCurrentConsensusRound(db, task);
    assert.ok(round);
    const updated = await transitionConsensusTask(db, task, {
      toState: "independent-review",
      roundId: round.id,
      eventType: "independent-review-opened",
      reasonCode: "adapters-parity-check",
      idempotencyKey: `postgres-cas:${task.id}:1`,
      createdAt: openedAt + 1
    });
    assert.equal(updated.state, "independent-review");
    await assert.rejects(
      () => transitionConsensusTask(db, task, {
        toState: "independent-review",
        roundId: round.id,
        eventType: "independent-review-opened",
        reasonCode: "stale-state-check",
        idempotencyKey: `postgres-cas:${task.id}:stale`,
        createdAt: openedAt + 2
      }),
      error => error instanceof ConsensusConflict
    );
  } finally {
    await db.close();
    recoveryDb.database.close();
    await fixture.close();
  }
});

test("D1-only runtime env remains unchanged without recovery secrets", () => {
  const db = new D1ProbeDatabase();
  const env = { DB: db };
  assert.equal(createRuntimeEnv(env), env);
  db.database.close();
});

function collectStaticSqlStatements() {
  const statements = [];
  const pattern = /prepare\(\s*`([\s\S]*?)`\s*\)/gmu;
  for (const filePath of sourceFiles) {
    const text = readFileSync(filePath, "utf8");
    for (const match of text.matchAll(pattern)) {
      const sql = String(match[1]);
      if (!sql.includes("${")) {
        statements.push(sql);
      }
    }
  }
  return statements;
}
