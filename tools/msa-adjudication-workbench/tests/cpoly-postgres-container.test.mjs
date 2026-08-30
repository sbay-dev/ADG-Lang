import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import {
  buildCpolyPostgresContainerEnv,
  CPOLY_POSTGRES_BACKUP_TRIGGER_PATH,
  CPOLY_POSTGRES_BACKUP_TRIGGER_SCHEMA,
  CPOLY_POSTGRES_EXECUTE_SCHEMA,
  CPOLY_POSTGRES_KEEPALIVE_PATH,
  CPOLY_POSTGRES_KEEPALIVE_SCHEMA,
  CPOLY_POSTGRES_PROMOTE_PATH,
  CPOLY_POSTGRES_QUERY_PATH,
  CPOLY_POSTGRES_RECEIPT_PATH,
  CPOLY_POSTGRES_STATUS_PATH,
  CPOLY_POSTGRES_STATUS_SCHEMA,
  cpolyPostgresProviderPathAllowed
} from "../src/cpoly-postgres-container.js";
import {
  ContainerPostgresD1Database,
  PostgresD1Database,
  createRuntimeEnv
} from "../src/database.js";
import {
  buildJournalPayload,
  encryptRecoveryString,
  postgresJournalPurpose,
  requeueAmbiguousFailedJournalEntries
} from "../src/cpoly-recovery.js";
import {
  serializeRows
} from "../infrastructure/cpoly-postgres/cloudflare/bridge/serialization.mjs";

const recoveryMasterKey = "cpoly-container-master-key-test-2026";

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
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    };
  }
}

class D1RecoveryDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const path of [
      "migrations/0005_cpoly_recovery.sql",
      "migrations/0006_cpoly_backup_contract.sql",
      "migrations/0007_cpoly_recovery_state.sql",
      "migrations/0008_cpoly_backup_metadata_hash.sql",
      "migrations/0009_cpoly_backup_kv_lane.sql"
    ]) {
      this.database.exec(readFileSync(path, "utf8"));
    }
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class FakeContainerStub {
  constructor(handler) {
    this.handler = handler;
    this.requests = [];
  }

  async fetch(request) {
    this.requests.push(request);
    return this.handler(request, this.requests.length - 1);
  }
}

