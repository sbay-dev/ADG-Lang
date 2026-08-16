import { createHash } from "node:crypto";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/u;
const ENVELOPE_VERSION = 1;
const BACKUP_DESCRIPTOR_SCHEMA = "adg.cpoly-postgres.backup.v1";
const BACKUP_CREATE_SCHEMA = BACKUP_DESCRIPTOR_SCHEMA;
const BACKUP_COMPLETE_SCHEMA = BACKUP_DESCRIPTOR_SCHEMA;
const RECOVERY_BEGIN_SCHEMA = "adg-cpoly-recovery-begin-v1";
const RECOVERY_COMPLETE_SCHEMA = "adg-cpoly-recovery-complete-v1";
const CPOLY_POSTGRES_BACKUP_MANIFEST_SCHEMA = "cpoly_postgres_backup_v1";
const CPOLY_POSTGRES_ENCRYPTED_BUNDLE_SCHEMA =
  "adg.cpoly-postgres.encrypted-bundle.v1";
const CPOLY_POSTGRES_BACKUP_ATTESTATIONS_SCHEMA =
  "adg.cpoly-postgres.backup-attestations.v1";
const CPOLY_POSTGRES_BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, EntityCrypt protected-column " +
  "attestations, separate role bootstrap handling, and the requested " +
  "restore test only. Off-host replication and recovery-time objectives " +
  "require separate scheduled operations."
);
const LEGACY_CPOLY_POSTGRES_BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, encryption, and the requested restore " +
  "test only. Off-host replication and recovery-time objectives require " +
  "separate scheduled operations."
);
const CPOLY_POSTGRES_SNAPSHOT_SCHEMA = "adg-cpoly-postgres-snapshot-v1";
const CPOLY_POSTGRES_BACKUP_ENCRYPTION_STATUS =
  "PASS_AES256_GPG_SYMMETRIC";
const CPOLY_POSTGRES_BACKUP_ENCRYPTION_FORMAT =
  "openpgp-symmetric-aes256";
const CPOLY_POSTGRES_BACKUP_UNENCRYPTED_FORMAT = "none";
const DEFAULT_BACKUP_ARCHIVE_CONTENT_TYPE = "application/octet-stream";
const MAX_BACKUP_DESCRIPTOR_JSON_BYTES = 262144;
const JOURNAL_SCHEMA = "adg-cpoly-postgres-journal-v1";
const CPOLY_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const BACKUP_CHUNK_KEY_PREFIX = "cpoly-backups/v1";
const DEFAULT_BACKUP_RETENTION_HOURS = 24 * 7;
const DEFAULT_STALE_UPLOAD_HOURS = 12;
const DEFAULT_MAX_CHUNK_BYTES = 524288;
const HARD_MAX_CHUNK_BYTES = 524288;
const DEFAULT_MAX_BACKUP_BYTES = 33554432;
const DEFAULT_MAX_BACKUP_CHUNKS = 512;
const DEFAULT_MAX_RETAINED_BACKUPS = 7;
const DEFAULT_MAX_RETAINED_BYTES = 67108864;
const DEFAULT_BACKUP_RESTORE_LEASE_MS = 30 * 60 * 1000;
const DEFAULT_KV_PROPAGATION_DELAY_MS = 60 * 1000;
const DEFAULT_RECOVERY_LEASE_MS = 60 * 60 * 1000;
const DEFAULT_NONCE_PRUNE_LIMIT = 200;
const DEFAULT_JOURNAL_REPLAY_LIMIT = 24;
const DEFAULT_JOURNAL_CLEANUP_LIMIT = 64;
const DEFAULT_JOURNAL_MAX_CIPHERTEXT_BYTES = 1572864;
const MAX_JSON_BODY_BYTES = MAX_BACKUP_DESCRIPTOR_JSON_BYTES;

export function getRecoveryDatabase(env) {
  if (env?.RECOVERY_DB && typeof env.RECOVERY_DB.prepare === "function") {
    return env.RECOVERY_DB;
  }
  if (env?.DB
      && !env.DB.__isPostgresD1Database
      && typeof env.DB.prepare === "function") {
    return env.DB;
  }
  return null;
}

export function getBackupObjectStore(env) {
  const store = env?.CPOLY_BACKUPS;
  if (!store
      || typeof store.get !== "function"
      || typeof store.put !== "function"
      || typeof store.delete !== "function") {
    return null;
  }
  return store;
}

export function buildCpolyCanonicalText(
  method,
  path,
  timestamp,
  nonce,
  bodyHash
) {
  return [
    String(method || "GET").toUpperCase(),
    String(path || ""),
    String(timestamp || ""),
    String(nonce || ""),
    String(bodyHash || "")
  ].join("\n");
}

export function cpolyBackupConfigured(env) {
  return Boolean(
    getRecoveryDatabase(env)
    && getBackupObjectStore(env)
    && String(env?.CPOLY_BACKUP_HMAC_KEY || "").trim()
  );
}

export async function routeCpolyBackupRequest(request, env, url) {
  if (!url.pathname.startsWith("/api/internal/cpoly-backups")
      && !url.pathname.startsWith("/api/internal/cpoly-recovery")) {
    return null;
  }
  try {
    if (!cpolyBackupConfigured(env)) {
      throw new RecoveryRouteError(
        "CPOLY recovery backup lane is not configured.",
        503
      );
    }
    const rawBody = await readInternalRequestBody(request, url, env);
    await verifySignedCpolyRequest(
      request,
      rawBody,
      env,
      url.pathname + url.search
    );
    if (url.pathname === "/api/internal/cpoly-recovery/status"
        && request.method === "GET") {
      return await fetchRecoveryStatus(env);
    }
    if (url.pathname === "/api/internal/cpoly-recovery/begin"
        && request.method === "POST") {
      return await beginRecovery(rawBody, env);
    }
    if (url.pathname === "/api/internal/cpoly-recovery/complete"
        && request.method === "POST") {
      return await completeRecovery(rawBody, env);
    }
    if (url.pathname === "/api/internal/cpoly-backups"
        && request.method === "POST") {
      return await createBackupSet(rawBody, env);
    }
    if (url.pathname === "/api/internal/cpoly-backups/latest"
        && request.method === "GET") {
      return await fetchLatestBackup(env);
    }
    const chunkMatch = url.pathname.match(
      /^\/api\/internal\/cpoly-backups\/([0-9a-f-]{36})\/chunks\/(\d+)$/iu
    );
    if (chunkMatch?.[1] && chunkMatch?.[2]) {
      const backupId = chunkMatch[1].toLowerCase();
      const chunkIndex = parseChunkIndex(chunkMatch[2]);
      if (request.method === "PUT") {
        return await uploadBackupChunk(backupId, chunkIndex, rawBody, env);
      }
      if (request.method === "GET") {
        return await fetchBackupChunk(backupId, chunkIndex, env);
      }
    }
    const completeMatch = url.pathname.match(
      /^\/api\/internal\/cpoly-backups\/([0-9a-f-]{36})\/complete$/iu
    );
    if (completeMatch?.[1] && request.method === "POST") {
      return await completeBackupSet(
        completeMatch[1].toLowerCase(),
        rawBody,
        env
      );
    }
    return recoveryJson({ message: "Not found." }, 404);
  } catch (error) {
    if (error instanceof RecoveryRouteError) {
      return recoveryJson({ message: error.message }, error.status);
    }
    throw error;
  }
}

export async function processCpolyRecoveryMaintenance(env) {
  const recoveryDb = getRecoveryDatabase(env);
  if (!recoveryDb) return;
  const now = Date.now();
  try {
    await pruneSignedNonces(recoveryDb, now, noncePruneLimit(env));
  } catch (error) {
    console.error("CPOLY recovery nonce cleanup failed", {
      message: error?.message
    });
  }
  const recoveryRuntime = await getCpolyRecoveryRuntime(env);
  let latestVerifiedSnapshot = null;
  try {
    latestVerifiedSnapshot = await pruneExpiredBackups(
      env,
      now,
      recoveryRuntime
    );
  } catch (error) {
    console.error("CPOLY recovery backup cleanup failed", {
      message: error?.message
    });
  }
  if (recoveryRuntime.state === "recovering") {
    return;
  }
  if (env?.DB?.__isPostgresD1Database) {
    try {
      await env.DB.replayRecoveryJournal({
        limit: journalReplayLimit(env)
      });
    } catch (error) {
      console.error("CPOLY recovery journal replay failed", {
        message: error?.message
      });
    }
    if (latestVerifiedSnapshot) {
      try {
        await env.DB.cleanupRecoveryJournal({
          verifiedSnapshot: latestVerifiedSnapshot,
          limit: journalCleanupLimit(env)
        });
      } catch (error) {
        console.error("CPOLY recovery journal cleanup failed", {
          message: error?.message
        });
      }
    }
  }
}

