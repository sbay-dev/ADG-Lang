import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import {
  buildCpolyCanonicalText,
  sha256HexBytes
} from "../src/cpoly-recovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workRoot = path.join(__dirname, ".work-python-client");
const pythonClientPath = path.join(
  projectRoot,
  "infrastructure",
  "cpoly-postgres",
  "scripts",
  "d1_backup_client.py"
);
const postgresCustomFixture = Uint8Array.from([
  ...Buffer.from("PGDMP", "ascii"),
  ...Uint8Array.from({ length: 1536 }, (_, index) => (index * 31 + 7) % 251)
]);
const BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, EntityCrypt protected-column " +
  "attestations, separate role bootstrap handling, and the requested " +
  "restore test only. Off-host replication and recovery-time objectives " +
  "require separate scheduled operations."
);
const BACKUP_SCHEMA = "adg.cpoly-postgres.backup.v1";

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
      "migrations/0012_task_state_repository_receipts.sql",
      "migrations/0013_cpoly_journal_disposition.sql"
    ]) {
      this.database.exec(readFileSync(
        path.join(projectRoot, migrationPath),
        "utf8"
      ));
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
    this.hiddenReads = new Map();
    this.tamperedReads = new Map();
  }

  async put(name, value, options = {}) {
    const bytes = value instanceof Uint8Array
      ? Uint8Array.from(value)
      : new Uint8Array(value);
    this.entries.set(String(name), {
      bytes,
      metadata: options.metadata ?? null
    });
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
    this.entries.delete(String(name));
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

test("actual Python backup client uploads and downloads against the Worker contract", async () => {
  const db = new D1TestDatabase();
  const env = {
    DB: db,
    CPOLY_BACKUPS: new MemoryKvNamespace(),
    CPOLY_BACKUP_HMAC_KEY: "cpoly-backup-hmac-test-key-material-2026",
    CPOLY_BACKUP_MASTER_KEY: "cpoly-backup-master-key-test-2026"
  };
  mkdirSync(workRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(workRoot, "python-client-"));
  const archivePath = path.join(tempDir, "cpoly-postgres-backup.dump");
  const manifestBasePath = path.join(tempDir, "manifest-base.json");
  const restoreEvidencePath = path.join(tempDir, "restore-evidence.json");
  const baseUrlPath = path.join(tempDir, "base-url.txt");
  const keyPath = path.join(tempDir, "hmac-key.txt");
  const downloadPath = path.join(tempDir, "download.dump");
  const manifestOutputPath = path.join(tempDir, "download-manifest.json");
  writeFileSync(archivePath, Buffer.from(postgresCustomFixture));
  writeFileSync(baseUrlPath, "http://127.0.0.1:0\n", "utf8");
  writeFileSync(keyPath, `${env.CPOLY_BACKUP_HMAC_KEY}\n`, "utf8");
  const chunkDescriptors = splitChunks(postgresCustomFixture, 65536).map((chunk, index) => ({
    index,
    sizeBytes: chunk.length,
    sha256: sha256HexBytes(chunk)
  }));
  const archive = {
    database: "adg_adjudication",
    format: "postgres-custom",
    fileName: "cpoly-postgres-backup.dump",
    sizeBytes: postgresCustomFixture.length,
    sha256: sha256HexBytes(postgresCustomFixture),
    chunkCount: chunkDescriptors.length,
    chunkSizeBytes: Math.max(...chunkDescriptors.map(chunk => chunk.sizeBytes)),
    contentType: "application/octet-stream",
    encryptionFormat: "none"
  };
  const manifest = {
    schema: "cpoly_postgres_backup_v1",
    created_at_utc: "2026-08-14T12:00:00.000Z",
    source_container: "cpoly-postgres-statefulset",
    source_image: "postgres@sha256:test-fixture",
    server_version: "16.4",
    databases: [
      {
        oid: 16384,
        name: "adg_adjudication",
        bytes: 1024,
        dump: "database-16384.dump"
      }
    ],
    plaintext_file_hashes: [
      {
        name: "bootstrap-roles.sql",
        bytes: 32,
        sha256: sha256HexBytes(Buffer.from("bootstrap-roles-sql"))
      },
      {
        name: "database-16384.dump",
        bytes: 48,
        sha256: sha256HexBytes(Buffer.from("database-dump"))
      }
    ],
    attestations: {
      schema: "adg.cpoly-postgres.backup-attestations.v1",
      protected_columns_entitycrypt: true,
      role_password_material_excluded: true,
      bootstrap_roles_separate: true
    },
    restore_test: {
      requested: true,
      status: "PASS",
      databases: [
        {
          source_database: "adg_adjudication",
          target_database: "verify_16384",
          restored_bytes: 1024,
          status: "PASS"
        }
      ]
    },
    claim_boundary: BACKUP_CLAIM_BOUNDARY,
    snapshotGeneration: 3,
    postgresReceiptWatermark: 17
  };
  writeFileSync(manifestBasePath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(restoreEvidencePath, JSON.stringify(manifest.restore_test, null, 2), "utf8");

  const observedUserAgents = [];
  const server = createServer(async (request, response) => {
    try {
      const userAgent = String(request.headers["user-agent"] || "");
      observedUserAgents.push(userAgent);
      if (userAgent !== "adg-cpoly-postgres-backup/1.0") {
        response.statusCode = 403;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end("blocked client signature");
        return;
      }
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          headers.set(key, value.join(", "));
        } else if (value != null) {
          headers.set(key, value);
        }
      }
      const workerRequest = new Request(
        `http://127.0.0.1:${server.address().port}${request.url}`,
        {
          method: request.method,
          headers,
          body: ["GET", "HEAD"].includes(request.method)
            ? undefined
            : body
        }
      );
      const workerResponse = await worker.fetch(workerRequest, env);
      response.statusCode = workerResponse.status;
      workerResponse.headers.forEach((value, key) => {
        response.setHeader(key, value);
      });
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: error?.message || "server_error" }));
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(
    baseUrlPath,
    `http://127.0.0.1:${server.address().port}\n`,
    "utf8"
  );

  try {
    const upload = await runPythonClient([
      "upload",
      "--archive",
      archivePath,
      "--manifest-base",
      manifestBasePath,
      "--restore-evidence",
      restoreEvidencePath
    ], {
      ADG_BACKUP_BASE_URL_FILE: baseUrlPath,
      ADG_BACKUP_HMAC_KEY_FILE: keyPath,
      ADG_BACKUP_ALLOW_HTTP: "true",
      ADG_BACKUP_CHUNK_BYTES: "65536",
      ADG_BACKUP_MAX_TOTAL_BYTES: "4096",
      ADG_BACKUP_MAX_CHUNKS: "16"
    });
    assert.equal(upload.status, 0, upload.stderr);
    assert.match(upload.stdout, /BACKUP_COMPLETE id=/u);

    const download = await runPythonClient([
      "download",
      "--output",
      downloadPath,
      "--manifest-output",
      manifestOutputPath
    ], {
      ADG_BACKUP_BASE_URL_FILE: baseUrlPath,
      ADG_BACKUP_HMAC_KEY_FILE: keyPath,
      ADG_BACKUP_ALLOW_HTTP: "true",
      ADG_BACKUP_MAX_TOTAL_BYTES: "4096"
    });
    assert.equal(download.status, 0, download.stderr);
    assert.equal(
      sha256HexBytes(readFileSync(downloadPath)),
      archive.sha256
    );
    const downloadedManifest = JSON.parse(readFileSync(manifestOutputPath, "utf8"));
    assert.deepEqual(downloadedManifest.metadata, manifest);
    assert.deepEqual(downloadedManifest.archive, archive);
    assert.deepEqual(downloadedManifest.chunks, chunkDescriptors);
    assert.ok(observedUserAgents.length > 0);
    assert.deepEqual(
      [...new Set(observedUserAgents)],
      ["adg-cpoly-postgres-backup/1.0"]
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.database.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (existsSync(workRoot)) {
      try {
        rmSync(workRoot, { recursive: false });
      } catch {
        // another test may still be using the directory
      }
    }
  }
});

test("actual Python restore client falls back to the prior complete generation when newest KV chunks are not yet readable", async () => {
  const db = new D1TestDatabase();
  const store = new MemoryKvNamespace();
  const env = {
    DB: db,
    CPOLY_BACKUPS: store,
    CPOLY_BACKUP_HMAC_KEY: "cpoly-backup-hmac-test-key-material-2026",
    CPOLY_BACKUP_MASTER_KEY: "cpoly-backup-master-key-test-2026",
    CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS: "60000"
  };
  mkdirSync(workRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(workRoot, "python-client-fallback-"));
  const baseUrlPath = path.join(tempDir, "base-url.txt");
  const keyPath = path.join(tempDir, "hmac-key.txt");
  const downloadPath = path.join(tempDir, "download.dump");
  const manifestOutputPath = path.join(tempDir, "download-manifest.json");
  writeFileSync(baseUrlPath, "http://127.0.0.1:0\n", "utf8");
  writeFileSync(keyPath, `${env.CPOLY_BACKUP_HMAC_KEY}\n`, "utf8");

  const latestFixture = Uint8Array.from([
    ...Buffer.from("PGDMP", "ascii"),
    ...Uint8Array.from({ length: 1536 }, (_, index) => (index * 17 + 13) % 251)
  ]);
  const priorManifest = buildManifest({
    createdAtUtc: "2026-08-14T12:00:00.000Z",
    snapshotGeneration: 3,
    postgresReceiptWatermark: 17
  });
  const latestManifest = buildManifest({
    createdAtUtc: "2026-08-14T12:05:00.000Z",
    snapshotGeneration: 4,
    postgresReceiptWatermark: 23
  });
  const priorBackup = await createBackupDirect(env, {
    fixture: postgresCustomFixture,
    manifest: priorManifest,
    fileName: "cpoly-postgres-prior.dump"
  });
  const latestBackup = await createBackupDirect(env, {
    fixture: latestFixture,
    manifest: latestManifest,
    fileName: "cpoly-postgres-latest.dump"
  });
  const latestKeys = db.database.prepare(
    `SELECT kv_key
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ?
      ORDER BY chunk_index`
  ).all(latestBackup.backupId).map(row => row.kv_key);
  for (const key of latestKeys) {
    store.delayVisibility(key, 4);
  }

  const server = createWorkerBridgeServer(env);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(
    baseUrlPath,
    `http://127.0.0.1:${server.address().port}\n`,
    "utf8"
  );

  try {
    const download = await runPythonClient([
      "download",
      "--output",
      downloadPath,
      "--manifest-output",
      manifestOutputPath
    ], {
      ADG_BACKUP_BASE_URL_FILE: baseUrlPath,
      ADG_BACKUP_HMAC_KEY_FILE: keyPath,
      ADG_BACKUP_ALLOW_HTTP: "true",
      ADG_BACKUP_MAX_TOTAL_BYTES: "4096",
      ADG_BACKUP_FETCH_RETRY_ATTEMPTS: "2",
      ADG_BACKUP_FETCH_RETRY_DELAY_MS: "100"
    });
    assert.equal(download.status, 0, download.stderr);
    assert.equal(
      sha256HexBytes(readFileSync(downloadPath)),
      priorBackup.archive.sha256
    );
    const downloadedManifest = JSON.parse(readFileSync(manifestOutputPath, "utf8"));
    assert.equal(downloadedManifest.backupId, priorBackup.backupId);
    assert.deepEqual(downloadedManifest.archive, priorBackup.archive);
    assert.deepEqual(downloadedManifest.metadata, priorManifest);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.database.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (existsSync(workRoot)) {
      try {
        rmSync(workRoot, { recursive: false });
      } catch {
        // another test may still be using the directory
      }
    }
  }
});

function splitChunks(bytes, chunkSize) {
  const values = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    values.push(bytes.slice(offset, offset + chunkSize));
  }
  return values;
}