test("container adapter preserves D1 shapes, private auth, and receipt forwarding", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  let receiptSeq = 0;
  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    assert.equal(request.headers.get("authorization"), "Bearer container-token");
    if (url.pathname === CPOLY_POSTGRES_QUERY_PATH) {
      const body = await request.json();
      assert.equal(body.schema, CPOLY_POSTGRES_EXECUTE_SCHEMA);
      assert.equal(body.operations.every(operation => !operation.sql.includes("?")), true);
      if (body.operationKind === "read") {
        assert.equal(body.transaction, false);
        return jsonResponse({
          ok: true,
          schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
          results: [{
            success: true,
            results: [{ id: "row-a", value: "alpha", amount: 1 }],
            meta: { changes: 0 }
          }],
          receipt: null
        });
      }
      assert.match(body.requestId, /^[0-9a-f-]{36}$/u);
      assert.match(body.payloadHash, /^[0-9a-f]{64}$/u);
      receiptSeq += 1;
      if (body.operationKind === "run") {
        return jsonResponse({
          ok: true,
          schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
          results: [{
            success: true,
            meta: { changes: 1, last_row_id: 0 }
          }],
          receipt: { generation: 1, receiptSeq }
        });
      }
      assert.match(body.operations[0].sql, /ON CONFLICT DO NOTHING/iu);
      return jsonResponse({
        ok: true,
        schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
        results: [
          {
            success: true,
            meta: { changes: 0, last_row_id: 0 }
          },
          {
            success: true,
            meta: { changes: 1, last_row_id: 0 }
          }
        ],
        receipt: { generation: 1, receiptSeq }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_RECEIPT_PATH) {
      return jsonResponse({
        ok: true,
        schema: "adg.cpoly-postgres.receipt-watermark.v1",
        receipt: { generation: 1, receiptSeq }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_PROMOTE_PATH) {
      const body = await request.json();
      assert.equal(body.targetGeneration, 2);
      assert.deepEqual(body.snapshotCoverage, {
        generation: 1,
        watermark: receiptSeq
      });
      return jsonResponse({
        ok: true,
        schema: "adg.cpoly-postgres.promote-generation.v1",
        receipt: { generation: 2, receiptSeq }
      });
    }
    throw new Error(`Unexpected container path: ${url.pathname}`);
  });

  const runtimeEnv = createRuntimeEnv({
    DB: recoveryDb,
    CPOLY_POSTGRES: {},
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    __CPOLY_POSTGRES_GET_CONTAINER__: () => stub
  });

  try {
    assert.ok(runtimeEnv.DB instanceof ContainerPostgresD1Database);

    const first = await runtimeEnv.DB.prepare(
      `SELECT id, value, amount FROM probe WHERE id = ?`
    ).bind("row-a").first();
    assert.deepEqual(first, {
      id: "row-a",
      value: "alpha",
      amount: 1
    });

    const inserted = await runtimeEnv.DB.prepare(
      `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
    ).bind("row-a", "alpha", 1).run();
    assert.equal(inserted.success, true);
    assert.equal(inserted.meta.changes, 1);

    const batch = await runtimeEnv.DB.batch([
      runtimeEnv.DB.prepare(
        `INSERT OR IGNORE INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-a", "ignored", 99),
      runtimeEnv.DB.prepare(
        `INSERT INTO probe (id, value, amount) VALUES (?, ?, ?)`
      ).bind("row-b", "beta", 2)
    ]);
    assert.deepEqual(
      batch.map(result => result.meta.changes),
      [0, 1]
    );

    const receipt = await runtimeEnv.DB.getCurrentReceiptWatermark();
    assert.deepEqual(receipt, { generation: 1, receiptSeq: 2 });

    await runtimeEnv.DB.promoteRecoveryGeneration(
      { generation: 1, watermark: 2 },
      2
    );

    const journalRow = recoveryDb.database.prepare(
      `SELECT status, ciphertext
         FROM cpoly_pg_write_journal
        ORDER BY created_at ASC
        LIMIT 1`
    ).get();
    assert.equal(journalRow.status, "applied");
    assert.equal(
      Buffer.from(journalRow.ciphertext).includes(Buffer.from("alpha")),
      false
    );
  } finally {
    await runtimeEnv.__runtimeCleanup__?.();
    recoveryDb.database.close();
  }
});

test("container recovery replays legacy disconnect failures under the same request id", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  const requestId = "6dbedce1-14ea-4d66-87e5-2f53291f9310";
  const payload = buildJournalPayload({
    requestId,
    operationKind: "run",
    operations: [{
      mode: "run",
      sql: "INSERT INTO probe (id, value) VALUES (?, ?)",
      params: ["row-a", "alpha"]
    }]
  });
  const ciphertext = await encryptRecoveryString(
    payload.json,
    recoveryMasterKey,
    postgresJournalPurpose()
  );
  recoveryDb.database.prepare(
    `INSERT INTO cpoly_pg_write_journal
      (request_id, payload_hash, operation_kind, statement_count, status,
       ciphertext, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, 'run', 1, 'failed', ?, 1, ?, ?, ?)`
  ).run(
    requestId,
    payload.hash,
    Buffer.from(ciphertext),
    "Container suddenly disconnected, try again",
    1787475617084,
    1787475617268
  );

  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    if (url.pathname === CPOLY_POSTGRES_PROMOTE_PATH) {
      const body = await request.json();
      assert.deepEqual(body.snapshotCoverage, {
        generation: 70,
        watermark: 2407
      });
      assert.equal(body.targetGeneration, 71);
      return jsonResponse({
        ok: true,
        schema: "adg.cpoly-postgres.promote-generation.v1",
        receipt: { generation: 71, receiptSeq: 2407 }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_QUERY_PATH) {
      const body = await request.json();
      assert.equal(body.requestId, requestId);
      assert.equal(body.payloadHash, payload.hash);
      assert.equal(body.expectedGeneration, 71);
      return jsonResponse({
        ok: true,
        schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
        results: [{
          success: true,
          meta: { changes: 1, last_row_id: 0 }
        }],
        receipt: { generation: 71, receiptSeq: 2408 }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_RECEIPT_PATH) {
      return jsonResponse({
        ok: true,
        schema: "adg.cpoly-postgres.receipt-watermark.v1",
        receipt: { generation: 71, receiptSeq: 2408 }
      });
    }
    throw new Error(`Unexpected recovery container path: ${url.pathname}`);
  });
  const runtimeEnv = createRuntimeEnv({
    DB: recoveryDb,
    CPOLY_POSTGRES: {},
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-staging",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    __CPOLY_POSTGRES_GET_CONTAINER__: () => stub
  });

  try {
    assert.deepEqual(
      await runtimeEnv.DB.completeRecoveryReplay({
        snapshotCoverage: { generation: 70, watermark: 2407 },
        targetGeneration: 71,
        limit: 10
      }),
      {
        generation: 71,
        receiptSeq: 2408,
        replayed: 1,
        pending: 0
      }
    );
    assert.deepEqual(
      { ...recoveryDb.database.prepare(
        `SELECT status, attempts, last_error,
                postgres_generation, postgres_receipt_seq
           FROM cpoly_pg_write_journal
          WHERE request_id = ?`
      ).get(requestId) },
      {
        status: "applied",
        attempts: 2,
        last_error: null,
        postgres_generation: 71,
        postgres_receipt_seq: 2408
      }
    );
  } finally {
    await runtimeEnv.__runtimeCleanup__?.();
    recoveryDb.database.close();
  }
});

test("legacy recovery keeps definitive journal failures blocked", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  recoveryDb.database.prepare(
    `INSERT INTO cpoly_pg_write_journal
      (request_id, payload_hash, operation_kind, statement_count, status,
       ciphertext, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, 'run', 1, 'failed', ?, 1, ?, ?, ?)`
  ).run(
    "90fdf667-f96a-446f-a408-d50be7b537f4",
    "a".repeat(64),
    Buffer.from([1]),
    "duplicate key value violates unique constraint",
    1787475617084,
    1787475617268
  );

  try {
    assert.equal(
      await requeueAmbiguousFailedJournalEntries(
        recoveryDb,
        1788060000000
      ),
      0
    );
    assert.equal(
      recoveryDb.database.prepare(
        "SELECT status FROM cpoly_pg_write_journal"
      ).get().status,
      "failed"
    );
  } finally {
    recoveryDb.database.close();
  }
});