export async function getCpolyRecoveryRuntime(env) {
  const recoveryDb = getRecoveryDatabase(env);
  if (!recoveryDb) {
    return {
      state: "ready",
      readyGeneration: 1,
      targetGeneration: null,
      recoveryId: null,
      restoreBackupId: null,
      restoreSnapshotGeneration: null,
      restoreSnapshotWatermark: null,
      restoreLeaseExpiresAt: null,
      startedAt: null,
      updatedAt: 0,
      completedAt: null,
      lastError: null
    };
  }
  const row = await recoveryDb.prepare(
    `SELECT slot, state, ready_generation, target_generation, recovery_id,
            restore_backup_id, restore_snapshot_generation,
            restore_snapshot_watermark, restore_lease_expires_at,
            started_at, updated_at, completed_at, last_error
       FROM cpoly_recovery_runtime
      WHERE slot = 'global'`
  ).first();
  if (!row) {
    throw new Error("CPOLY recovery runtime state is missing.");
  }
  return {
    state: String(row.state),
    readyGeneration: Number(row.ready_generation || 1),
    targetGeneration: row.target_generation == null
      ? null
      : Number(row.target_generation),
    recoveryId: row.recovery_id == null ? null : String(row.recovery_id),
    restoreBackupId: row.restore_backup_id == null
      ? null
      : String(row.restore_backup_id),
    restoreSnapshotGeneration: row.restore_snapshot_generation == null
      ? null
      : Number(row.restore_snapshot_generation),
    restoreSnapshotWatermark: row.restore_snapshot_watermark == null
      ? null
      : Number(row.restore_snapshot_watermark),
    restoreLeaseExpiresAt: row.restore_lease_expires_at == null
      ? null
      : Number(row.restore_lease_expires_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    updatedAt: Number(row.updated_at || 0),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    lastError: row.last_error == null ? null : String(row.last_error)
  };
}

export async function pruneExpiredBackups(
  env,
  now = Date.now(),
  recoveryRuntime = null
) {
  const db = getRecoveryDatabase(env);
  if (!db) return null;
  const runtime = recoveryRuntime ?? await getCpolyRecoveryRuntime(env);
  const keepCount = maxRetainedBackups(env);
  const keepBytesCap = maxRetainedBytes(env);
  const completeRows = ((await db.prepare(
    `SELECT id, total_size_bytes, expires_at, created_at,
            snapshot_generation, snapshot_watermark, verified_at,
            restore_lease_expires_at
       FROM cpoly_backup_sets
      WHERE status = 'complete'
        AND snapshot_generation IS NOT NULL
        AND snapshot_watermark IS NOT NULL
        AND verified_at IS NOT NULL
      ORDER BY snapshot_generation DESC,
               snapshot_watermark DESC,
               verified_at DESC,
               created_at DESC`
  ).all()).results || []).map(row => ({
    id: String(row.id),
    totalSizeBytes: Number(row.total_size_bytes || 0),
    expiresAt: Number(row.expires_at || 0),
    snapshotGeneration: Number(row.snapshot_generation || 0),
    snapshotWatermark: Number(row.snapshot_watermark || 0),
    verifiedAt: Number(row.verified_at || 0),
    restoreLeaseExpiresAt: row.restore_lease_expires_at == null
      ? null
      : Number(row.restore_lease_expires_at)
  }));
  const keepIds = new Set();
  let retainedBytes = 0;
  for (const row of completeRows) {
    const leased = row.restoreLeaseExpiresAt != null
      && row.restoreLeaseExpiresAt > now;
    const activeRecovery = runtime.state === "recovering"
      && runtime.restoreBackupId === row.id;
    if (leased || activeRecovery) {
      keepIds.add(row.id);
      retainedBytes += row.totalSizeBytes;
      continue;
    }
    if (row.expiresAt <= now) continue;
    if (keepIds.size >= keepCount) continue;
    if (retainedBytes + row.totalSizeBytes > keepBytesCap) continue;
    keepIds.add(row.id);
    retainedBytes += row.totalSizeBytes;
  }
  const deleteIds = completeRows
    .filter(row => !keepIds.has(row.id))
    .map(row => row.id);
  const staleUploadBefore = now - staleUploadHours(env) * 60 * 60 * 1000;
  const staleRows = ((await db.prepare(
    `SELECT id
       FROM cpoly_backup_sets
      WHERE status <> 'complete'
        AND created_at <= ?`
  ).bind(staleUploadBefore).all()).results || []).map(row => String(row.id));
  const staleDeleteIds = staleRows.filter(id => !deleteIds.includes(id));
  if (deleteIds.length) {
    await db.batch(deleteIds.map(id => db.prepare(
      `UPDATE cpoly_backup_sets
          SET status = 'expired',
              completed_at = NULL,
              updated_at = ?
        WHERE id = ?
          AND status = 'complete'`
    ).bind(now, id)));
  }
  if (staleDeleteIds.length) {
    await db.batch(staleDeleteIds.map(id => db.prepare(
      `UPDATE cpoly_backup_sets
          SET status = 'failed', updated_at = ?
        WHERE id = ?
          AND status = 'uploading'`
    ).bind(now, id)));
  }
  const pendingDeleteIds = [...deleteIds, ...staleDeleteIds];
  const confirmedDeletes = [];
  for (const backupId of pendingDeleteIds) {
    if (await deleteBackupObjectsBestEffort(env, db, backupId)) {
      confirmedDeletes.push(backupId);
    }
  }
  if (confirmedDeletes.length) {
    await db.batch(confirmedDeletes.map(id => db.prepare(
      `DELETE FROM cpoly_backup_sets WHERE id = ?`
    ).bind(id)));
  }
  const latestKept = completeRows.find(row => keepIds.has(row.id));
  return latestKept
    ? {
        backupId: latestKept.id,
        generation: latestKept.snapshotGeneration,
        watermark: latestKept.snapshotWatermark
      }
    : null;
}

export async function pruneSignedNonces(
  db,
  now = Date.now(),
  limit = DEFAULT_NONCE_PRUNE_LIMIT
) {
  await db.prepare(
    `DELETE FROM cpoly_signed_api_nonces
      WHERE nonce IN (
        SELECT nonce
          FROM cpoly_signed_api_nonces
         WHERE expires_at <= ?
         ORDER BY expires_at
         LIMIT ?
      )`
  ).bind(now, limit).run();
}

export async function insertPendingJournalEntry(
  recoveryDb,
  record,
  now = Date.now()
) {
  await recoveryDb.prepare(
    `INSERT INTO cpoly_pg_write_journal
      (request_id, payload_hash, operation_kind, statement_count,
       status, ciphertext, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, 0, NULL, ?, ?)`
  ).bind(
    record.requestId,
    record.payloadHash,
    record.operationKind,
    record.statementCount,
    record.ciphertext,
    now,
    now
  ).run();
}

export async function markJournalApplied(
  recoveryDb,
  requestId,
  options = {}
) {
  const settings = typeof options === "number"
    ? { appliedAt: options }
    : options;
  const appliedAt = Number(settings.appliedAt ?? Date.now());
  const postgresGeneration = settings.postgresGeneration == null
    ? null
    : Number(settings.postgresGeneration);
  const postgresReceiptSeq = settings.postgresReceiptSeq == null
    ? null
    : Number(settings.postgresReceiptSeq);
  await recoveryDb.prepare(
    `UPDATE cpoly_pg_write_journal
        SET status = 'applied',
            attempts = attempts + 1,
            last_error = NULL,
            updated_at = ?,
            applied_at = COALESCE(applied_at, ?),
            postgres_generation = COALESCE(?, postgres_generation),
            postgres_receipt_seq = COALESCE(?, postgres_receipt_seq)
      WHERE request_id = ?`
  ).bind(
    appliedAt,
    appliedAt,
    postgresGeneration,
    postgresReceiptSeq,
    requestId
  ).run();
}

export async function markJournalPending(
  recoveryDb,
  requestId,
  message,
  now = Date.now()
) {
  await recoveryDb.prepare(
    `UPDATE cpoly_pg_write_journal
        SET status = 'pending',
            attempts = attempts + 1,
            last_error = ?,
            updated_at = ?
      WHERE request_id = ?`
  ).bind(boundErrorMessage(message), now, requestId).run();
}

export async function markJournalFailed(
  recoveryDb,
  requestId,
  message,
  now = Date.now()
) {
  await recoveryDb.prepare(
    `UPDATE cpoly_pg_write_journal
        SET status = 'failed',
            attempts = attempts + 1,
            last_error = ?,
            updated_at = ?
      WHERE request_id = ?`
  ).bind(boundErrorMessage(message), now, requestId).run();
}

export async function loadRecoveryJournalCandidates(
  recoveryDb,
  limit
) {
  return ((await recoveryDb.prepare(
    `SELECT request_id, payload_hash, operation_kind, statement_count,
            status, ciphertext, attempts, created_at, updated_at, applied_at,
            postgres_generation, postgres_receipt_seq
       FROM cpoly_pg_write_journal
      WHERE status = 'pending'
         OR (
           status = 'applied'
           AND (
             postgres_generation IS NULL
             OR postgres_receipt_seq IS NULL
           )
         )
      ORDER BY created_at ASC
      LIMIT ?`
  ).bind(limit).all()).results || []).map(row => ({
    requestId: String(row.request_id),
    payloadHash: String(row.payload_hash),
    operationKind: String(row.operation_kind),
    statementCount: Number(row.statement_count || 0),
    status: String(row.status),
    ciphertext: normalizeBinaryValue(row.ciphertext),
    attempts: Number(row.attempts || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    appliedAt: row.applied_at == null ? null : Number(row.applied_at),
    postgresGeneration: row.postgres_generation == null
      ? null
      : Number(row.postgres_generation),
    postgresReceiptSeq: row.postgres_receipt_seq == null
      ? null
      : Number(row.postgres_receipt_seq)
  }));
}

export async function cleanupAppliedRecoveryJournal(
  recoveryDb,
  {
    verifiedSnapshot = null,
    limit = DEFAULT_JOURNAL_CLEANUP_LIMIT
  } = {}
) {
  if (!verifiedSnapshot) return 0;
  const deleteIds = [];
  const applied = (await recoveryDb.prepare(
    `SELECT request_id
       FROM cpoly_pg_write_journal
      WHERE status = 'applied'
        AND postgres_receipt_seq IS NOT NULL
        AND postgres_generation IS NOT NULL
        AND (
          postgres_generation < ?
          OR (
            postgres_generation = ?
            AND postgres_receipt_seq <= ?
          )
        )
      ORDER BY postgres_generation ASC,
               postgres_receipt_seq ASC,
               created_at ASC
      LIMIT ?`
  ).bind(
    Number(verifiedSnapshot.generation),
    Number(verifiedSnapshot.generation),
    Number(verifiedSnapshot.watermark),
    limit
  ).all()).results || [];
  for (const row of applied) {
    deleteIds.push(String(row.request_id));
  }
  if (!deleteIds.length) return 0;
  await recoveryDb.batch(deleteIds.map(requestId => recoveryDb.prepare(
    `DELETE FROM cpoly_pg_write_journal WHERE request_id = ?`
  ).bind(requestId)));
  return deleteIds.length;
}

export async function loadRecoveryReplayBatch(
  recoveryDb,
  snapshotCoverage,
  targetGeneration,
  limit
) {
  return ((await recoveryDb.prepare(
    `SELECT request_id, payload_hash, operation_kind, statement_count,
            status, ciphertext, attempts, created_at, updated_at, applied_at,
            postgres_generation, postgres_receipt_seq
       FROM cpoly_pg_write_journal
      WHERE status = 'pending'
         OR (
           status = 'applied'
           AND (
             postgres_generation IS NULL
             OR postgres_receipt_seq IS NULL
             OR (
               postgres_generation < ?
               AND (
                 postgres_generation > ?
                 OR (
                   postgres_generation = ?
                   AND postgres_receipt_seq > ?
                 )
               )
             )
           )
         )
      ORDER BY created_at ASC
      LIMIT ?`
  ).bind(
    Number(targetGeneration),
    Number(snapshotCoverage.generation),
    Number(snapshotCoverage.generation),
    Number(snapshotCoverage.watermark),
    limit
  ).all()).results || []).map(row => ({
    requestId: String(row.request_id),
    payloadHash: String(row.payload_hash),
    operationKind: String(row.operation_kind),
    statementCount: Number(row.statement_count || 0),
    status: String(row.status),
    ciphertext: normalizeBinaryValue(row.ciphertext),
    attempts: Number(row.attempts || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    appliedAt: row.applied_at == null ? null : Number(row.applied_at),
    postgresGeneration: row.postgres_generation == null
      ? null
      : Number(row.postgres_generation),
    postgresReceiptSeq: row.postgres_receipt_seq == null
      ? null
      : Number(row.postgres_receipt_seq)
  }));
}

export async function countRecoveryReplayPending(
  recoveryDb,
  snapshotCoverage,
  targetGeneration
) {
  const row = await recoveryDb.prepare(
    `SELECT COUNT(*) AS count
       FROM cpoly_pg_write_journal
      WHERE status = 'pending'
         OR status = 'failed'
         OR (
           status = 'applied'
           AND (
             postgres_generation IS NULL
             OR postgres_receipt_seq IS NULL
             OR (
               postgres_generation < ?
               AND (
                 postgres_generation > ?
                 OR (
                   postgres_generation = ?
                   AND postgres_receipt_seq > ?
                 )
               )
             )
           )
         )`
  ).bind(
    Number(targetGeneration),
    Number(snapshotCoverage.generation),
    Number(snapshotCoverage.generation),
    Number(snapshotCoverage.watermark)
  ).first();
  return Number(row?.count || 0);
}

export function buildJournalPayload({
  requestId,
  operationKind,
  operations
}) {
  const payload = {
    schema: JOURNAL_SCHEMA,
    requestId: String(requestId),
    operationKind: String(operationKind),
    operations: operations.map(operation => ({
      mode: String(operation.mode || "run"),
      sql: String(operation.sql || ""),
      params: (Array.isArray(operation.params) ? operation.params : [])
        .map(serializeJournalValue)
    }))
  };
  const json = JSON.stringify(payload);
  return {
    json,
    hash: sha256HexUtf8(json),
    statementCount: payload.operations.length
  };
}

export function parseJournalPayload(json, expectedRequestId = null) {
  let payload;
  try {
    payload = JSON.parse(String(json || ""));
  } catch {
    throw new Error("Stored PostgreSQL journal payload is not valid JSON.");
  }
  if (!payload
      || payload.schema !== JOURNAL_SCHEMA
      || !UUID_V4_PATTERN.test(String(payload.requestId || ""))
      || !["run", "batch"].includes(String(payload.operationKind || ""))
      || !Array.isArray(payload.operations)
      || payload.operations.length < 1) {
    throw new Error("Stored PostgreSQL journal payload is invalid.");
  }
  if (expectedRequestId && payload.requestId !== expectedRequestId) {
    throw new Error("Stored PostgreSQL journal request ID did not match.");
  }
  return {
    requestId: payload.requestId,
    operationKind: payload.operationKind,
    operations: payload.operations.map(operation => ({
      mode: String(operation.mode || "run"),
      sql: String(operation.sql || ""),
      params: (Array.isArray(operation.params) ? operation.params : [])
        .map(deserializeJournalValue)
    }))
  };
}

export async function encryptRecoveryString(text, masterKey, purpose) {
  return encryptRecoveryBytes(
    new TextEncoder().encode(String(text || "")),
    masterKey,
    purpose
  );
}

export async function decryptRecoveryString(ciphertext, masterKey, purpose) {
  const bytes = await decryptRecoveryBytes(ciphertext, masterKey, purpose);
  return new TextDecoder().decode(bytes);
}

export async function encryptRecoveryBytes(plainBytes, masterKey, purpose) {
  const aesKey = await deriveRecoveryKey(masterKey, purpose, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    normalizeBinaryValue(plainBytes)
  ));
  const tag = encrypted.slice(encrypted.length - 16);
  const cipher = encrypted.slice(0, encrypted.length - 16);
  return concatBytes(new Uint8Array([ENVELOPE_VERSION]), nonce, tag, cipher);
}

export async function decryptRecoveryBytes(ciphertext, masterKey, purpose) {
  const normalized = normalizeBinaryValue(ciphertext);
  if (normalized.length < 1 + 12 + 16) {
    throw new Error("Recovery ciphertext length was invalid.");
  }
  if (normalized[0] !== ENVELOPE_VERSION) {
    throw new Error("Recovery ciphertext version was invalid.");
  }
  const nonce = normalized.slice(1, 13);
  const tag = normalized.slice(13, 29);
  const cipher = normalized.slice(29);
  const aesKey = await deriveRecoveryKey(masterKey, purpose, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    concatBytes(cipher, tag)
  );
  return new Uint8Array(plain);
}

export function sha256HexUtf8(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

export function sha256HexBytes(bytes) {
  return createHash("sha256").update(normalizeBinaryValue(bytes)).digest("hex");
}

export async function hmacSha256Hex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(text || ""))
  );
  return toHex(signature);
}

