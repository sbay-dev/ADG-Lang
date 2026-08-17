import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import {
  buildCpolyCanonicalText,
  hmacSha256Hex,
  normalizeBinaryValue,
  sha256HexBytes
} from "../src/cpoly-recovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENPGP_FIXTURE = Uint8Array.from(Buffer.from(
  readFileSync(
    path.join(__dirname, "fixtures", "cpoly-openpgp-symmetric-aes256.base64"),
    "ascii"
  ).trim(),
  "base64"
));
const BINARY_FIXTURE = Uint8Array.from(
  { length: 1537 },
  (_, index) => (index * 29 + 17) % 251
);
const BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, EntityCrypt protected-column " +
  "attestations, separate role bootstrap handling, and the requested " +
  "restore test only. Off-host replication and recovery-time objectives " +
  "require separate scheduled operations."
);
const LEGACY_BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, encryption, and the requested restore " +
  "test only. Off-host replication and recovery-time objectives require " +
  "separate scheduled operations."
);

test("Cloudflare D1 byte arrays normalize without weakening binary validation", () => {
  assert.deepEqual(
    Array.from(normalizeBinaryValue([0, 127, 255])),
    [0, 127, 255]
  );
  for (const invalid of [[-1], [256], [1.5], ["1"], { 0: 1 }]) {
    assert.throws(
      () => normalizeBinaryValue(invalid),
      /Binary recovery value was invalid/u
    );
  }
});

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

class D1TestDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const migrationPath of [
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
    ]) {
      this.database.exec(readFileSync(migrationPath, "utf8"));
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

class MemoryKvNamespace {
  constructor() {
    this.entries = new Map();
    this.puts = [];
    this.deletes = [];
    this.putHistory = new Set();
    this.failDeleteKeys = new Set();
    this.hiddenReads = new Map();
    this.tamperedReads = new Map();
  }

  async put(name, value, options = {}) {
    const key = String(name);
    if (this.putHistory.has(key)) {
      throw new Error("kv-overwrite-forbidden");
    }
    const bytes = normalizeBytes(value);
    this.putHistory.add(key);
    this.entries.set(key, {
      bytes,
      metadata: options.metadata ?? null
    });
    this.puts.push(key);
  }

  async get(name, type = "text") {
    const key = String(name);
    const delayedReads = Number(this.hiddenReads.get(key) || 0);
    if (delayedReads > 0) {
      this.hiddenReads.set(key, delayedReads - 1);
      return null;
    }
    const tamperPlan = this.tamperedReads.get(key);
    if (tamperPlan && tamperPlan.remaining > 0) {
      tamperPlan.remaining -= 1;
      return materializeKvRead(tamperPlan.bytes, type);
    }
    const entry = this.entries.get(key);
    if (!entry) return null;
    return materializeKvRead(entry.bytes, type);
  }

  async delete(name) {
    const key = String(name);
    if (this.failDeleteKeys.has(key)) {
      throw new Error("delete-failed");
    }
    this.deletes.push(key);
    this.entries.delete(key);
  }

  has(name) {
    return this.entries.has(String(name));
  }

  bytes(name) {
    const entry = this.entries.get(String(name));
    return entry ? Uint8Array.from(entry.bytes) : null;
  }

  remove(name) {
    this.entries.delete(String(name));
  }

  tamper(name, value) {
    const key = String(name);
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`missing KV key ${key}`);
    this.entries.set(key, {
      ...entry,
      bytes: normalizeBytes(value)
    });
  }

  delayVisibility(name, reads) {
    this.hiddenReads.set(String(name), Number(reads || 0));
  }

  delayHashMismatch(name, reads, value = null) {
    const key = String(name);
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`missing KV key ${key}`);
    this.tamperedReads.set(key, {
      remaining: Number(reads || 0),
      bytes: normalizeBytes(value ?? mutateBytes(entry.bytes))
    });
  }
}