test("container recovery keeps keepalive non-blocking and carries the cumulative watermark", () => {
  const bridge = readFileSync(
    "infrastructure/cpoly-postgres/cloudflare/bridge/server.mjs",
    "utf8"
  );
  assert.match(bridge, /async function globalReceiptWatermark/u);
  assert.match(
    bridge,
    /url\.pathname === paths\.keepalive[\s\S]*?await statusPayload\(KEEPALIVE_SCHEMA\)/u
  );
  assert.doesNotMatch(bridge, /waitForKeepaliveStatus/u);
  assert.doesNotMatch(bridge, /WHERE generation = \$\{generation\}/u);
  assert.doesNotMatch(bridge, /ON receipt\.generation = runtime\.current_generation/u);

  for (const path of [
    "infrastructure/cpoly-postgres/scripts/create-kv-binary-backup.sh",
    "infrastructure/cpoly-postgres/scripts/create-encrypted-backup.sh",
    "infrastructure/cpoly-postgres/cloudflare/runtime/scripts/create-kv-binary-backup.sh"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      /SELECT COALESCE\(MAX\(receipt_seq\), 0\) FROM adjudication\.cpoly_write_receipts;/
    );
    assert.doesNotMatch(source, /WHERE generation =/u);
  }

  for (const path of [
    "infrastructure/cpoly-postgres/scripts/mark-recovery-ready.sh",
    "infrastructure/cpoly-postgres/cloudflare/runtime/scripts/mark-recovery-ready.sh"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /ON receipt\.generation = state\.current_generation/u
    );
  }
});

test("container bridge preserves text while normalizing safe integer columns", () => {
  const rows = [{
    created_at: "1786811084764",
    numeric_label: "123",
    unsafe_integer: "9007199254740993",
    payload: Uint8Array.from([1, 2, 3])
  }];
  Object.defineProperty(rows, "columns", {
    value: [
      { name: "created_at", type: 20 },
      { name: "numeric_label", type: 25 },
      { name: "unsafe_integer", type: 20 },
      { name: "payload", type: 17 }
    ]
  });

  assert.deepEqual(serializeRows(rows), [{
    created_at: 1786811084764,
    numeric_label: "123",
    unsafe_integer: "9007199254740993",
    payload: "AQID"
  }]);
  assert.equal(
    new Date(serializeRows(rows)[0].created_at).toISOString(),
    "2026-08-15T16:24:44.764Z"
  );
});