export function constantTimeHexEqual(left, right) {
  if (!SHA256_HEX_PATTERN.test(String(left || ""))
      || !SHA256_HEX_PATTERN.test(String(right || ""))) {
    return false;
  }
  const leftBytes = hexToBytes(left);
  const rightBytes = hexToBytes(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const max = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export function postgresJournalPurpose() {
  return "postgres-journal";
}

export function journalMaxCiphertextBytes(env) {
  return boundedInteger(
    env?.CPOLY_JOURNAL_MAX_CIPHERTEXT_BYTES,
    DEFAULT_JOURNAL_MAX_CIPHERTEXT_BYTES,
    65536,
    1800000
  );
}

export function normalizeBinaryValue(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    if (!value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error("Binary recovery value was invalid.");
    }
    return Uint8Array.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value == null) return new Uint8Array(0);
  throw new Error("Binary recovery value was invalid.");
}

function recoveryJson(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

function looksLikeOpenPgpCiphertext(bytes) {
  const value = normalizeBinaryValue(bytes);
  if (value.length < 4) return false;
  let offset = 0;
  let packets = 0;
  let sawSkesk = false;
  let sawEncryptedData = false;
  while (offset < value.length && packets < 32) {
    const packet = parseOpenPgpPacketHeader(value, offset, true);
    if (!packet) return false;
    packets += 1;
    if (packet.tag === 3) {
      sawSkesk = true;
    } else if (packet.tag === 18 || packet.tag === 20) {
      sawEncryptedData = true;
      if (sawSkesk) return true;
    }
    if (packet.partialBody) {
      return sawSkesk && sawEncryptedData;
    }
    offset = packet.nextOffset;
  }
  return sawSkesk && sawEncryptedData;
}

function parseOpenPgpPacketHeader(bytes, offset, allowTruncatedBody = false) {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if ((first & 0x80) === 0) return null;
  if ((first & 0x40) !== 0) {
    const tag = first & 0x3f;
    if (offset + 1 >= bytes.length) return null;
    const lengthOctet = bytes[offset + 1];
    let headerLength = 2;
    let bodyLength;
    if (lengthOctet < 192) {
      bodyLength = lengthOctet;
    } else if (lengthOctet < 224) {
      if (offset + 2 >= bytes.length) return null;
      bodyLength = ((lengthOctet - 192) << 8) + bytes[offset + 2] + 192;
      headerLength = 3;
    } else if (lengthOctet === 255) {
      if (offset + 5 >= bytes.length) return null;
      bodyLength =
        (bytes[offset + 2] * 0x1000000)
        + (bytes[offset + 3] << 16)
        + (bytes[offset + 4] << 8)
        + bytes[offset + 5];
      headerLength = 6;
    } else {
      return null;
    }
    const nextOffset = offset + headerLength + bodyLength;
    if (!Number.isSafeInteger(nextOffset) || bodyLength < 1) {
      return null;
    }
    if (nextOffset > bytes.length) {
      return allowTruncatedBody ? { tag, nextOffset, partialBody: true } : null;
    }
    return { tag, nextOffset, partialBody: false };
  }
  const tag = (first >> 2) & 0x0f;
  const lengthType = first & 0x03;
  let headerLength = 1;
  let bodyLength;
  if (lengthType === 0) {
    if (offset + 1 >= bytes.length) return null;
    bodyLength = bytes[offset + 1];
    headerLength = 2;
  } else if (lengthType === 1) {
    if (offset + 2 >= bytes.length) return null;
    bodyLength = (bytes[offset + 1] << 8) + bytes[offset + 2];
    headerLength = 3;
  } else if (lengthType === 2) {
    if (offset + 4 >= bytes.length) return null;
    bodyLength =
      (bytes[offset + 1] * 0x1000000)
      + (bytes[offset + 2] << 16)
      + (bytes[offset + 3] << 8)
      + bytes[offset + 4];
    headerLength = 5;
  } else {
    return null;
  }
  const nextOffset = offset + headerLength + bodyLength;
  if (!Number.isSafeInteger(nextOffset) || bodyLength < 1) {
    return null;
  }
  if (nextOffset > bytes.length) {
    return allowTruncatedBody ? { tag, nextOffset, partialBody: true } : null;
  }
  return { tag, nextOffset, partialBody: false };
}

function buildBackupResponse(backup, storedDescriptor = null, env = null) {
  const response = {
    backupId: backup.id,
    status: backup.status,
    createdAtUtc: new Date(Number(backup.created_at)).toISOString(),
    expiresAtUtc: new Date(Number(backup.expires_at)).toISOString(),
    chunkCount: Number(backup.chunk_count ?? backup.uploaded_chunks ?? 0),
    totalBytes: Number(backup.total_size_bytes ?? backup.uploaded_bytes ?? 0),
    sha256: backup.sha256 == null ? null : String(backup.sha256)
  };
  if (backup.completed_at != null) {
    response.completedAtUtc = new Date(Number(backup.completed_at))
      .toISOString();
    const availableAfter = backupAvailableAfterMs(backup, env);
    response.availableAfter = availableAfter;
    response.availableAfterUtc = new Date(availableAfter).toISOString();
  }
  if (!storedDescriptor) {
    return response;
  }
  response.schema = storedDescriptor.descriptor.schema;
  response.descriptorSha256 = storedDescriptor.descriptorSha256;
  response.metadataSha256 = storedDescriptor.metadataSha256;
  response.archive = storedDescriptor.descriptor.archive;
  response.chunks = storedDescriptor.descriptor.chunks;
  response.metadata = storedDescriptor.descriptor.metadata;
  response.manifest = storedDescriptor.descriptor.manifest;
  response.claimBoundary = storedDescriptor.descriptor.manifest.claim_boundary;
  response.snapshotGeneration = Number(
    backup.snapshot_generation
      ?? storedDescriptor.snapshotCoverage.generation
  );
  response.snapshotWatermark = Number(
    backup.snapshot_watermark
      ?? storedDescriptor.snapshotCoverage.watermark
  );
  return response;
}

function validateDescriptorCompleteBody(body, storedDescriptor, env) {
  if (body.backupId != null && String(body.backupId) !== String(body.urlBackupId)) {
    throw new RecoveryRouteError(
      "Backup ID in the completion body did not match the request path.",
      409
    );
  }
  if (body.descriptorSha256 != null) {
    const expected = normalizeSha256Hex(
      body.descriptorSha256,
      "descriptorSha256"
    );
    if (!constantTimeHexEqual(expected, storedDescriptor.descriptorSha256)) {
      throw new RecoveryRouteError(
        "Backup descriptor hash did not match the stored upload.",
        409
      );
    }
  }
  if (body.metadataSha256 != null) {
    const expected = normalizeSha256Hex(
      body.metadataSha256,
      "metadataSha256"
    );
    if (!constantTimeHexEqual(expected, storedDescriptor.metadataSha256)) {
      throw new RecoveryRouteError(
        "Backup metadata hash did not match the stored upload.",
        409
      );
    }
  }
  if (body.chunkCount != null
      && positiveInteger(
        body.chunkCount,
        "chunkCount",
        1,
        maxBackupChunks(env)
      ) !== storedDescriptor.descriptor.archive.chunkCount) {
    throw new RecoveryRouteError(
      "Backup chunk count did not match the stored descriptor.",
      409
    );
  }
  if (body.totalBytes != null
      && positiveInteger(
        body.totalBytes,
        "totalBytes",
        1,
        maxBackupBytes(env)
      ) !== storedDescriptor.descriptor.archive.sizeBytes) {
    throw new RecoveryRouteError(
      "Backup size did not match the stored descriptor.",
      409
    );
  }
  if (body.sha256 != null
      && !constantTimeHexEqual(
        normalizeSha256Hex(body.sha256, "sha256"),
        storedDescriptor.descriptor.archive.sha256
      )) {
    throw new RecoveryRouteError(
      "Backup SHA-256 did not match the stored descriptor.",
      409
    );
  }
  if (hasBackupDescriptorFields(body)) {
    const provided = parseRequestedBackupDescriptor(body, env);
    if (!constantTimeHexEqual(
      provided.descriptorSha256,
      storedDescriptor.descriptorSha256
    )) {
      throw new RecoveryRouteError(
        "Backup descriptor did not match the stored upload.",
        409
      );
    }
  }
  return {
    ...storedDescriptor.descriptor.archive,
    snapshotCoverage: storedDescriptor.snapshotCoverage
  };
}

function assertDescriptorChunkMatchesExpected(chunk, expected, failureMessage) {
  if (!expected
      || chunk.chunkIndex !== expected.index
      || chunk.plaintextSizeBytes !== expected.sizeBytes
      || chunk.plaintextSha256 !== expected.sha256) {
    throw new RecoveryRouteError(failureMessage, 409);
  }
}

async function createBackupSet(rawBody, env) {
  const body = parseRequiredJsonBody(rawBody, BACKUP_CREATE_SCHEMA);
  const requestedDescriptor = parseRequestedBackupDescriptor(body, env);
  const now = Date.now();
  const backupId = crypto.randomUUID();
  const retentionHours = requestedRetentionHours(body, env);
  const expiresAt = now + retentionHours * 60 * 60 * 1000;
  const db = getRecoveryDatabase(env);
  await db.prepare(
    `INSERT INTO cpoly_backup_sets
      (id, status, created_at, updated_at, expires_at,
       uploaded_bytes, uploaded_chunks, descriptor_json, descriptor_sha256,
       manifest_sha256, snapshot_generation, snapshot_watermark)
     VALUES (?, 'uploading', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`
  ).bind(
    backupId,
    now,
    now,
    expiresAt,
    requestedDescriptor.descriptorJson,
    requestedDescriptor.descriptorSha256,
    requestedDescriptor.metadataSha256,
    requestedDescriptor.snapshotCoverage.generation,
    requestedDescriptor.snapshotCoverage.watermark
  ).run();
  const backupResponse = {
    backupId,
    status: "uploading",
    createdAtUtc: new Date(now).toISOString(),
    expiresAtUtc: new Date(expiresAt).toISOString(),
    maxChunkBytes: maxChunkBytes(env),
    maxChunks: maxBackupChunks(env),
    maxBackupBytes: maxBackupBytes(env)
  };
  backupResponse.schema = requestedDescriptor.descriptor.schema;
  backupResponse.descriptorSha256 = requestedDescriptor.descriptorSha256;
  backupResponse.metadataSha256 = requestedDescriptor.metadataSha256;
  backupResponse.archive = requestedDescriptor.descriptor.archive;
  backupResponse.chunks = requestedDescriptor.descriptor.chunks;
  backupResponse.metadata = requestedDescriptor.descriptor.metadata;
  backupResponse.manifest = requestedDescriptor.descriptor.manifest;
  backupResponse.claimBoundary =
    requestedDescriptor.descriptor.manifest.claim_boundary;
  backupResponse.snapshotGeneration =
    requestedDescriptor.snapshotCoverage.generation;
  backupResponse.snapshotWatermark =
    requestedDescriptor.snapshotCoverage.watermark;
  return recoveryJson({
    ok: true,
    accepted: true,
    ...backupResponse,
    backup: backupResponse
  }, 201);
}

async function uploadBackupChunk(backupId, chunkIndex, rawBody, env) {
  if (!UUID_V4_PATTERN.test(backupId)) {
    throw new RecoveryRouteError("Backup ID is invalid.", 400);
  }
  if (!rawBody.length) {
    throw new RecoveryRouteError("Backup chunk body is empty.", 400);
  }
  const db = getRecoveryDatabase(env);
  const backup = await loadBackupSet(db, backupId);
  const storedDescriptor = parseStoredBackupDescriptor(backup);
  const now = Date.now();
  ensureUploadableBackup(backup, now);
  if (chunkIndex >= maxBackupChunks(env)) {
    throw new RecoveryRouteError(
      "Backup chunk index exceeded the configured cap.",
      413
    );
  }
  if (rawBody.length > maxChunkBytes(env)) {
    throw new RecoveryRouteError(
      "Backup chunk exceeded the configured cap.",
      413
    );
  }
  if (!getBackupObjectStore(env)) {
    throw new RecoveryRouteError("CPOLY backup object storage is unavailable.", 503);
  }
  const existing = await db.prepare(
    `SELECT kv_key, plaintext_sha256, plaintext_size_bytes
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = ?`
  ).bind(backupId, chunkIndex).first();
  const plaintextHash = sha256HexBytes(rawBody);
  if (existing) {
    if (Number(existing.plaintext_size_bytes) !== rawBody.length
        || String(existing.plaintext_sha256) !== plaintextHash) {
      throw new RecoveryRouteError("Backup chunk conflict was detected.", 409);
    }
    const kvKey = String(existing.kv_key || "");
    const existingBytes = await readBackupChunkFromStore(env, db, backupId, {
      chunkIndex,
      kvKey,
      plaintextSizeBytes: Number(existing.plaintext_size_bytes || 0),
      plaintextSha256: plaintextHash
    });
    if (existingBytes == null
        || existingBytes.length !== rawBody.length
        || sha256HexBytes(existingBytes) !== plaintextHash) {
      const replacementKey = buildBackupChunkKey(backupId, chunkIndex);
      await putBackupChunkToStore(env, replacementKey, rawBody, {
        sizeBytes: rawBody.length,
        sha256: plaintextHash
      });
      try {
        const updateResult = await db.prepare(
          `UPDATE cpoly_backup_chunk_inventory
              SET kv_key = ?,
                  plaintext_size_bytes = ?,
                  plaintext_sha256 = ?,
                  created_at = ?
            WHERE backup_id = ?
              AND chunk_index = ?
              AND kv_key = ?`
        ).bind(
          replacementKey,
          rawBody.length,
          plaintextHash,
          now,
          backupId,
          chunkIndex,
          kvKey
        ).run();
        if (Number(updateResult?.meta?.changes || 0) !== 1) {
          throw new RecoveryRouteError(
            "Backup chunk repair lost its inventory lease.",
            409
          );
        }
      } catch (error) {
        try {
          await deleteBackupChunkFromStore(env, replacementKey);
        } catch {
          // D1 remains authoritative; a later cleanup pass can retry if needed.
        }
        throw error;
      }
      if (replacementKey !== kvKey) {
        try {
          await deleteBackupChunkFromStore(env, kvKey);
        } catch {
          // Best-effort only; the live inventory row already points at the
          // immutable replacement key.
        }
      }
      return recoveryJson({
        ok: true,
        accepted: true,
        backupId,
        chunkIndex,
        idempotent: true,
        repaired: true,
        nextChunkIndex: Number(backup.uploaded_chunks || 0)
      });
    }
    return recoveryJson({
      ok: true,
      accepted: true,
      backupId,
      chunkIndex,
      idempotent: true,
      nextChunkIndex: Number(backup.uploaded_chunks || 0)
    });
  }
  const expectedIndex = Number(backup.uploaded_chunks || 0);
  if (chunkIndex !== expectedIndex) {
    throw new RecoveryRouteError(
      `Expected chunk index ${expectedIndex} but received ${chunkIndex}.`,
      409
    );
  }
  const nextBytes = Number(backup.uploaded_bytes || 0) + rawBody.length;
  if (nextBytes > maxBackupBytes(env)) {
    throw new RecoveryRouteError("Backup size exceeded the configured cap.", 413);
  }
  const expectedChunk = storedDescriptor.descriptor.chunks[chunkIndex];
  if (!expectedChunk) {
    throw new RecoveryRouteError(
      "Backup chunk index was not declared in the backup descriptor.",
      409
    );
  }
  if (rawBody.length !== expectedChunk.sizeBytes
      || plaintextHash !== expectedChunk.sha256) {
    throw new RecoveryRouteError(
      "Backup chunk did not match the declared archive metadata.",
      409
    );
  }
  if (nextBytes > storedDescriptor.descriptor.archive.sizeBytes) {
    throw new RecoveryRouteError(
      "Backup size exceeded the stored archive metadata.",
      409
    );
  }
  const kvKey = buildBackupChunkKey(backupId, chunkIndex);
  await putBackupChunkToStore(env, kvKey, rawBody, expectedChunk);
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO cpoly_backup_chunk_inventory
          (backup_id, chunk_index, kv_key, plaintext_size_bytes,
           plaintext_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        backupId,
        chunkIndex,
        kvKey,
        rawBody.length,
        plaintextHash,
        now
      ),
      db.prepare(
        `UPDATE cpoly_backup_sets
            SET uploaded_bytes = ?,
                uploaded_chunks = ?,
                updated_at = ?
          WHERE id = ? AND status = 'uploading'`
      ).bind(nextBytes, expectedIndex + 1, now, backupId)
    ]);
  } catch (error) {
    try {
      await deleteBackupChunkFromStore(env, kvKey);
    } catch {
      // D1 remains authoritative; a later cleanup pass can retry if needed.
    }
    throw error;
  }
  return recoveryJson({
    ok: true,
    accepted: true,
    backupId,
    chunkIndex,
    nextChunkIndex: chunkIndex + 1,
    uploadedBytes: nextBytes
  });
}