test("CPOLY backup APIs reject bad signatures, skew, and replayed nonces", async () => {
  const db = new D1TestDatabase();
  const env = backupEnv(db);
  const body = jsonBytes(buildBackupUploadSpec(binaryFixtureChunks(64)).createBody);

  const badSignature = await signedRequest("/api/internal/cpoly-backups", {
    method: "POST",
    body,
    secret: "wrong-secret"
  });
  const badSignatureResponse = await worker.fetch(badSignature, env);
  assert.equal(badSignatureResponse.status, 401);

  const staleRequest = await signedRequest("/api/internal/cpoly-backups", {
    method: "POST",
    body,
    secret: env.CPOLY_BACKUP_HMAC_KEY,
    timestamp: Date.now() - 10 * 60 * 1000
  });
  const staleResponse = await worker.fetch(staleRequest, env);
  assert.equal(staleResponse.status, 401);

  const futureRequest = await signedRequest("/api/internal/cpoly-backups", {
    method: "POST",
    body,
    secret: env.CPOLY_BACKUP_HMAC_KEY,
    timestamp: Date.now() + 10 * 60 * 1000,
    nonce: "01010101-0101-4101-8101-010101010101"
  });
  const futureResponse = await worker.fetch(futureRequest, env);
  assert.equal(futureResponse.status, 401);

  const nonce = "11111111-1111-4111-8111-111111111111";
  const first = await signedRequest("/api/internal/cpoly-backups", {
    method: "POST",
    body,
    secret: env.CPOLY_BACKUP_HMAC_KEY,
    nonce
  });
  const firstResponse = await worker.fetch(first, env);
  assert.equal(firstResponse.status, 201);

  const replay = await signedRequest("/api/internal/cpoly-backups", {
    method: "POST",
    body,
    secret: env.CPOLY_BACKUP_HMAC_KEY,
    nonce
  });
  const replayResponse = await worker.fetch(replay, env);
  assert.equal(replayResponse.status, 409);
});