test("runtime env prefers container binding before Hyperdrive and keeps fallbacks", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  const containerEnv = createRuntimeEnv({
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: "postgresql://user:pass@127.0.0.1:5432/adg"
    },
    CPOLY_POSTGRES: {},
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    __CPOLY_POSTGRES_GET_CONTAINER__: () => new FakeContainerStub(() => {
      throw new Error("should not fetch during selection");
    })
  });
  assert.ok(containerEnv.DB instanceof ContainerPostgresD1Database);
  assert.equal(containerEnv.RECOVERY_DB, recoveryDb);
  await containerEnv.__runtimeCleanup__?.();

  const hyperdriveEnv = createRuntimeEnv({
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: "postgresql://user:pass@127.0.0.1:5432/adg"
    },
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey
  });
  try {
    assert.ok(hyperdriveEnv.DB instanceof PostgresD1Database);
  } finally {
    await hyperdriveEnv.__runtimeCleanup__?.();
    recoveryDb.database.close();
  }

  const d1Only = { DB: { prepare() {} } };
  assert.equal(createRuntimeEnv(d1Only), d1Only);
});

test("container helper exposes only expected env keys and path allowlist", () => {
  const env = buildCpolyPostgresContainerEnv({
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-staging",
    CPOLY_POSTGRES_PROVIDER_PORT: "18444",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "token",
    CPOLY_BACKUP_HMAC_KEY: "backup-hmac",
    CPOLY_BACKUP_BASE_URL: "https://adg.sbay.sa",
    ADG_MIGRATOR_PASSWORD: "migrator-secret",
    ADG_RUNTIME_PASSWORD: "runtime-secret",
    ADG_BACKUP_PASSWORD: "backup-secret",
    POSTGRES_SUPERUSER_PASSWORD: "superuser-secret",
    CPOLY_ALLOW_FRESH_BOOTSTRAP: "true",
    CPOLY_RESUME_RECOVERY: "true",
    CPOLY_BACKUP_RETENTION_HOURS: "168",
    CPOLY_BACKUP_MAX_CHUNK_BYTES: "524288",
    CPOLY_BACKUP_MAX_BACKUP_BYTES: "33554432",
    CPOLY_BACKUP_MAX_CHUNKS: "512",
    EXTRA_SECRET: "must-not-leak"
  });
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "ADG_BACKUP_PASSWORD",
      "ADG_MIGRATOR_PASSWORD",
      "ADG_RUNTIME_PASSWORD",
      "CPOLY_BACKUP_HMAC_KEY",
      "CPOLY_BACKUP_BASE_URL",
      "CPOLY_ALLOW_FRESH_BOOTSTRAP",
      "CPOLY_RESUME_RECOVERY",
      "CPOLY_BACKUP_MAX_BACKUP_BYTES",
      "CPOLY_BACKUP_MAX_CHUNK_BYTES",
      "CPOLY_BACKUP_MAX_CHUNKS",
      "CPOLY_BACKUP_RETENTION_HOURS",
      "CPOLY_POSTGRES_INSTANCE_ID",
      "CPOLY_POSTGRES_INTERNAL_TOKEN",
      "CPOLY_POSTGRES_PROVIDER_PORT",
      "POSTGRES_SUPERUSER_PASSWORD"
    ].sort()
  );
  assert.equal(env.CPOLY_BACKUP_BASE_URL, "https://adg.sbay.sa");
  assert.equal(env.CPOLY_ALLOW_FRESH_BOOTSTRAP, "true");
  assert.equal(env.CPOLY_RESUME_RECOVERY, "true");
  assert.equal(cpolyPostgresProviderPathAllowed(CPOLY_POSTGRES_STATUS_PATH), true);
  assert.equal(cpolyPostgresProviderPathAllowed(CPOLY_POSTGRES_KEEPALIVE_PATH), true);
  assert.equal(cpolyPostgresProviderPathAllowed("/api/config"), false);
});

test("deployed containers resume only signed recovery instead of fresh bootstrap", () => {
  const exampleConfig = readFileSync("wrangler.example.jsonc", "utf8");
  assert.match(
    exampleConfig,
    /"CPOLY_ALLOW_FRESH_BOOTSTRAP":\s*"false"/u
  );
  assert.match(
    exampleConfig,
    /"CPOLY_RESUME_RECOVERY":\s*"true"/u
  );
});