async function completeBackupSet(backupId, rawBody, env) {
  if (!UUID_V4_PATTERN.test(backupId)) {
    throw new RecoveryRouteError("Backup ID is invalid.", 400);
  }
  const body = parseRequiredJsonBody(rawBody, BACKUP_COMPLETE_SCHEMA);
  body.urlBackupId = backupId;
  const db = getRecoveryDatabase(env);
  const backup = await loadBackupSet(db, backupId);
  const storedDescriptor = parseStoredBackupDescriptor(backup);
  const expectedArchive = validateDescriptorCompleteBody(
    body,
    storedDescriptor,
    env
  );
  const now = Date.now();
  ensureUploadableBackup(backup, now);
  if (Number(backup.uploaded_chunks || 0) !== expectedArchive.chunkCount) {
    throw new RecoveryRouteError(
      "Backup chunk count did not match the uploaded set.",
      409
    );
  }
  if (Number(backup.uploaded_bytes || 0) !== expectedArchive.sizeBytes) {
    throw new RecoveryRouteError(
      "Backup total size did not match the uploaded set.",
      409
    );
  }
  try {
    await verifyBackupStoreContents(env, db, backupId, storedDescriptor);
  } catch (error) {
    await markBackupFailed(db, backupId, error?.message, now);
    await deleteBackupObjectsBestEffort(env, db, backupId);
    throw error;
  }
  const updateResult = await db.prepare(
    `UPDATE cpoly_backup_sets
        SET status = 'complete',
            total_size_bytes = ?,
            chunk_count = ?,
            sha256 = ?,
            descriptor_sha256 = ?,
            manifest_sha256 = ?,
            snapshot_generation = ?,
            snapshot_watermark = ?,
            completed_at = ?,
            verified_at = ?,
            updated_at = ?
      WHERE id = ? AND status = 'uploading'`
  ).bind(
    expectedArchive.sizeBytes,
    expectedArchive.chunkCount,
    expectedArchive.sha256,
    storedDescriptor.descriptorSha256,
    storedDescriptor.metadataSha256,
    storedDescriptor.snapshotCoverage.generation,
    storedDescriptor.snapshotCoverage.watermark,
    now,
    now,
    now,
    backupId
  ).run();
  if (Number(updateResult?.meta?.changes || 0) !== 1) {
    throw new RecoveryRouteError(
      "Backup is no longer accepting completion.",
      409
    );
  }
  await pruneExpiredBackups(env, now);
  const completedBackup = {
    ...backup,
    status: "complete",
    total_size_bytes: expectedArchive.sizeBytes,
    chunk_count: expectedArchive.chunkCount,
    sha256: expectedArchive.sha256,
    descriptor_sha256: storedDescriptor.descriptorSha256,
    manifest_sha256: storedDescriptor.metadataSha256,
    snapshot_generation: storedDescriptor.snapshotCoverage.generation,
    snapshot_watermark: storedDescriptor.snapshotCoverage.watermark,
    completed_at: now,
    verified_at: now,
    updated_at: now
  };
  return recoveryJson({
    ok: true,
    accepted: true,
    status: "complete",
    ...buildBackupResponse(completedBackup, storedDescriptor, env),
    backup: buildBackupResponse(completedBackup, storedDescriptor, env)
  });
}

async function fetchLatestBackup(env) {
  const db = getRecoveryDatabase(env);
  const backups = await loadLatestCompleteBackups(db, 2);
  if (!backups.length) {
    return recoveryJson(
      { message: "No complete CPOLY backup is available." },
      404
    );
  }
  const [backup, priorBackup] = backups;
  const storedDescriptor = parseStoredBackupDescriptor(backup);
  if (!storedDescriptor) {
    throw new RecoveryRouteError("Stored backup descriptor was missing.", 409);
  }
  await verifyStoredChunkInventoryMetadata(db, backup.id, storedDescriptor);
  let priorResponse = null;
  if (priorBackup) {
    const priorDescriptor = parseStoredBackupDescriptor(priorBackup);
    if (!priorDescriptor) {
      throw new RecoveryRouteError(
        "Stored prior backup descriptor was missing.",
        409
      );
    }
    await verifyStoredChunkInventoryMetadata(db, priorBackup.id, priorDescriptor);
    priorResponse = buildBackupResponse(priorBackup, priorDescriptor, env);
  }
  const leaseExpiresAt = Date.now() + backupRestoreLeaseMs(env);
  await touchBackupRestoreLease(db, backup.id, leaseExpiresAt);
  if (priorBackup) {
    await touchBackupRestoreLease(db, priorBackup.id, leaseExpiresAt);
  }
  const latestResponse = buildBackupResponse(backup, storedDescriptor, env);
  return recoveryJson({
    ok: true,
    accepted: true,
    ...latestResponse,
    backup: latestResponse,
    ...(priorResponse ? { priorBackup: priorResponse } : {})
  });
}

async function fetchBackupChunk(backupId, chunkIndex, env) {
  if (!UUID_V4_PATTERN.test(backupId)) {
    throw new RecoveryRouteError("Backup ID is invalid.", 400);
  }
  const db = getRecoveryDatabase(env);
  const backup = await loadBackupSet(db, backupId);
  const storedDescriptor = parseStoredBackupDescriptor(backup);
  if (backup.status !== "complete") {
    throw new RecoveryRouteError("Backup is not complete.", 409);
  }
  if (chunkIndex < 0 || chunkIndex >= Number(backup.chunk_count || 0)) {
    throw new RecoveryRouteError("Backup chunk index is out of range.", 404);
  }
  const row = await db.prepare(
    `SELECT kv_key, plaintext_size_bytes, plaintext_sha256
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ? AND chunk_index = ?`
  ).bind(backupId, chunkIndex).first();
  if (!row) {
    throw new RecoveryRouteError("Backup chunk was not found.", 404);
  }
  const bytes = await readBackupChunkFromStore(env, db, backupId, {
    chunkIndex,
    kvKey: String(row.kv_key || ""),
    plaintextSizeBytes: Number(row.plaintext_size_bytes || 0),
    plaintextSha256: String(row.plaintext_sha256 || "").toLowerCase()
  });
  if (bytes == null) {
    throw new RecoveryRouteError(
      "Backup chunk was missing from object storage.",
      409
    );
  }
  const bodyHash = sha256HexBytes(bytes);
  if (bodyHash !== String(row.plaintext_sha256)
      || bytes.length !== Number(row.plaintext_size_bytes || 0)) {
    throw new RecoveryRouteError(
      "Backup chunk integrity verification failed.",
      409
    );
  }
  if (storedDescriptor) {
    const expectedChunk = storedDescriptor.descriptor.chunks[chunkIndex];
    if (!expectedChunk
        || expectedChunk.sizeBytes !== bytes.length
        || expectedChunk.sha256 !== bodyHash) {
      throw new RecoveryRouteError(
        "Backup chunk did not match the stored descriptor.",
        409
      );
    }
  }
  await touchBackupRestoreLease(
    db,
    backupId,
    Date.now() + backupRestoreLeaseMs(env)
  );
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": storedDescriptor?.descriptor.archive.contentType
        || "application/octet-stream",
      "cache-control": "no-store",
      "x-adg-backup-id": backupId,
      "x-adg-backup-chunk-index": String(chunkIndex),
      "x-adg-content-sha256": bodyHash,
      "x-adg-backup-total-chunks": String(backup.chunk_count),
      ...(storedDescriptor
        ? {
            "x-adg-backup-descriptor-sha256":
              storedDescriptor.descriptorSha256,
            "x-adg-backup-metadata-sha256": storedDescriptor.metadataSha256
          }
        : {})
    }
  });
}