test("CPOLY backup lane stores binary chunks in KV, leaves D1 as metadata only, and reassembles exact restore bytes", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = backupEnv(db, {
    CPOLY_BACKUPS: store,
    CPOLY_BACKUP_MAX_CHUNK_BYTES: "160",
    CPOLY_BACKUP_MAX_BACKUP_BYTES: "4096"
  });
  const spec = buildBackupUploadSpec(binaryFixtureChunks(145), {
    snapshotGeneration: 1,
    postgresReceiptWatermark: 10
  });

  const create = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups", {
      method: "POST",
      body: jsonBytes(spec.createBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY
    }),
    env
  );
  assert.equal(create.status, 201);
  const created = await create.json();
  const backupId = created.backup.backupId;

  const outOfOrder = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${backupId}/chunks/1`, {
      method: "PUT",
      body: spec.chunks[1],
      secret: env.CPOLY_BACKUP_HMAC_KEY
    }),
    env
  );
  assert.equal(outOfOrder.status, 409);

  for (const [index, chunk] of spec.chunks.entries()) {
    const upload = await worker.fetch(
      await signedRequest(`/api/internal/cpoly-backups/${backupId}/chunks/${index}`, {
        method: "PUT",
        body: chunk,
        secret: env.CPOLY_BACKUP_HMAC_KEY
      }),
      env
    );
    assert.equal(upload.status, 200);
  }

  const firstKey = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = 0`
  ).get(backupId).kv_key;
  assert.match(
    firstKey,
    /^cpoly-backups\/v1\/[0-9a-f-]{36}\/chunks\/000000\/[0-9a-f-]{36}$/u
  );
  assert.deepEqual(store.bytes(firstKey), spec.chunks[0]);
  assert.equal(
    db.database.prepare(
      "SELECT COUNT(*) AS count FROM cpoly_backup_chunks WHERE backup_id = ?"
    ).get(backupId).count,
    0
  );

  const complete = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${backupId}/complete`, {
      method: "POST",
      body: jsonBytes(spec.completeBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY
    }),
    env
  );
  assert.equal(complete.status, 200);

  const higherPendingSpec = buildBackupUploadSpec(binaryFixtureChunks(128), {
    snapshotGeneration: 2,
    postgresReceiptWatermark: 20,
    fileName: "cpoly-postgres-backup-next.dump"
  });
  const higherPendingCreate = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups", {
      method: "POST",
      body: jsonBytes(higherPendingSpec.createBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "77777777-7777-4777-8777-777777777777"
    }),
    env
  );
  const higherPendingId = (await higherPendingCreate.json()).backup.backupId;
  const partialUpload = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${higherPendingId}/chunks/0`, {
      method: "PUT",
      body: higherPendingSpec.chunks[0],
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "88888888-8888-4888-8888-888888888888"
    }),
    env
  );
  assert.equal(partialUpload.status, 200);

  const latest = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups/latest", {
      method: "GET",
      body: new Uint8Array(0),
      secret: env.CPOLY_BACKUP_HMAC_KEY
    }),
    env
  );
  assert.equal(latest.status, 200);
  const latestValue = await latest.json();
  assert.equal(latestValue.backup.backupId, backupId);
  assert.equal(latestValue.backup.archive.encryptionFormat, "none");
  assert.equal(typeof latestValue.backup.availableAfter, "number");
  assert.match(
    latestValue.backup.availableAfterUtc,
    /^20\d{2}-\d{2}-\d{2}T/u
  );
  assert.equal(
    latestValue.backup.attestations?.protected_columns_entitycrypt ?? latestValue.backup.metadata.attestations.protected_columns_entitycrypt,
    true
  );
  assert.equal(latestValue.backup.claimBoundary, BACKUP_CLAIM_BOUNDARY);

  const restored = [];
  for (let index = 0; index < spec.chunks.length; index += 1) {
    const response = await worker.fetch(
      await signedRequest(`/api/internal/cpoly-backups/${backupId}/chunks/${index}`, {
        method: "GET",
        body: new Uint8Array(0),
        secret: env.CPOLY_BACKUP_HMAC_KEY,
        nonce: `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      }),
      env
    );
    assert.equal(response.status, 200);
    restored.push(new Uint8Array(await response.arrayBuffer()));
  }
  const restoredBytes = concatenate(restored);
  assert.equal(sha256HexBytes(restoredBytes), spec.archive.sha256);
  assert.deepEqual(restoredBytes, concatenate(spec.chunks));
});

test("CPOLY backup lane repairs missing idempotent chunks, fails incomplete completion, and detects tampered KV reads", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = backupEnv(db, {
    CPOLY_BACKUPS: store,
    CPOLY_BACKUP_MAX_CHUNK_BYTES: "256",
    CPOLY_BACKUP_MAX_BACKUP_BYTES: "4096"
  });

  const failedSpec = buildBackupUploadSpec(binaryFixtureChunks(200), {
    snapshotGeneration: 3,
    postgresReceiptWatermark: 30,
    fileName: "cpoly-incomplete.dump"
  });
  const failedBackupId = await createBackupWithChunks(env, failedSpec);
  const failedChunkKey = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = 0`
  ).get(failedBackupId).kv_key;
  store.remove(failedChunkKey);
  const failedComplete = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${failedBackupId}/complete`, {
      method: "POST",
      body: jsonBytes(failedSpec.completeBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "91919191-9191-4191-8191-919191919191"
    }),
    env
  );
  assert.equal(failedComplete.status, 409);
  assert.equal(
    db.database.prepare(
      "SELECT status FROM cpoly_backup_sets WHERE id = ?"
    ).get(failedBackupId).status,
    "failed"
  );

  const repairSpec = buildBackupUploadSpec(binaryFixtureChunks(190), {
    snapshotGeneration: 4,
    postgresReceiptWatermark: 40,
    fileName: "cpoly-repairable.dump"
  });
  const repairBackupId = await createBackup(env, repairSpec, "92929292-9292-4292-8292-929292929292");
  const firstUpload = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${repairBackupId}/chunks/0`, {
      method: "PUT",
      body: repairSpec.chunks[0],
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "93939393-9393-4393-8393-939393939393"
    }),
    env
  );
  assert.equal(firstUpload.status, 200);
  const repairKey = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = 0`
  ).get(repairBackupId).kv_key;
  store.remove(repairKey);
  const repairedUpload = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${repairBackupId}/chunks/0`, {
      method: "PUT",
      body: repairSpec.chunks[0],
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "94949494-9494-4494-8494-949494949494"
    }),
    env
  );
  assert.equal(repairedUpload.status, 200);
  const repairedUploadBody = await repairedUpload.json();
  assert.equal(repairedUploadBody.idempotent, true);
  assert.equal(repairedUploadBody.repaired, true);
  const replacementKey = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = 0`
  ).get(repairBackupId).kv_key;
  assert.notEqual(replacementKey, repairKey);
  assert.deepEqual(store.bytes(replacementKey), repairSpec.chunks[0]);
  assert.equal(store.has(repairKey), false);

  for (let index = 1; index < repairSpec.chunks.length; index += 1) {
    const upload = await worker.fetch(
      await signedRequest(`/api/internal/cpoly-backups/${repairBackupId}/chunks/${index}`, {
        method: "PUT",
        body: repairSpec.chunks[index],
        secret: env.CPOLY_BACKUP_HMAC_KEY,
        nonce: `95959595-9595-4595-8595-${String(index).padStart(12, "0")}`
      }),
      env
    );
    assert.equal(upload.status, 200);
  }
  const complete = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${repairBackupId}/complete`, {
      method: "POST",
      body: jsonBytes(repairSpec.completeBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "96969696-9696-4696-8696-969696969696"
    }),
    env
  );
  assert.equal(complete.status, 200);

  store.tamper(replacementKey, mutateBytes(repairSpec.chunks[0]));
  const tamperedFetch = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${repairBackupId}/chunks/0`, {
      method: "GET",
      body: new Uint8Array(0),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "97979797-9797-4797-8797-979797979797"
    }),
    env
  );
  assert.equal(tamperedFetch.status, 409);
});

test("latest descriptor carries availableAfter and priorBackup while newest KV visibility is still propagating", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = backupEnv(db, {
    CPOLY_BACKUPS: store,
    CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS: "60000"
  });
  const priorBackupId = await createAndCompleteBackup(
    env,
    binaryFixtureChunks(128),
    "12121212-1212-4212-8212-121212121212",
    {
      snapshotGeneration: 6,
      postgresReceiptWatermark: 60,
      fileName: "cpoly-prior.dump"
    }
  );
  const olderNow = Date.now() - (10 * 60 * 1000);
  db.database.prepare(
    `UPDATE cpoly_backup_sets
        SET created_at = ?,
            updated_at = ?,
            completed_at = ?,
            verified_at = ?
      WHERE id = ?`
  ).run(olderNow, olderNow, olderNow, olderNow, priorBackupId);

  const latestBackupId = await createAndCompleteBackup(
    env,
    binaryFixtureChunks(129),
    "13131313-1313-4313-8313-131313131313",
    {
      snapshotGeneration: 7,
      postgresReceiptWatermark: 70,
      fileName: "cpoly-latest.dump"
    }
  );
  const latest = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups/latest", {
      method: "GET",
      body: new Uint8Array(0),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "14141414-1414-4414-8414-141414141414"
    }),
    env
  );
  assert.equal(latest.status, 200);
  const payload = await latest.json();
  assert.equal(payload.backup.backupId, latestBackupId);
  assert.equal(payload.priorBackup.backupId, priorBackupId);
  assert.ok(payload.backup.availableAfter > Date.now());
  assert.ok(payload.priorBackup.availableAfter < Date.now());
});

test("scheduled cleanup enforces retained backup caps and deletes KV objects after D1 retention rules permit", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = backupEnv(db, {
    CPOLY_BACKUPS: store,
    CPOLY_BACKUP_MAX_RETAINED_BACKUPS: "1",
    CPOLY_BACKUP_MAX_RETAINED_BYTES: "2048"
  });
  const firstId = await createAndCompleteBackup(
    env,
    binaryFixtureChunks(220),
    "98989898-9898-4898-8898-989898989898",
    {
      snapshotGeneration: 1,
      postgresReceiptWatermark: 10,
      fileName: "cpoly-retained-first.dump"
    }
  );
  const secondId = await createAndCompleteBackup(
    env,
    binaryFixtureChunks(220),
    "99999999-9999-4999-8999-999999999999",
    {
      snapshotGeneration: 2,
      postgresReceiptWatermark: 20,
      fileName: "cpoly-retained-second.dump"
    }
  );
  const firstKeys = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ?
      ORDER BY chunk_index ASC`
  ).all(firstId).map(row => row.kv_key);

  const pending = [];
  await worker.scheduled({}, env, {
    waitUntil(promise) {
      pending.push(promise);
    }
  });
  await Promise.all(pending);

  const backups = db.database.prepare(
    `SELECT id
       FROM cpoly_backup_sets
      WHERE status = 'complete'
      ORDER BY snapshot_generation DESC, snapshot_watermark DESC`
  ).all().map(row => row.id);
  assert.deepEqual(backups, [secondId]);
  assert.equal(
    db.database.prepare(
      "SELECT COUNT(*) AS count FROM cpoly_backup_chunk_inventory WHERE backup_id = ?"
    ).get(firstId).count,
    0
  );
  for (const key of firstKeys) {
    assert.equal(store.has(key), false);
  }
  assert.ok(store.deletes.length >= firstKeys.length);
});