test("Cloudflare entrypoint recreates runtime directories and migrates every boot", () => {
  const dockerfile = readFileSync(
    "infrastructure/cpoly-postgres/cloudflare/Dockerfile",
    "utf8"
  );
  const entrypoint = readFileSync(
    "infrastructure/cpoly-postgres/cloudflare/scripts/entrypoint.sh",
    "utf8"
  );

  assert.match(dockerfile, /\nUSER root\s*\nENTRYPOINT /u);
  assert.match(entrypoint, /if \[ "\$\(id -u\)" -eq 0 \]; then/u);
  assert.match(entrypoint, /install -d -m 0700 -o postgres -g postgres/u);
  assert.match(entrypoint, /\/run\/cpoly\/secrets/u);
  assert.match(entrypoint, /\/run\/secrets\/roles/u);
  assert.match(entrypoint, /exec gosu postgres "\$0" "\$@"/u);
  assert.match(entrypoint, /startup_failure_file=/u);
  assert.match(entrypoint, /startup_stage=restore-backup/u);
  assert.match(entrypoint, /trap record_startup_failure EXIT/u);
  assert.match(entrypoint, /kill -0 "\$bridge_pid"[\s\S]*?sleep 10/u);
  const mainBody = entrypoint.match(/main\(\) \{(?<body>[\s\S]*?)\n\}/u)
    ?.groups?.body;
  assert.ok(mainBody);
  assert.match(mainBody, /if \[ "\$new_cluster" = "true" \]; then/u);
  assert.ok(
    mainBody.indexOf("\n  apply_migrations\n")
      < mainBody.indexOf("\n  export PGHOST=")
  );
  assert.equal(mainBody.match(/\bapply_migrations\b/gu)?.length, 1);
});

test("dynamic traffic is gated while the CPOLY PostgreSQL container is not ready", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    if (url.pathname !== CPOLY_POSTGRES_STATUS_PATH) {
      throw new Error(`Unexpected container path: ${url.pathname}`);
    }
    return jsonResponse({
      ok: true,
      schema: CPOLY_POSTGRES_STATUS_SCHEMA,
      status: {
        instanceId: "cpoly-postgres-production",
        state: "restoring",
        ready: false,
        currentGeneration: 1,
        receiptWatermark: 0,
        backupInProgress: false
      }
    });
  });

  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/config", { method: "GET" }),
    {
      DB: recoveryDb,
      CPOLY_POSTGRES: {},
      CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
      CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
      CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
      __CPOLY_POSTGRES_GET_CONTAINER__: () => stub
    }
  );
  assert.equal(response.status, 503);
  recoveryDb.database.close();
});

test("scheduled maintenance keeps the container warm, triggers backups, and reuses one instance id", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  const seenInstanceIds = new Set();
  const calls = [];
  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname === CPOLY_POSTGRES_KEEPALIVE_PATH) {
      const body = await request.json();
      assert.equal(body.schema, CPOLY_POSTGRES_KEEPALIVE_SCHEMA);
      return jsonResponse({
        ok: true,
        schema: CPOLY_POSTGRES_KEEPALIVE_SCHEMA,
        status: {
          instanceId: "cpoly-postgres-production",
          state: "ready",
          ready: true,
          currentGeneration: 1,
          receiptWatermark: 0,
          backupInProgress: false
        }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_BACKUP_TRIGGER_PATH) {
      const body = await request.json();
      assert.equal(body.schema, CPOLY_POSTGRES_BACKUP_TRIGGER_SCHEMA);
      assert.equal(
        body.backupApiBaseUrl,
        "https://adg.sbay.sa/api/internal/cpoly-backups"
      );
      return jsonResponse({
        accepted: true,
        schema: CPOLY_POSTGRES_BACKUP_TRIGGER_SCHEMA,
        status: {
          instanceId: "cpoly-postgres-production",
          state: "ready",
          ready: true,
          currentGeneration: 1,
          receiptWatermark: 0,
          backupInProgress: true
        },
        backup: {
          state: "queued",
          reason: "scheduled",
          backupId: null
        }
      });
    }
    if (url.pathname === CPOLY_POSTGRES_QUERY_PATH) {
      const body = await request.json();
      return jsonResponse({
        ok: true,
        schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
        results: body.operations.map(operation => operation.mode === "all"
          ? { success: true, results: [], meta: { changes: 0 } }
          : { success: true, meta: { changes: 0, last_row_id: 0 } }),
        receipt: body.transaction && body.requestId
          ? { generation: 1, receiptSeq: 1 }
          : null
      });
    }
    throw new Error(`Unexpected scheduled container path: ${url.pathname}`);
  });

  const env = {
    DB: recoveryDb,
    CPOLY_POSTGRES: {},
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    CPOLY_BACKUP_HMAC_KEY: "backup-hmac",
    ALLOWED_ORIGIN: "https://adg.sbay.sa",
    NOTIFICATION_EMAIL_ENABLED: "false",
    EMAIL_VERIFICATION_ENABLED: "false",
    __CPOLY_POSTGRES_GET_CONTAINER__: (_binding, instanceId) => {
      seenInstanceIds.add(instanceId);
      return stub;
    }
  };

  await runScheduled(env);
  assert.equal(seenInstanceIds.size, 1);
  assert.ok(calls.includes(CPOLY_POSTGRES_KEEPALIVE_PATH));
  assert.ok(calls.includes(CPOLY_POSTGRES_BACKUP_TRIGGER_PATH));
  recoveryDb.database.close();
});