function buildRecoveryStatusPayload(runtime) {
  return {
    state: runtime.state,
    readyGeneration: runtime.readyGeneration,
    targetGeneration: runtime.targetGeneration,
    recoveryId: runtime.recoveryId,
    restoreBackupId: runtime.restoreBackupId,
    restoreSnapshotGeneration: runtime.restoreSnapshotGeneration,
    restoreSnapshotWatermark: runtime.restoreSnapshotWatermark,
    restoreLeaseExpiresAtUtc: runtime.restoreLeaseExpiresAt == null
      ? null
      : new Date(runtime.restoreLeaseExpiresAt).toISOString(),
    startedAtUtc: runtime.startedAt == null
      ? null
      : new Date(runtime.startedAt).toISOString(),
    updatedAtUtc: runtime.updatedAt == null
      ? null
      : new Date(runtime.updatedAt).toISOString(),
    completedAtUtc: runtime.completedAt == null
      ? null
      : new Date(runtime.completedAt).toISOString(),
    lastError: runtime.lastError
  };
}

async function fetchRecoveryStatus(env) {
  const runtime = await getCpolyRecoveryRuntime(env);
  return recoveryJson({
    ok: true,
    recovery: buildRecoveryStatusPayload(runtime)
  });
}

async function beginRecovery(rawBody, env) {
  if (!env?.DB?.__isPostgresD1Database) {
    throw new RecoveryRouteError(
      "Recovery generation control requires the PostgreSQL adapter.",
      409
    );
  }
  const body = parseRequiredJsonBody(rawBody, RECOVERY_BEGIN_SCHEMA);
  const backupId = normalizeBackupId(body.backupId, "backupId");
  const recoveryDb = getRecoveryDatabase(env);
  const runtime = await getCpolyRecoveryRuntime(env);
  const backup = await loadBackupSet(recoveryDb, backupId);
  if (String(backup.status) !== "complete") {
    throw new RecoveryRouteError("Backup is not complete.", 409);
  }
  const storedDescriptor = parseStoredBackupDescriptor(backup);
  const snapshotCoverage = normalizeRecoverySnapshotCoverage(
    body.snapshotGeneration ?? storedDescriptor.snapshotCoverage.generation,
    body.snapshotWatermark ?? storedDescriptor.snapshotCoverage.watermark,
    "snapshot"
  );
  if (snapshotCoverage.generation !== storedDescriptor.snapshotCoverage.generation
      || snapshotCoverage.watermark !== storedDescriptor.snapshotCoverage.watermark) {
    throw new RecoveryRouteError(
      "Requested recovery snapshot did not match the selected backup.",
      409
    );
  }
  const now = Date.now();
  if (runtime.state === "recovering") {
    if (runtime.restoreBackupId === backupId
        && runtime.restoreSnapshotGeneration === snapshotCoverage.generation
        && runtime.restoreSnapshotWatermark === snapshotCoverage.watermark) {
      const leaseExpiresAt = now + recoveryLeaseMs(env);
      await recoveryDb.prepare(
        `UPDATE cpoly_recovery_runtime
            SET restore_lease_expires_at = ?,
                updated_at = ?,
                last_error = NULL
          WHERE slot = 'global'
            AND state = 'recovering'
            AND recovery_id = ?`
      ).bind(leaseExpiresAt, now, runtime.recoveryId).run();
      await touchBackupRestoreLease(recoveryDb, backupId, leaseExpiresAt);
      const updatedRuntime = await getCpolyRecoveryRuntime(env);
      return recoveryJson({
        ok: true,
        recovery: buildRecoveryStatusPayload(updatedRuntime)
      });
    }
    throw new RecoveryRouteError(
      "Another recovery generation is already in progress.",
      409
    );
  }
  const targetGeneration = runtime.readyGeneration + 1;
  const recoveryId = crypto.randomUUID();
  const leaseExpiresAt = now + recoveryLeaseMs(env);
  await recoveryDb.prepare(
    `UPDATE cpoly_recovery_runtime
        SET state = 'recovering',
            ready_generation = ?,
            target_generation = ?,
            recovery_id = ?,
            restore_backup_id = ?,
            restore_snapshot_generation = ?,
            restore_snapshot_watermark = ?,
            restore_lease_expires_at = ?,
            started_at = ?,
            updated_at = ?,
            completed_at = NULL,
            last_error = NULL
      WHERE slot = 'global'`
  ).bind(
    runtime.readyGeneration,
    targetGeneration,
    recoveryId,
    backupId,
    snapshotCoverage.generation,
    snapshotCoverage.watermark,
    leaseExpiresAt,
    now,
    now
  ).run();
  await touchBackupRestoreLease(recoveryDb, backupId, leaseExpiresAt);
  const updatedRuntime = await getCpolyRecoveryRuntime(env);
  return recoveryJson({
    ok: true,
    recovery: buildRecoveryStatusPayload(updatedRuntime)
  });
}

async function completeRecovery(rawBody, env) {
  if (!env?.DB?.__isPostgresD1Database) {
    throw new RecoveryRouteError(
      "Recovery generation control requires the PostgreSQL adapter.",
      409
    );
  }
  const body = parseRequiredJsonBody(rawBody, RECOVERY_COMPLETE_SCHEMA);
  const recoveryDb = getRecoveryDatabase(env);
  const runtime = await getCpolyRecoveryRuntime(env);
  if (runtime.state !== "recovering") {
    throw new RecoveryRouteError("No recovery generation is in progress.", 409);
  }
  if (body.recoveryId != null
      && normalizeBackupId(body.recoveryId, "recoveryId") !== runtime.recoveryId) {
    throw new RecoveryRouteError("Recovery ID did not match the active run.", 409);
  }
  if (body.backupId != null
      && normalizeBackupId(body.backupId, "backupId") !== runtime.restoreBackupId) {
    throw new RecoveryRouteError("Backup ID did not match the active recovery.", 409);
  }
  const snapshotCoverage = normalizeRecoverySnapshotCoverage(
    body.snapshotGeneration ?? runtime.restoreSnapshotGeneration,
    body.snapshotWatermark ?? runtime.restoreSnapshotWatermark,
    "snapshot"
  );
  if (snapshotCoverage.generation !== runtime.restoreSnapshotGeneration
      || snapshotCoverage.watermark !== runtime.restoreSnapshotWatermark) {
    throw new RecoveryRouteError(
      "Recovery completion snapshot did not match the active run.",
      409
    );
  }
  const latestBackup = await loadBackupSet(recoveryDb, runtime.restoreBackupId);
  const latestDescriptor = parseStoredBackupDescriptor(latestBackup);
  if (latestDescriptor.snapshotCoverage.generation !== snapshotCoverage.generation
      || latestDescriptor.snapshotCoverage.watermark !== snapshotCoverage.watermark) {
    throw new RecoveryRouteError(
      "Recovery backup descriptor no longer matches the active snapshot.",
      409
    );
  }
  const replayResult = await env.DB.completeRecoveryReplay({
    snapshotCoverage,
    targetGeneration: runtime.targetGeneration,
    limit: journalReplayLimit(env)
  });
  const outstanding = await countRecoveryReplayPending(
    recoveryDb,
    snapshotCoverage,
    runtime.targetGeneration
  );
  if (outstanding > 0) {
    await setRecoveryRuntimeError(
      recoveryDb,
      `Recovery replay still has ${outstanding} outstanding journal entries.`
    );
    throw new RecoveryRouteError(
      "Recovery replay has not yet reached a ready state.",
      409
    );
  }
  const coverage = normalizeRecoverySnapshotCoverage(
    replayResult?.generation,
    replayResult?.receiptSeq,
    "postgresReceipt"
  );
  if (coverage.generation !== Number(runtime.targetGeneration)
      || coverage.watermark < snapshotCoverage.watermark) {
    await setRecoveryRuntimeError(
      recoveryDb,
      "PostgreSQL recovery verification watermark was invalid."
    );
    throw new RecoveryRouteError(
      "PostgreSQL recovery verification watermark was invalid.",
      409
    );
  }
  const now = Date.now();
  await recoveryDb.prepare(
    `UPDATE cpoly_recovery_runtime
        SET state = 'ready',
            ready_generation = ?,
            target_generation = NULL,
            recovery_id = NULL,
            restore_backup_id = NULL,
            restore_snapshot_generation = NULL,
            restore_snapshot_watermark = NULL,
            restore_lease_expires_at = NULL,
            started_at = NULL,
            updated_at = ?,
            completed_at = ?,
            last_error = NULL
      WHERE slot = 'global'`
  ).bind(runtime.targetGeneration, now, now).run();
  await touchBackupRestoreLease(recoveryDb, runtime.restoreBackupId, now);
  const updatedRuntime = await getCpolyRecoveryRuntime(env);
  return recoveryJson({
    ok: true,
    replay: replayResult,
    recovery: buildRecoveryStatusPayload(updatedRuntime)
  });
}

async function setRecoveryRuntimeError(recoveryDb, message) {
  await recoveryDb.prepare(
    `UPDATE cpoly_recovery_runtime
        SET updated_at = ?,
            last_error = ?
      WHERE slot = 'global'`
  ).bind(Date.now(), boundErrorMessage(message)).run();
}

async function verifySignedCpolyRequest(request, rawBody, env, path) {
  const db = getRecoveryDatabase(env);
  if (!db) {
    throw new RecoveryRouteError("Recovery store is unavailable.", 503);
  }
  const timestampValue = request.headers.get("x-adg-timestamp");
  const nonce = String(request.headers.get("x-adg-nonce") || "")
    .trim()
    .toLowerCase();
  const bodyHash = String(request.headers.get("x-adg-content-sha256") || "")
    .trim()
    .toLowerCase();
  const signature = String(request.headers.get("x-adg-signature") || "")
    .trim()
    .toLowerCase();
  const timestamp = Number.parseInt(String(timestampValue || ""), 10);
  if (!Number.isSafeInteger(timestamp)
      || !UUID_V4_PATTERN.test(nonce)
      || !SHA256_HEX_PATTERN.test(bodyHash)
      || !SHA256_HEX_PATTERN.test(signature)) {
    throw new RecoveryRouteError(
      "CPOLY backup signature headers were invalid.",
      401
    );
  }
  const now = Date.now();
  if (Math.abs(now - timestamp) > CPOLY_SIGNATURE_WINDOW_MS) {
    throw new RecoveryRouteError(
      "CPOLY backup request timestamp was outside the allowed window.",
      401
    );
  }
  const actualBodyHash = sha256HexBytes(rawBody);
  if (!constantTimeHexEqual(actualBodyHash, bodyHash)) {
    throw new RecoveryRouteError(
      "CPOLY backup request body hash did not match.",
      401
    );
  }
  const canonical = buildCpolyCanonicalText(
    request.method,
    path,
    timestamp,
    nonce,
    bodyHash
  );
  const expectedSignature = await hmacSha256Hex(
    env.CPOLY_BACKUP_HMAC_KEY,
    canonical
  );
  if (!constantTimeHexEqual(expectedSignature, signature)) {
    throw new RecoveryRouteError(
      "CPOLY backup request signature was invalid.",
      401
    );
  }
  const expiresAt = timestamp + CPOLY_SIGNATURE_WINDOW_MS;
  const insert = await db.prepare(
    `INSERT INTO cpoly_signed_api_nonces
      (nonce, request_method, request_path, body_sha256, created_at, expires_at)
     SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
          FROM cpoly_signed_api_nonces
         WHERE nonce = ?
      )`
  ).bind(
    nonce,
    request.method,
    path,
    bodyHash,
    now,
    expiresAt,
    nonce
  ).run();
  if (Number(insert.meta?.changes || 0) !== 1) {
    throw new RecoveryRouteError(
      "CPOLY backup request nonce was already used.",
      409
    );
  }
}

async function readInternalRequestBody(request, url, env) {
  const maxBytes = internalRouteBodyLimit(request, url, env);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new RecoveryRouteError(
      "Request body exceeded the configured limit.",
      413
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new RecoveryRouteError(
      "Request body exceeded the configured limit.",
      413
    );
  }
  if (["GET", "HEAD"].includes(request.method) && bytes.length > 0) {
    throw new RecoveryRouteError(
      "GET and HEAD backup requests must not send a body.",
      400
    );
  }
  return bytes;
}

function internalRouteBodyLimit(request, url, env) {
  if (request.method === "PUT"
      && /^\/api\/internal\/cpoly-backups\/[0-9a-f-]{36}\/chunks\/\d+$/iu
        .test(url.pathname)) {
    return maxChunkBytes(env);
  }
  return MAX_JSON_BODY_BYTES;
}

function parseOptionalJsonBody(bytes, expectedSchema) {
  if (!bytes.length) return null;
  return parseRequiredJsonBody(bytes, expectedSchema);
}