test("CPOLY backup lane keeps legacy OpenPGP metadata compatible for current restore tooling", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = backupEnv(db, { CPOLY_BACKUPS: store });
  const backupId = await createAndCompleteBackup(
    env,
    openPgpFixtureChunks(145),
    "10101010-1010-4010-8010-101010101010",
    {
      legacyEncrypted: true,
      snapshotGeneration: 5,
      postgresReceiptWatermark: 50,
      fileName: "cpoly-postgres-backup.tar.gpg"
    }
  );

  const latest = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups/latest", {
      method: "GET",
      body: new Uint8Array(0),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: "11111111-1111-4111-8111-222222222222"
    }),
    env
  );
  assert.equal(latest.status, 200);
  const latestValue = await latest.json();
  assert.equal(latestValue.backup.backupId, backupId);
  assert.equal(latestValue.backup.archive.encryptionFormat, "openpgp-symmetric-aes256");
  assert.equal(latestValue.backup.claimBoundary, LEGACY_BACKUP_CLAIM_BOUNDARY);
});

function backupEnv(db, extra = {}) {
  const { CPOLY_BACKUPS = new MemoryKvNamespace(), ...rest } = extra;
  return {
    DB: db,
    CPOLY_BACKUPS,
    CPOLY_BACKUP_HMAC_KEY: "cpoly-backup-hmac-test-key",
    CPOLY_BACKUP_MASTER_KEY: "cpoly-backup-master-key-test-2026",
    ...rest
  };
}