function buildManifest({
  createdAtUtc,
  snapshotGeneration,
  postgresReceiptWatermark
}) {
  return {
    schema: "cpoly_postgres_backup_v1",
    created_at_utc: createdAtUtc,
    source_container: "cpoly-postgres-statefulset",
    source_image: "postgres@sha256:test-fixture",
    server_version: "16.4",
    databases: [
      {
        oid: 16384,
        name: "adg_adjudication",
        bytes: 1024,
        dump: "database-16384.dump"
      }
    ],
    plaintext_file_hashes: [
      {
        name: "bootstrap-roles.sql",
        bytes: 32,
        sha256: sha256HexBytes(Buffer.from("bootstrap-roles-sql"))
      },
      {
        name: "database-16384.dump",
        bytes: 48,
        sha256: sha256HexBytes(Buffer.from("database-dump"))
      }
    ],
    attestations: {
      schema: "adg.cpoly-postgres.backup-attestations.v1",
      protected_columns_entitycrypt: true,
      role_password_material_excluded: true,
      bootstrap_roles_separate: true
    },
    restore_test: {
      requested: true,
      status: "PASS",
      databases: [
        {
          source_database: "adg_adjudication",
          target_database: "verify_16384",
          restored_bytes: 1024,
          status: "PASS"
        }
      ]
    },
    claim_boundary: BACKUP_CLAIM_BOUNDARY,
    snapshotGeneration,
    postgresReceiptWatermark
  };
}