function parseRequiredJsonBody(bytes, expectedSchema) {
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RecoveryRouteError(
      "Backup request body was not valid JSON.",
      400
    );
  }
  if (!value || value.schema !== expectedSchema || Array.isArray(value)) {
    throw new RecoveryRouteError(
      "Backup request JSON schema was invalid.",
      400
    );
  }
  return value;
}

function hasBackupDescriptorFields(body) {
  return Boolean(
    body
    && (
      body.manifest != null
      || body.metadata != null
      || body.archive != null
      || body.chunks != null
    )
  );
}

function createBackupDescriptorLimits(env) {
  return {
    maxChunkBytes: maxChunkBytes(env),
    maxBackupBytes: maxBackupBytes(env),
    maxBackupChunks: maxBackupChunks(env)
  };
}

function storedBackupDescriptorLimits() {
  return {
    maxChunkBytes: HARD_MAX_CHUNK_BYTES,
    maxBackupBytes: HARD_MAX_CHUNK_BYTES * 4096,
    maxBackupChunks: 4096
  };
}

function normalizeBackupDescriptorParts(parts, limits) {
  const schema = normalizeNonEmptyString(parts?.schema, "schema", 128);
  if (schema !== BACKUP_DESCRIPTOR_SCHEMA) {
    throw new RecoveryRouteError("Backup descriptor schema was invalid.", 400);
  }
  const archive = normalizeBackupArchiveMetadata(parts?.archive, limits);
  const chunks = normalizeBackupChunkDescriptors(parts?.chunks, archive, limits);
  const manifest = normalizeBackupManifest(
    parts?.manifest ?? parts?.metadata,
    archive
  );
  const snapshotCoverage = {
    generation: manifest.snapshotGeneration,
    watermark: manifest.postgresReceiptWatermark
  };
  const descriptor = {
    schema,
    manifest,
    metadata: manifest,
    archive,
    chunks
  };
  const descriptorJson = JSON.stringify(descriptor);
  if (utf8Length(descriptorJson) > MAX_BACKUP_DESCRIPTOR_JSON_BYTES) {
    throw new RecoveryRouteError(
      "Backup descriptor exceeded the configured limit.",
      413
    );
  }
  const manifestJson = JSON.stringify(manifest);
  return {
    descriptor,
    descriptorJson,
    descriptorSha256: sha256HexUtf8(descriptorJson),
    metadataSha256: sha256HexUtf8(manifestJson),
    manifestSha256: sha256HexUtf8(manifestJson),
    snapshotCoverage
  };
}

function parseRequestedBackupDescriptor(body, env) {
  return normalizeBackupDescriptorParts(body, createBackupDescriptorLimits(env));
}

function parseStoredBackupDescriptor(backup) {
  const descriptorJson = String(backup?.descriptor_json || "");
  if (!descriptorJson) return null;
  const descriptorSha256 = normalizeSha256Hex(
    backup?.descriptor_sha256,
    "Stored backup descriptor hash"
  );
  if (!constantTimeHexEqual(sha256HexUtf8(descriptorJson), descriptorSha256)) {
    throw new RecoveryRouteError(
      "Stored backup descriptor hash did not match its payload.",
      409
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(descriptorJson);
  } catch {
    throw new RecoveryRouteError(
      "Stored backup descriptor JSON was invalid.",
      409
    );
  }
  const normalized = normalizeBackupDescriptorParts(
    parsed,
    storedBackupDescriptorLimits()
  );
  if (!constantTimeHexEqual(normalized.descriptorSha256, descriptorSha256)) {
    throw new RecoveryRouteError(
      "Stored backup descriptor normalization mismatch was detected.",
      409
    );
  }
  if (backup?.manifest_sha256 != null && backup?.manifest_sha256 !== "") {
    const storedMetadataSha = normalizeSha256Hex(
      backup.manifest_sha256,
      "Stored backup metadata hash"
    );
    if (!constantTimeHexEqual(normalized.metadataSha256, storedMetadataSha)) {
      throw new RecoveryRouteError(
        "Stored backup metadata hash did not match its payload.",
        409
      );
    }
  }
  if (backup?.snapshot_generation != null
      && Number(backup.snapshot_generation)
        !== normalized.snapshotCoverage.generation) {
    throw new RecoveryRouteError(
      "Stored backup snapshot generation did not match its descriptor.",
      409
    );
  }
  if (backup?.snapshot_watermark != null
      && Number(backup.snapshot_watermark)
        !== normalized.snapshotCoverage.watermark) {
    throw new RecoveryRouteError(
      "Stored backup snapshot watermark did not match its descriptor.",
      409
    );
  }
  return normalized;
}

function normalizeBackupArchiveMetadata(archive, limits) {
  const object = normalizeObject(archive, "archive");
  const fileName = normalizeSafeFileName(object.fileName, "archive.fileName");
  const format = normalizeOptionalString(
    object.format,
    "archive.format",
    128
  );
  const database = normalizeOptionalString(
    object.database,
    "archive.database",
    256
  );
  const sizeBytes = positiveInteger(
    object.sizeBytes,
    "archive.sizeBytes",
    1,
    limits.maxBackupBytes
  );
  const sha256 = normalizeSha256Hex(object.sha256, "archive.sha256");
  const chunkCount = positiveInteger(
    object.chunkCount,
    "archive.chunkCount",
    1,
    limits.maxBackupChunks
  );
  const chunkSizeBytes = positiveInteger(
    object.chunkSizeBytes,
    "archive.chunkSizeBytes",
    1,
    limits.maxChunkBytes
  );
  const contentType = normalizeOptionalString(
    object.contentType,
    "archive.contentType",
    128
  ) || DEFAULT_BACKUP_ARCHIVE_CONTENT_TYPE;
  const encryptionFormat = normalizeArchiveEncryptionFormat(
    object.encryptionFormat ?? object.ciphertextFormat
  );
  const normalized = {
    fileName,
    sizeBytes,
    sha256,
    chunkCount,
    chunkSizeBytes,
    contentType,
    encryptionFormat
  };
  if (database) normalized.database = database;
  if (format) normalized.format = format;
  return normalized;
}

function normalizeBackupChunkDescriptors(chunks, archive, limits) {
  const values = normalizeArray(chunks, "chunks");
  if (values.length !== archive.chunkCount) {
    throw new RecoveryRouteError(
      "Backup chunk descriptors did not match archive.chunkCount.",
      400
    );
  }
  let totalBytes = 0;
  const normalized = values.map((chunk, index) => {
    const object = normalizeObject(chunk, `chunks[${index}]`);
    const chunkIndex = positiveInteger(
      object.index,
      `chunks[${index}].index`,
      0,
      limits.maxBackupChunks
    );
    if (chunkIndex !== index) {
      throw new RecoveryRouteError(
        "Backup chunk indexes must be contiguous and zero-based.",
        400
      );
    }
    const sizeBytes = positiveInteger(
      object.sizeBytes,
      `chunks[${index}].sizeBytes`,
      1,
      archive.chunkSizeBytes
    );
    if (index < values.length - 1 && sizeBytes !== archive.chunkSizeBytes) {
      throw new RecoveryRouteError(
        "All non-final backup chunks must use archive.chunkSizeBytes.",
        400
      );
    }
    const sha256 = normalizeSha256Hex(
      object.sha256,
      `chunks[${index}].sha256`
    );
    totalBytes += sizeBytes;
    return {
      index: chunkIndex,
      sizeBytes,
      sha256
    };
  });
  if (totalBytes !== archive.sizeBytes) {
    throw new RecoveryRouteError(
      "Backup chunk descriptors did not sum to archive.sizeBytes.",
      400
    );
  }
  return normalized;
}

function normalizeBackupManifest(manifest, archive) {
  const object = normalizeObject(manifest, "manifest");
  if (![CPOLY_POSTGRES_BACKUP_MANIFEST_SCHEMA, CPOLY_POSTGRES_ENCRYPTED_BUNDLE_SCHEMA]
    .includes(String(object.schema || ""))) {
    throw new RecoveryRouteError(
      "Backup manifest schema was invalid.",
      400
    );
  }
  const databases = normalizeBackupDatabaseInventory(object.databases);
  const attestations = normalizeBackupManifestAttestations(
    object.attestations
  );
  const encryption = normalizeBackupManifestEncryption(
    object.encryption,
    archive
  );
  const claimBoundary = normalizeExactClaimBoundary(
    object.claim_boundary,
    Boolean(encryption)
  );
  const restoreTest = normalizeBackupRestoreEvidence(
    object.restore_test,
    databases
  );
  const normalized = {
    schema: String(object.schema),
    created_at_utc: normalizeIsoTimestamp(
      object.created_at_utc,
      "manifest.created_at_utc"
    ),
    source_container: normalizeNonEmptyString(
      object.source_container,
      "manifest.source_container",
      256
    ),
    source_image: normalizeNonEmptyString(
      object.source_image,
      "manifest.source_image",
      512
    ),
    server_version: normalizeNonEmptyString(
      object.server_version,
      "manifest.server_version",
      128
    ),
    databases,
    plaintext_file_hashes: normalizeBackupPlaintextHashes(
      object.plaintext_file_hashes
    ),
    attestations,
    restore_test: restoreTest,
    claim_boundary: claimBoundary,
    snapshotGeneration: positiveInteger(
      object.snapshotGeneration,
      "manifest.snapshotGeneration",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    postgresReceiptWatermark: positiveInteger(
      object.postgresReceiptWatermark,
      "manifest.postgresReceiptWatermark",
      0,
      Number.MAX_SAFE_INTEGER
    )
  };
  if (encryption) normalized.encryption = encryption;
  return normalized;
}

function normalizeBackupDatabaseInventory(databases) {
  const values = normalizeArray(databases, "manifest.databases");
  if (!values.length) {
    throw new RecoveryRouteError(
      "Backup manifest.databases must not be empty.",
      400
    );
  }
  return values.map((database, index) => {
    const object = normalizeObject(database, `manifest.databases[${index}]`);
    const normalized = {
      name: normalizeNonEmptyString(
        object.name,
        `manifest.databases[${index}].name`,
        256
      ),
      bytes: positiveInteger(
        object.bytes,
        `manifest.databases[${index}].bytes`,
        1,
        Number.MAX_SAFE_INTEGER
      ),
      dump: normalizeSafeFileName(
        object.dump,
        `manifest.databases[${index}].dump`,
        /\.(dump|sql)$/iu
      )
    };
    if (object.oid != null) {
      normalized.oid = positiveInteger(
        object.oid,
        `manifest.databases[${index}].oid`,
        1,
        Number.MAX_SAFE_INTEGER
      );
    }
    return normalized;
  });
}

function normalizeBackupPlaintextHashes(values) {
  const rows = normalizeArray(values, "manifest.plaintext_file_hashes");
  if (!rows.length) {
    throw new RecoveryRouteError(
      "Backup manifest.plaintext_file_hashes must not be empty.",
      400
    );
  }
  return rows.map((row, index) => {
    const object = normalizeObject(
      row,
      `manifest.plaintext_file_hashes[${index}]`
    );
    return {
      name: normalizeSafeFileName(
        object.name,
        `manifest.plaintext_file_hashes[${index}].name`
      ),
      bytes: positiveInteger(
        object.bytes,
        `manifest.plaintext_file_hashes[${index}].bytes`,
        1,
        Number.MAX_SAFE_INTEGER
      ),
      sha256: normalizeSha256Hex(
        object.sha256,
        `manifest.plaintext_file_hashes[${index}].sha256`
      )
    };
  });
}

function normalizeBackupManifestAttestations(attestations) {
  const object = normalizeObject(attestations, "manifest.attestations");
  if (object.schema != null
      && normalizeNonEmptyString(
        object.schema,
        "manifest.attestations.schema",
        128
      ) !== CPOLY_POSTGRES_BACKUP_ATTESTATIONS_SCHEMA) {
    throw new RecoveryRouteError(
      "Backup manifest attestation schema was invalid.",
      400
    );
  }
  const protectedColumnsEntityCrypt = normalizeBoolean(
    object.protected_columns_entitycrypt,
    "manifest.attestations.protected_columns_entitycrypt"
  );
  const rolePasswordMaterialExcluded = normalizeBoolean(
    object.role_password_material_excluded,
    "manifest.attestations.role_password_material_excluded"
  );
  const bootstrapRolesSeparate = normalizeBoolean(
    object.bootstrap_roles_separate,
    "manifest.attestations.bootstrap_roles_separate"
  );
  if (!protectedColumnsEntityCrypt
      || !rolePasswordMaterialExcluded
      || !bootstrapRolesSeparate) {
    throw new RecoveryRouteError(
      "Backup manifest attestations must confirm EntityCrypt protection and separate role bootstrap handling.",
      400
    );
  }
  return {
    schema: CPOLY_POSTGRES_BACKUP_ATTESTATIONS_SCHEMA,
    protected_columns_entitycrypt: true,
    role_password_material_excluded: true,
    bootstrap_roles_separate: true
  };
}

function normalizeBackupManifestEncryption(encryption, archive) {
  if (encryption == null) return null;
  if (archive.encryptionFormat !== CPOLY_POSTGRES_BACKUP_ENCRYPTION_FORMAT) {
    throw new RecoveryRouteError(
      "Backup manifest encryption metadata requires an encrypted archive format.",
      400
    );
  }
  const object = normalizeObject(encryption, "manifest.encryption");
  const status = normalizeNonEmptyString(
    object.status,
    "manifest.encryption.status",
    128
  );
  if (status !== CPOLY_POSTGRES_BACKUP_ENCRYPTION_STATUS) {
    throw new RecoveryRouteError(
      "Backup manifest encryption status was invalid.",
      400
    );
  }
  const algorithm = normalizeNonEmptyString(
    object.algorithm,
    "manifest.encryption.algorithm",
    256
  );
  if (!/AES-?256/iu.test(algorithm) || !/OpenPGP/iu.test(algorithm)) {
    throw new RecoveryRouteError(
      "Backup manifest encryption algorithm was invalid.",
      400
    );
  }
  const encryptedArchive = normalizeSafeFileName(
    object.encrypted_archive,
    "manifest.encryption.encrypted_archive",
    /\.gpg$/iu
  );
  const encryptedBytes = positiveInteger(
    object.encrypted_bytes,
    "manifest.encryption.encrypted_bytes",
    1,
    Number.MAX_SAFE_INTEGER
  );
  const encryptedSha256 = normalizeSha256Hex(
    object.encrypted_sha256,
    "manifest.encryption.encrypted_sha256"
  );
  if (encryptedArchive !== archive.fileName
      || encryptedBytes !== archive.sizeBytes
      || encryptedSha256 !== archive.sha256) {
    throw new RecoveryRouteError(
      "Backup manifest encryption metadata did not match the archive.",
      400
    );
  }
  if (object.round_trip_verified !== true) {
    throw new RecoveryRouteError(
      "Backup manifest must prove an encryption round-trip.",
      400
    );
  }
  const normalized = {
    status,
    algorithm,
    encrypted_archive: encryptedArchive,
    encrypted_bytes: encryptedBytes,
    encrypted_sha256: encryptedSha256,
    round_trip_verified: true
  };
  for (const key of ["key_source", "key_vault_name", "secret_name"]) {
    const value = normalizeOptionalString(
      object[key],
      `manifest.encryption.${key}`,
      256
    );
    if (value) normalized[key] = value;
  }
  return normalized;
}

function normalizeBackupRestoreEvidence(restoreTest, inventoryRows) {
  const object = normalizeObject(restoreTest, "manifest.restore_test");
  const requested = normalizeBoolean(
    object.requested,
    "manifest.restore_test.requested"
  );
  const status = normalizeNonEmptyString(
    object.status,
    "manifest.restore_test.status",
    64
  );
  if (!["PASS", "NOT_RUN"].includes(status)) {
    throw new RecoveryRouteError(
      "Backup restore evidence status was invalid.",
      400
    );
  }
  const databases = object.databases == null
    ? []
    : normalizeArray(object.databases, "manifest.restore_test.databases")
      .map((row, index) => {
        const value = normalizeObject(
          row,
          `manifest.restore_test.databases[${index}]`
        );
        return {
          source_database: normalizeNonEmptyString(
            value.source_database,
            `manifest.restore_test.databases[${index}].source_database`,
            256
          ),
          target_database: normalizeNonEmptyString(
            value.target_database,
            `manifest.restore_test.databases[${index}].target_database`,
            256
          ),
          restored_bytes: positiveInteger(
            value.restored_bytes,
            `manifest.restore_test.databases[${index}].restored_bytes`,
            1,
            Number.MAX_SAFE_INTEGER
          ),
          status: normalizeNonEmptyString(
            value.status,
            `manifest.restore_test.databases[${index}].status`,
            64
          )
        };
      });
  if (requested && status !== "PASS") {
    throw new RecoveryRouteError(
      "Requested restore evidence must report PASS.",
      400
    );
  }
  if (requested && !databases.length) {
    throw new RecoveryRouteError(
      "Requested restore evidence must list restored databases.",
      400
    );
  }
  const inventory = inventoryRows.map(row => row.name).sort();
  const restored = databases.map(row => row.source_database);
  const distinct = new Set(restored);
  if (distinct.size !== restored.length) {
    throw new RecoveryRouteError(
      "Restore evidence contained a duplicate source database.",
      400
    );
  }
  if (requested) {
    const normalizedRestored = [...restored].sort();
    if (normalizedRestored.length !== inventory.length
        || normalizedRestored.some((name, index) => name !== inventory[index])) {
      throw new RecoveryRouteError(
        "Restore evidence must cover every inventoried database exactly once.",
        400
      );
    }
    for (const row of databases) {
      if (row.status !== "PASS") {
        throw new RecoveryRouteError(
          "Restore evidence rows must all report PASS.",
          400
        );
      }
    }
  }
  return {
    requested,
    status,
    databases
  };
}

function normalizeArchiveEncryptionFormat(value) {
  const normalized = String(
    value || CPOLY_POSTGRES_BACKUP_UNENCRYPTED_FORMAT
  ).trim().toLowerCase();
  if ([
    CPOLY_POSTGRES_BACKUP_UNENCRYPTED_FORMAT,
    "plaintext",
    "custom-dump",
    "postgres-custom",
    CPOLY_POSTGRES_BACKUP_ENCRYPTION_FORMAT,
    "aes256-openpgp",
    "gpg-aes256-symmetric",
    "openpgp-aes256-symmetric"
  ].includes(normalized)) {
    return [
      CPOLY_POSTGRES_BACKUP_ENCRYPTION_FORMAT,
      "aes256-openpgp",
      "gpg-aes256-symmetric",
      "openpgp-aes256-symmetric"
    ].includes(normalized)
      ? CPOLY_POSTGRES_BACKUP_ENCRYPTION_FORMAT
      : CPOLY_POSTGRES_BACKUP_UNENCRYPTED_FORMAT;
  }
  throw new RecoveryRouteError(
    "Backup archive encryption format was invalid.",
    400
  );
}

function normalizeExactClaimBoundary(value, legacyEncryptedArchive = false) {
  const claimBoundary = normalizeNonEmptyString(
    value,
    "manifest.claim_boundary",
    512
  );
  const accepted = legacyEncryptedArchive
    ? [
        CPOLY_POSTGRES_BACKUP_CLAIM_BOUNDARY,
        LEGACY_CPOLY_POSTGRES_BACKUP_CLAIM_BOUNDARY
      ]
    : [CPOLY_POSTGRES_BACKUP_CLAIM_BOUNDARY];
  if (!accepted.includes(claimBoundary)) {
    throw new RecoveryRouteError(
      "Backup manifest claim boundary was invalid.",
      400
    );
  }
  return claimBoundary;
}

function normalizeObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return value;
}

function normalizeArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return value;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return value;
}