async function createBackup(env, spec, nonce = crypto.randomUUID()) {
  const create = await worker.fetch(
    await signedRequest("/api/internal/cpoly-backups", {
      method: "POST",
      body: jsonBytes(spec.createBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce
    }),
    env
  );
  assert.equal(create.status, 201);
  const created = await create.json();
  return created.backup.backupId;
}

async function createBackupWithChunks(env, spec) {
  const backupId = await createBackup(env, spec);
  for (const [index, chunk] of spec.chunks.entries()) {
    const response = await worker.fetch(
      await signedRequest(`/api/internal/cpoly-backups/${backupId}/chunks/${index}`, {
        method: "PUT",
        body: chunk,
        secret: env.CPOLY_BACKUP_HMAC_KEY,
        nonce: crypto.randomUUID()
      }),
      env
    );
    assert.equal(response.status, 200);
  }
  return backupId;
}

async function createAndCompleteBackup(env, chunks, baseNonce, options = {}) {
  const spec = buildBackupUploadSpec(chunks, options);
  const backupId = await createBackupWithChunks(env, spec);
  const complete = await worker.fetch(
    await signedRequest(`/api/internal/cpoly-backups/${backupId}/complete`, {
      method: "POST",
      body: jsonBytes(spec.completeBody),
      secret: env.CPOLY_BACKUP_HMAC_KEY,
      nonce: baseNonce
    }),
    env
  );
  assert.equal(complete.status, 200);
  return backupId;
}

function buildBackupUploadSpec(chunks, options = {}) {
  const normalizedChunks = chunks.map(chunk => normalizeBytes(chunk));
  const digest = createHash("sha256");
  let totalBytes = 0;
  for (const chunk of normalizedChunks) {
    digest.update(chunk);
    totalBytes += chunk.length;
  }
  const archive = {
    fileName: options.fileName || (
      options.legacyEncrypted
        ? "cpoly-postgres-backup.tar.gpg"
        : "cpoly-postgres-backup.dump"
    ),
    sizeBytes: totalBytes,
    sha256: digest.digest("hex"),
    chunkCount: normalizedChunks.length,
    chunkSizeBytes: Math.max(...normalizedChunks.map(chunk => chunk.length)),
    contentType: "application/octet-stream",
    encryptionFormat: options.legacyEncrypted
      ? "openpgp-symmetric-aes256"
      : "none",
    format: options.legacyEncrypted ? "openpgp-aes256-tar" : "postgres-custom"
  };
  const manifest = {
    schema: "cpoly_postgres_backup_v1",
    created_at_utc: options.createdAtUtc || "2026-08-15T00:00:00.000Z",
    source_container: options.sourceContainer || "cpoly-postgres-statefulset",
    source_image: options.sourceImage
      || "postgres@sha256:6a388fba16e2a94d6d92bc3c435cdc2e20145add88547615b3d8fa545d703afe",
    server_version: options.serverVersion || "16.4",
    databases: options.databases || [
      {
        oid: 16384,
        name: "adg_adjudication",
        bytes: 1024,
        dump: "database-16384.dump"
      }
    ],
    plaintext_file_hashes: options.plaintextFileHashes || [
      {
        name: "bootstrap-roles.sql",
        bytes: 32,
        sha256: sha256HexBytes(bytes("bootstrap-roles-sql"))
      },
      {
        name: "database-16384.dump",
        bytes: 48,
        sha256: sha256HexBytes(bytes("database-dump"))
      }
    ],
    attestations: {
      schema: "adg.cpoly-postgres.backup-attestations.v1",
      protected_columns_entitycrypt: true,
      role_password_material_excluded: true,
      bootstrap_roles_separate: true
    },
    restore_test: {
      requested: options.restoreRequested ?? true,
      status: options.restoreStatus || "PASS",
      databases: options.restoreDatabases || [
        {
          source_database: "adg_adjudication",
          target_database: "verify_16384",
          restored_bytes: 1024,
          status: "PASS"
        }
      ]
    },
    claim_boundary: options.claimBoundary || (
      options.legacyEncrypted
        ? LEGACY_BACKUP_CLAIM_BOUNDARY
        : BACKUP_CLAIM_BOUNDARY
    ),
    snapshotGeneration: options.snapshotGeneration || 1,
    postgresReceiptWatermark: options.postgresReceiptWatermark ?? 0
  };
  if (options.legacyEncrypted) {
    manifest.encryption = {
      status: "PASS_AES256_GPG_SYMMETRIC",
      algorithm: "AES-256 via OpenPGP symmetric encryption",
      key_source: options.keySource || "kubernetes_secret",
      secret_name: options.secretName || "adg-backup-password",
      encrypted_archive: archive.fileName,
      encrypted_bytes: archive.sizeBytes,
      encrypted_sha256: archive.sha256,
      round_trip_verified: true
    };
  }
  const chunkDescriptors = normalizedChunks.map((chunk, index) => ({
    index,
    sizeBytes: chunk.length,
    sha256: sha256HexBytes(chunk)
  }));
  const createBody = {
    schema: "adg.cpoly-postgres.backup.v1",
    metadata: manifest,
    archive,
    chunks: chunkDescriptors
  };
  return {
    chunks: normalizedChunks,
    manifest,
    archive,
    descriptorSha256: sha256HexBytes(
      bytes(JSON.stringify({
        schema: "adg.cpoly-postgres.backup.v1",
        manifest,
        metadata: manifest,
        archive,
        chunks: chunkDescriptors
      }))
    ),
    manifestSha256: sha256HexBytes(bytes(JSON.stringify(manifest))),
    createBody,
    completeBody: {
      schema: "adg.cpoly-postgres.backup.v1",
      chunkCount: archive.chunkCount,
      totalBytes: archive.sizeBytes,
      sha256: archive.sha256
    }
  };
}

function binaryFixtureChunks(chunkSize) {
  return splitChunks(BINARY_FIXTURE, chunkSize);
}

function openPgpFixtureChunks(chunkSize) {
  return splitChunks(OPENPGP_FIXTURE, chunkSize);
}

function splitChunks(bytesValue, chunkSize) {
  const values = [];
  for (let offset = 0; offset < bytesValue.length; offset += chunkSize) {
    values.push(bytesValue.slice(offset, offset + chunkSize));
  }
  return values;
}

function concatenate(chunks) {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const value = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.length;
  }
  return value;
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return bytes(value);
}