async function createBackupDirect(env, {
  fixture,
  manifest,
  fileName,
  chunkSize = 65536
}) {
  const chunks = splitChunks(fixture, chunkSize).map((chunk, index) => ({
    index,
    sizeBytes: chunk.length,
    sha256: sha256HexBytes(chunk)
  }));
  const archive = {
    database: "adg_adjudication",
    format: "postgres-custom",
    fileName,
    sizeBytes: fixture.length,
    sha256: sha256HexBytes(fixture),
    chunkCount: chunks.length,
    chunkSizeBytes: Math.max(...chunks.map(chunk => chunk.sizeBytes)),
    contentType: "application/octet-stream",
    encryptionFormat: "none"
  };
  const createBody = {
    schema: BACKUP_SCHEMA,
    retentionHours: 168,
    metadata: manifest,
    archive,
    chunks
  };
  const createResponse = await worker.fetch(
    await signedWorkerRequest(
      "/api/internal/cpoly-backups",
      env.CPOLY_BACKUP_HMAC_KEY,
      "POST",
      canonicalJsonBytes(createBody),
      "application/json"
    ),
    env
  );
  assert.ok([200, 201].includes(createResponse.status));
  const createPayload = await createResponse.json();
  const backupId = createPayload.backup.backupId;

  for (const descriptor of chunks) {
    const uploadResponse = await worker.fetch(
      await signedWorkerRequest(
        `/api/internal/cpoly-backups/${backupId}/chunks/${descriptor.index}`,
        env.CPOLY_BACKUP_HMAC_KEY,
        "PUT",
        fixture.slice(
          descriptor.index * chunkSize,
          descriptor.index * chunkSize + descriptor.sizeBytes
        ),
        "application/octet-stream"
      ),
      env
    );
    assert.equal(uploadResponse.status, 200);
  }

  const completeResponse = await worker.fetch(
    await signedWorkerRequest(
      `/api/internal/cpoly-backups/${backupId}/complete`,
      env.CPOLY_BACKUP_HMAC_KEY,
      "POST",
      canonicalJsonBytes({
        schema: BACKUP_SCHEMA,
        backupId,
        chunkCount: archive.chunkCount,
        totalBytes: archive.sizeBytes,
        sha256: archive.sha256
      }),
      "application/json"
    ),
    env
  );
  assert.equal(completeResponse.status, 200);
  return { backupId, archive, chunks, manifest };
}