function normalizeIsoTimestamp(value, fieldName) {
  const text = normalizeNonEmptyString(value, fieldName, 64);
  if (Number.isNaN(Date.parse(text))) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return text;
}

function normalizeNonEmptyString(value, fieldName, maxLength = 1024) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return text;
}

function normalizeOptionalString(value, fieldName, maxLength = 1024) {
  if (value == null || value === "") return null;
  return normalizeNonEmptyString(value, fieldName, maxLength);
}

function normalizeSafeFileName(value, fieldName, requiredSuffix = null) {
  const text = normalizeNonEmptyString(value, fieldName, 256);
  if (!SAFE_FILE_NAME_PATTERN.test(text)
      || text.includes("..")
      || text.includes("/")
      || text.includes("\\")) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  if (requiredSuffix && !requiredSuffix.test(text)) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return text;
}

function normalizeSha256Hex(value, fieldName) {
  const text = String(value || "").trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(text)) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return text;
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

async function loadBackupSet(db, backupId) {
  const row = await db.prepare(
    `SELECT id, status, created_at, updated_at, expires_at,
            total_size_bytes, chunk_count, sha256,
            uploaded_bytes, uploaded_chunks, completed_at,
            descriptor_json, descriptor_sha256, manifest_sha256,
            snapshot_generation, snapshot_watermark, verified_at,
            restore_lease_expires_at
       FROM cpoly_backup_sets
      WHERE id = ?`
  ).bind(backupId).first();
  if (!row) {
    throw new RecoveryRouteError("CPOLY backup was not found.", 404);
  }
  return row;
}

async function loadLatestCompleteBackups(db, limit = 2) {
  const boundedLimit = Math.max(1, Math.min(8, Number(limit) || 2));
  return (await db.prepare(
    `SELECT id, status, created_at, completed_at, expires_at,
            total_size_bytes, chunk_count, sha256,
            descriptor_json, descriptor_sha256, manifest_sha256,
            snapshot_generation, snapshot_watermark, verified_at,
            restore_lease_expires_at
       FROM cpoly_backup_sets
      WHERE status = 'complete'
        AND verified_at IS NOT NULL
        AND snapshot_generation IS NOT NULL
        AND snapshot_watermark IS NOT NULL
      ORDER BY snapshot_generation DESC,
               snapshot_watermark DESC,
               verified_at DESC,
               created_at DESC
      LIMIT ${boundedLimit}`
  ).all()).results || [];
}

async function countBackupChunks(db, backupId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ?`
  ).bind(backupId).first();
  return Number(row?.count || 0);
}

async function queryBackupChunkInventory(db, backupId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(plaintext_size_bytes), 0) AS total_bytes,
            MIN(chunk_index) AS min_index,
            MAX(chunk_index) AS max_index
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ?`
  ).bind(backupId).first();
  return {
    count: Number(row?.count || 0),
    totalBytes: Number(row?.total_bytes || 0),
    minIndex: row?.min_index == null ? null : Number(row.min_index),
    maxIndex: row?.max_index == null ? null : Number(row.max_index)
  };
}

async function loadBackupChunkPage(db, backupId, offset, limit) {
  return ((await db.prepare(
    `SELECT chunk_index, kv_key, plaintext_size_bytes, plaintext_sha256
       FROM cpoly_backup_chunk_inventory
      WHERE backup_id = ?
      ORDER BY chunk_index ASC
      LIMIT ? OFFSET ?`
  ).bind(backupId, limit, offset).all()).results || []).map(row => ({
    chunkIndex: Number(row.chunk_index),
    kvKey: String(row.kv_key || ""),
    plaintextSizeBytes: Number(row.plaintext_size_bytes || 0),
    plaintextSha256: String(row.plaintext_sha256 || "").toLowerCase()
  }));
}

function buildBackupChunkKey(backupId, chunkIndex, versionToken = crypto.randomUUID()) {
  return [
    BACKUP_CHUNK_KEY_PREFIX,
    String(backupId || "").toLowerCase(),
    "chunks",
    String(chunkIndex).padStart(6, "0"),
    String(versionToken || "").toLowerCase()
  ].join("/");
}

function buildLegacyBackupChunkKey(backupId, chunkIndex) {
  return `legacy-d1:${String(backupId || "").toLowerCase()}:${chunkIndex}`;
}

function isLegacyBackupChunkKey(key) {
  return String(key || "").startsWith("legacy-d1:");
}

function normalizeKvArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return normalizeBinaryValue(value);
}

async function readLegacyBackupChunk(db, backupId, chunkIndex) {
  const row = await db.prepare(
    `SELECT ciphertext
       FROM cpoly_backup_chunks
      WHERE backup_id = ? AND chunk_index = ?`
  ).bind(backupId, chunkIndex).first();
  return row?.ciphertext == null ? null : normalizeBinaryValue(row.ciphertext);
}

async function readBackupChunkFromStore(env, db, backupId, chunkRecord) {
  const kvKey = String(chunkRecord?.kvKey || "");
  if (!kvKey) return null;
  if (isLegacyBackupChunkKey(kvKey)) {
    return readLegacyBackupChunk(db, backupId, chunkRecord.chunkIndex);
  }
  const store = getBackupObjectStore(env);
  if (!store) {
    throw new RecoveryRouteError("CPOLY backup object storage is unavailable.", 503);
  }
  const bytes = await store.get(kvKey, "arrayBuffer");
  return normalizeKvArrayBuffer(bytes);
}