test("scheduled maintenance skips side effects until the container becomes ready", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  const calls = [];
  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname === CPOLY_POSTGRES_KEEPALIVE_PATH) {
      return jsonResponse({
        ok: true,
        schema: CPOLY_POSTGRES_KEEPALIVE_SCHEMA,
        status: {
          instanceId: "cpoly-postgres-production",
          state: "starting",
          ready: false,
          currentGeneration: 1,
          receiptWatermark: 0,
          backupInProgress: false
        }
      });
    }
    throw new Error(`Unexpected not-ready container path: ${url.pathname}`);
  });

  await runScheduled({
    DB: recoveryDb,
    CPOLY_POSTGRES: {},
    CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
    CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    CPOLY_BACKUP_HMAC_KEY: "backup-hmac",
    ALLOWED_ORIGIN: "https://adg.sbay.sa",
    __CPOLY_POSTGRES_GET_CONTAINER__: () => stub
  });

  assert.deepEqual(calls, [CPOLY_POSTGRES_KEEPALIVE_PATH]);
  recoveryDb.database.close();
});

test("scheduled maintenance persists bounded container startup failures", async () => {
  const recoveryDb = new D1RecoveryDatabase();
  recoveryDb.database.prepare(
    `UPDATE cpoly_recovery_runtime
        SET state = 'recovering',
            target_generation = 2,
            recovery_id = ?,
            updated_at = ?
      WHERE slot = 'global'`
  ).run(
    "81bd6d55-03bb-48bd-ad32-571ebe98938e",
    1788062415728
  );
  const stub = new FakeContainerStub(async request => {
    const url = new URL(request.url);
    assert.equal(url.pathname, CPOLY_POSTGRES_KEEPALIVE_PATH);
    return jsonResponse({
      ok: true,
      schema: CPOLY_POSTGRES_KEEPALIVE_SCHEMA,
      status: {
        instanceId: "cpoly-postgres-production",
        state: "restoring",
        ready: false,
        currentGeneration: 9,
        receiptWatermark: 4427,
        backupInProgress: false,
        lastError: "startup-failure:stage=restore-backup exit=1"
      }
    });
  });

  try {
    await runScheduled({
      DB: recoveryDb,
      CPOLY_POSTGRES: {},
      CPOLY_POSTGRES_INSTANCE_ID: "cpoly-postgres-production",
      CPOLY_POSTGRES_INTERNAL_TOKEN: "container-token",
      CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
      CPOLY_BACKUP_HMAC_KEY: "backup-hmac",
      ALLOWED_ORIGIN: "https://adg.sbay.sa",
      __CPOLY_POSTGRES_GET_CONTAINER__: () => stub
    });
    assert.equal(
      recoveryDb.database.prepare(
        `SELECT last_error
           FROM cpoly_recovery_runtime
          WHERE slot = 'global'`
      ).get().last_error,
      "Container startup failed: startup-failure:stage=restore-backup exit=1"
    );
  } finally {
    recoveryDb.database.close();
  }
});

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

async function runScheduled(env) {
  let pending = Promise.resolve();
  await worker.scheduled({}, env, {
    waitUntil(promise) {
      pending = promise;
    }
  });
  await pending;
}