function materializeKvRead(value, type) {
  const bytesValue = normalizeBytes(value);
  if (type === "arrayBuffer" || type?.type === "arrayBuffer") {
    return bytesValue.buffer.slice(
      bytesValue.byteOffset,
      bytesValue.byteOffset + bytesValue.byteLength
    );
  }
  return new TextDecoder().decode(bytesValue);
}

function mutateBytes(value) {
  const copy = Uint8Array.from(normalizeBytes(value));
  copy[copy.length - 1] ^= 0x01;
  return copy;
}

async function signedRequest(pathValue, {
  method = "GET",
  body = new Uint8Array(0),
  secret,
  nonce = crypto.randomUUID(),
  timestamp = Date.now()
} = {}) {
  const bodyBytes = normalizeBytes(body);
  const bodyHash = sha256HexBytes(bodyBytes);
  const canonical = buildCpolyCanonicalText(
    method,
    pathValue,
    timestamp,
    nonce,
    bodyHash
  );
  const signature = await hmacSha256Hex(secret, canonical);
  return new Request(`https://adg-internal.test${pathValue}`, {
    method,
    headers: {
      "content-type": pathValue.endsWith("/complete")
        || pathValue === "/api/internal/cpoly-backups"
        ? "application/json"
        : "application/octet-stream",
      "x-adg-timestamp": String(timestamp),
      "x-adg-nonce": nonce,
      "x-adg-content-sha256": bodyHash,
      "x-adg-signature": signature
    },
    body: ["GET", "HEAD"].includes(method)
      ? undefined
      : Buffer.from(bodyBytes)
  });
}

function jsonBytes(value) {
  return bytes(JSON.stringify(value));
}

function bytes(value) {
  return new TextEncoder().encode(value);
}