async function putBackupChunkToStore(env, kvKey, bytes, expectedChunk) {
  const store = getBackupObjectStore(env);
  if (!store) {
    throw new RecoveryRouteError("CPOLY backup object storage is unavailable.", 503);
  }
  await store.put(kvKey, normalizeBinaryValue(bytes), {
    metadata: {
      schema: BACKUP_DESCRIPTOR_SCHEMA,
      sha256: String(expectedChunk?.sha256 || ""),
      sizeBytes: Number(expectedChunk?.sizeBytes || 0)
    }
  });
}

async function deleteBackupChunkFromStore(env, kvKey) {
  if (isLegacyBackupChunkKey(kvKey)) return true;
  const store = getBackupObjectStore(env);
  if (!store) return false;
  await store.delete(kvKey);
  return true;
}

function assertBackupChunkRecordMatchesExpected(
  backupId,
  chunkRecord,
  expectedChunk
) {
  const expectedPrefix = [
    BACKUP_CHUNK_KEY_PREFIX,
    String(backupId || "").toLowerCase(),
    "chunks",
    String(chunkRecord.chunkIndex).padStart(6, "0")
  ].join("/");
  const validVersionedKey = String(chunkRecord.kvKey || "").startsWith(
    `${expectedPrefix}/`
  );
  if (!expectedChunk
      || chunkRecord.plaintextSizeBytes !== expectedChunk.sizeBytes
      || chunkRecord.plaintextSha256 !== expectedChunk.sha256
      || (
        !validVersionedKey
        && chunkRecord.kvKey !== buildLegacyBackupChunkKey(
          backupId,
          chunkRecord.chunkIndex
        )
      )) {
    throw new RecoveryRouteError(
      "Backup chunk metadata did not match the stored descriptor.",
      409
    );
  }
}

async function verifyStoredChunkInventoryMetadata(db, backupId, storedDescriptor) {
  const archiveDescriptor = storedDescriptor.descriptor.archive;
  const inventory = await queryBackupChunkInventory(db, backupId);
  if (inventory.count !== archiveDescriptor.chunkCount
      || inventory.totalBytes !== archiveDescriptor.sizeBytes
      || (archiveDescriptor.chunkCount > 0 && inventory.minIndex !== 0)
      || (archiveDescriptor.chunkCount > 0
        && inventory.maxIndex !== archiveDescriptor.chunkCount - 1)) {
    throw new RecoveryRouteError("Backup chunk set is incomplete.", 409);
  }
  let offset = 0;
  const pageSize = 64;
  while (offset < archiveDescriptor.chunkCount) {
    const rows = await loadBackupChunkPage(db, backupId, offset, pageSize);
    if (!rows.length) {
      throw new RecoveryRouteError("Backup chunk set is incomplete.", 409);
    }
    for (const row of rows) {
      assertBackupChunkRecordMatchesExpected(
        backupId,
        row,
        storedDescriptor.descriptor.chunks[row.chunkIndex]
      );
    }
    offset += rows.length;
  }
}

async function verifyBackupStoreContents(env, db, backupId, storedDescriptor) {
  await verifyStoredChunkInventoryMetadata(db, backupId, storedDescriptor);
  const archiveDescriptor = storedDescriptor.descriptor.archive;
  const digest = createHash("sha256");
  let totalBytes = 0;
  let offset = 0;
  const pageSize = 32;
  while (offset < archiveDescriptor.chunkCount) {
    const rows = await loadBackupChunkPage(db, backupId, offset, pageSize);
    if (!rows.length) {
      throw new RecoveryRouteError("Backup chunk set is incomplete.", 409);
    }
    for (const row of rows) {
      const expectedChunk = storedDescriptor.descriptor.chunks[row.chunkIndex];
      assertBackupChunkRecordMatchesExpected(backupId, row, expectedChunk);
      const bytes = await readBackupChunkFromStore(env, db, backupId, row);
      if (bytes == null) {
        throw new RecoveryRouteError(
          "Backup chunk was missing from object storage.",
          409
        );
      }
      const actualHash = sha256HexBytes(bytes);
      if (bytes.length !== row.plaintextSizeBytes
          || actualHash !== row.plaintextSha256) {
        throw new RecoveryRouteError(
          "Backup chunk integrity verification failed.",
          409
        );
      }
      digest.update(bytes);
      totalBytes += bytes.length;
    }
    offset += rows.length;
  }
  if (totalBytes !== archiveDescriptor.sizeBytes
      || digest.digest("hex") !== archiveDescriptor.sha256) {
    throw new RecoveryRouteError(
      "Backup archive digest did not match the stored descriptor.",
      409
    );
  }
}

async function touchBackupRestoreLease(db, backupId, leaseExpiresAt) {
  await db.prepare(
    `UPDATE cpoly_backup_sets
        SET restore_lease_expires_at = ?,
            updated_at = ?
      WHERE id = ?
        AND status = 'complete'`
  ).bind(leaseExpiresAt, Date.now(), backupId).run();
}

async function markBackupFailed(db, backupId, reason, now = Date.now()) {
  await db.prepare(
    `UPDATE cpoly_backup_sets
        SET status = 'failed', updated_at = ?
      WHERE id = ? AND status = 'uploading'`
  ).bind(now, backupId).run();
  console.error("CPOLY backup set marked failed", {
    backupId,
    reason: boundErrorMessage(reason)
  });
}

async function expireBackupSet(db, backupId, now = Date.now()) {
  await db.prepare(
    `UPDATE cpoly_backup_sets
        SET status = 'expired',
            completed_at = NULL,
            updated_at = ?
      WHERE id = ?
        AND status IN ('uploading', 'failed', 'complete')`
  ).bind(now, backupId).run();
}

async function deleteBackupObjectsBestEffort(env, db, backupId) {
  const rows = await loadBackupChunkPage(
    db,
    backupId,
    0,
    Math.max(maxBackupChunks(env), 1)
  );
  let deleted = true;
  for (const row of rows) {
    try {
      await deleteBackupChunkFromStore(env, row.kvKey);
    } catch (error) {
      deleted = false;
      console.error("CPOLY backup chunk delete failed", {
        backupId,
        chunkIndex: row.chunkIndex,
        message: boundErrorMessage(error?.message)
      });
    }
  }
  return deleted;
}

function ensureUploadableBackup(backup, now) {
  if (String(backup.status) !== "uploading") {
    throw new RecoveryRouteError(
      "Backup is no longer accepting chunk uploads.",
      409
    );
  }
  if (Number(backup.expires_at || 0) <= now) {
    throw new RecoveryRouteError("Backup has expired.", 409);
  }
}

function requestedRetentionHours(body, env) {
  const fallback = backupRetentionHours(env?.CPOLY_BACKUP_RETENTION_HOURS);
  if (body?.retentionHours == null) return fallback;
  return positiveInteger(
    body.retentionHours,
    "retentionHours",
    1,
    fallback
  );
}

function maxChunkBytes(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_MAX_CHUNK_BYTES,
    DEFAULT_MAX_CHUNK_BYTES,
    1,
    HARD_MAX_CHUNK_BYTES
  );
}

function maxBackupBytes(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_MAX_BACKUP_BYTES,
    DEFAULT_MAX_BACKUP_BYTES,
    maxChunkBytes(env),
    HARD_MAX_CHUNK_BYTES * DEFAULT_MAX_BACKUP_CHUNKS
  );
}

function maxBackupChunks(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_MAX_CHUNKS,
    DEFAULT_MAX_BACKUP_CHUNKS,
    1,
    4096
  );
}

function maxRetainedBackups(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_MAX_RETAINED_BACKUPS,
    DEFAULT_MAX_RETAINED_BACKUPS,
    1,
    64
  );
}

function maxRetainedBytes(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_MAX_RETAINED_BYTES,
    DEFAULT_MAX_RETAINED_BYTES,
    maxBackupBytes(env),
    DEFAULT_MAX_BACKUP_BYTES * 64
  );
}

function staleUploadHours(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_STALE_UPLOAD_HOURS,
    DEFAULT_STALE_UPLOAD_HOURS,
    1,
    DEFAULT_BACKUP_RETENTION_HOURS * 4
  );
}

function noncePruneLimit(env) {
  return boundedInteger(
    env?.CPOLY_NONCE_PRUNE_LIMIT,
    DEFAULT_NONCE_PRUNE_LIMIT,
    10,
    1000
  );
}

function journalReplayLimit(env) {
  return boundedInteger(
    env?.CPOLY_JOURNAL_REPLAY_LIMIT,
    DEFAULT_JOURNAL_REPLAY_LIMIT,
    1,
    128
  );
}

function journalCleanupLimit(env) {
  return boundedInteger(
    env?.CPOLY_JOURNAL_CLEANUP_LIMIT,
    DEFAULT_JOURNAL_CLEANUP_LIMIT,
    1,
    256
  );
}

function kvPropagationDelayMs(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS,
    DEFAULT_KV_PROPAGATION_DELAY_MS,
    0,
    10 * 60 * 1000
  );
}

function backupAvailableAfterMs(backup, env = null) {
  const anchor = Number(
    backup?.verified_at
      ?? backup?.completed_at
      ?? backup?.updated_at
      ?? backup?.created_at
      ?? 0
  );
  return anchor + kvPropagationDelayMs(env);
}

function backupRestoreLeaseMs(env) {
  return boundedInteger(
    env?.CPOLY_BACKUP_RESTORE_LEASE_MS,
    DEFAULT_BACKUP_RESTORE_LEASE_MS,
    60_000,
    24 * 60 * 60 * 1000
  );
}

function recoveryLeaseMs(env) {
  return boundedInteger(
    env?.CPOLY_RECOVERY_LEASE_MS,
    DEFAULT_RECOVERY_LEASE_MS,
    5 * 60 * 1000,
    24 * 60 * 60 * 1000
  );
}

function backupRetentionHours(envValue) {
  return boundedInteger(
    envValue,
    DEFAULT_BACKUP_RETENTION_HOURS,
    1,
    DEFAULT_BACKUP_RETENTION_HOURS * 4
  );
}

function backupChunkPurpose(backupId, chunkIndex) {
  return `backup-chunk:${backupId}:${chunkIndex}`;
}

function positiveInteger(value, fieldName, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return parsed;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseChunkIndex(value) {
  return positiveInteger(value, "chunkIndex", 0, 4096);
}

function normalizeBackupId(value, fieldName) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(text)) {
    throw new RecoveryRouteError(`${fieldName} is invalid.`, 400);
  }
  return text;
}

function normalizeRecoverySnapshotCoverage(
  generationValue,
  watermarkValue,
  fieldPrefix
) {
  const generation = positiveInteger(
    generationValue,
    `${fieldPrefix}.generation`,
    1,
    Number.MAX_SAFE_INTEGER
  );
  const watermark = positiveInteger(
    watermarkValue,
    `${fieldPrefix}.watermark`,
    0,
    Number.MAX_SAFE_INTEGER
  );
  return {
    generation,
    watermark,
    receiptSeq: watermark
  };
}

async function deriveRecoveryKey(masterKey, purpose, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(masterKey || "")),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("CPOLY.Recovery.v1"),
      info: new TextEncoder().encode(String(purpose || "cpoly"))
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

function serializeJournalValue(value) {
  if (value === undefined || value === null) {
    return { type: "null", value: null };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { type: "number", value }
      : { type: "number", value: String(value) };
  }
  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString(10) };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (value instanceof Uint8Array
      || ArrayBuffer.isView(value)
      || value instanceof ArrayBuffer) {
    return {
      type: "blob",
      value: bytesToBase64(normalizeBinaryValue(value))
    };
  }
  return { type: "json", value: JSON.stringify(value) };
}

function deserializeJournalValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored PostgreSQL journal parameter was invalid.");
  }
  switch (value.type) {
    case "null":
      return null;
    case "string":
      return String(value.value ?? "");
    case "number":
      return typeof value.value === "number"
        ? value.value
        : Number(value.value);
    case "bigint":
      return String(value.value ?? "0");
    case "boolean":
      return Boolean(value.value);
    case "blob":
      return base64ToBytes(String(value.value || ""));
    case "json":
      return JSON.parse(String(value.value || "null"));
    default:
      throw new Error("Stored PostgreSQL journal parameter type was invalid.");
  }
}

function boundErrorMessage(message) {
  return String(message || "Recovery operation failed.").slice(0, 400);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(value) {
  return Uint8Array.from(
    String(value || "").match(/.{2}/g) || [],
    pair => Number.parseInt(pair, 16)
  );
}

function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = "";
  const normalized = normalizeBinaryValue(bytes);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...normalized.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class RecoveryRouteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RecoveryRouteError";
    this.status = status;
  }
}