function createWorkerBridgeServer(env) {
  return createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          headers.set(key, value.join(", "));
        } else if (value != null) {
          headers.set(key, value);
        }
      }
      const workerRequest = new Request(
        `http://127.0.0.1:${request.socket.localPort}${request.url}`,
        {
          method: request.method,
          headers,
          body: ["GET", "HEAD"].includes(request.method)
            ? undefined
            : body
        }
      );
      const workerResponse = await worker.fetch(workerRequest, env);
      response.statusCode = workerResponse.status;
      workerResponse.headers.forEach((value, key) => {
        response.setHeader(key, value);
      });
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: error?.message || "server_error" }));
    }
  });
}

function canonicalJsonBytes(value) {
  return Buffer.from(JSON.stringify(value));
}

async function signedWorkerRequest(pathValue, secret, method, body, contentType) {
  const bodyBytes = normalizeBytes(body);
  const bodyHash = sha256HexBytes(bodyBytes);
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const canonical = buildCpolyCanonicalText(
    method,
    pathValue,
    timestamp,
    nonce,
    bodyHash
  );
  const signature = createHmac("sha256", secret)
    .update(canonical)
    .digest("hex");
  return new Request(`https://adg-internal.test${pathValue}`, {
    method,
    headers: {
      "content-type": contentType,
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

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new TextEncoder().encode(String(value));
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

async function runPythonClient(args, extraEnv) {
  const candidates = [
    ["python", [pythonClientPath, ...args]],
    ["py", ["-3", pythonClientPath, ...args]]
  ];
  let lastFailure = null;
  for (const [command, commandArgs] of candidates) {
    try {
      return await runProcess(command, commandArgs, extraEnv);
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure ?? new Error("Python runtime is unavailable.");
}

function runProcess(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", status => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}
