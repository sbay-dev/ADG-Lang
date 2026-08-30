import postgres from "postgres";
import {
  AMBIGUOUS_POSTGRES_WRITE_ERROR_MARKERS,
  buildJournalPayload,
  cleanupAppliedRecoveryJournal,
  constantTimeHexEqual,
  decryptRecoveryString,
  encryptRecoveryString,
  countRecoveryReplayPending,
  getRecoveryDatabase,
  insertPendingJournalEntry,
  journalMaxCiphertextBytes,
  loadRecoveryJournalCandidates,
  loadRecoveryReplayBatch,
  markJournalApplied,
  markJournalFailed,
  markJournalPending,
  parseJournalPayload,
  postgresJournalPurpose,
  requeueAmbiguousFailedJournalEntries,
  sha256HexUtf8
} from "./cpoly-recovery.js";
import {
  CPOLY_POSTGRES_EXECUTE_SCHEMA,
  CPOLY_POSTGRES_PROMOTE_PATH,
  CPOLY_POSTGRES_PROMOTE_SCHEMA,
  CPOLY_POSTGRES_QUERY_PATH,
  CPOLY_POSTGRES_RECEIPT_PATH,
  callCpolyPostgresProviderJson,
  cpolyPostgresBindingPresent,
  fetchCpolyPostgresStatus
} from "./cpoly-postgres-container.js";

const INTEGER_OIDS = new Set([20, 21, 23, 26]);
const BYTEA_OID = 17;
const DEFAULT_APPLICATION_NAME = "adg-msa-adjudication";
const POSTGRES_SEARCH_PATH = "adjudication,public";

export function hyperdriveConfigured(env) {
  return String(env?.HYPERDRIVE?.connectionString || "").trim().length > 0;
}

export function createRuntimeEnv(env) {
  if (cpolyPostgresBindingPresent(env)) {
    const recoveryDb = getRecoveryDatabase(env);
    const DB = new ContainerPostgresD1Database({
      recoveryDb,
      recoveryMasterKey: env.CPOLY_BACKUP_MASTER_KEY,
      env
    });
    return {
      ...env,
      RECOVERY_DB: recoveryDb,
      DB,
      __runtimeCleanup__: () => DB.close()
    };
  }
  if (!hyperdriveConfigured(env)) return env;
  const recoveryDb = getRecoveryDatabase(env);
  const DB = new PostgresD1Database({
    connectionString: env.HYPERDRIVE.connectionString,
    recoveryDb,
    recoveryMasterKey: env.CPOLY_BACKUP_MASTER_KEY,
    env
  });
  return {
    ...env,
    RECOVERY_DB: recoveryDb,
    DB,
    __runtimeCleanup__: () => DB.close()
  };
}

class JournaledPostgresD1Database {
  constructor(config, options = {}) {
    this.runtimeEnv = options.env ?? config?.env ?? {};
    this.recoveryDb = options.recoveryDb
      ?? config?.recoveryDb
      ?? null;
    this.recoveryMasterKey = String(
      options.recoveryMasterKey
      ?? config?.recoveryMasterKey
      ?? ""
    );
    this.requestIdFactory = options.requestIdFactory
      ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => Date.now());
    this.disableRecoveryJournal = Boolean(
      options.disableRecoveryJournal ?? config?.disableRecoveryJournal
    );
    this.journalMaxBytes = Number(
      options.journalMaxBytes
      ?? config?.journalMaxBytes
      ?? journalMaxCiphertextBytes(this.runtimeEnv)
    );
    this.closed = false;
    this.__isPostgresD1Database = true;
  }

  prepare(sql) {
    return new PostgresD1PreparedStatement(this, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.length === 0) return [];
    const operations = statements.map(statement =>
      normalizePreparedStatement(statement, this).toOperation("run"));
    return this.executeMutatingOperations(operations, "batch");
  }

  async executeMutatingOperation(operation) {
    const [result] = await this.executeMutatingOperations(
      [operation],
      "run"
    );
    return result;
  }

  async executeMutatingOperations(operations, operationKind) {
    if (this.disableRecoveryJournal) {
      return this.applyMutatingOperationsDirect(operations);
    }
    this.ensureRecoveryJournalAvailable();
    const requestId = this.requestIdFactory();
    const payload = buildJournalPayload({
      requestId,
      operationKind,
      operations
    });
    const ciphertext = await encryptRecoveryString(
      payload.json,
      this.recoveryMasterKey,
      postgresJournalPurpose()
    );
    if (ciphertext.length > this.journalMaxBytes) {
      throw new Error(
        "PostgreSQL recovery journal payload exceeded the configured D1 cap."
      );
    }
    const now = this.clock();
    await insertPendingJournalEntry(this.recoveryDb, {
      requestId,
      payloadHash: payload.hash,
      operationKind,
      statementCount: payload.statementCount,
      ciphertext
    }, now);
    try {
      const applied = await this.applyMutatingOperationsWithReceipt({
        requestId,
        payloadHash: payload.hash,
        operationKind,
        operations
      });
      try {
        await markJournalApplied(this.recoveryDb, requestId, {
          appliedAt: this.clock(),
          postgresGeneration: applied.receipt.generation,
          postgresReceiptSeq: applied.receipt.receiptSeq
        });
      } catch (error) {
        console.error("PostgreSQL journal finalize deferred", {
          requestId,
          message: error?.message
        });
      }
      return applied.results;
    } catch (error) {
      const terminalRejection = isTerminalPostgresWriteRejection(error);
      const ambiguous = !terminalRejection
        && isAmbiguousPostgresWriteError(error);
      try {
        if (ambiguous) {
          await markJournalPending(
            this.recoveryDb,
            requestId,
            journalFailureMessage(error),
            this.clock()
          );
        } else {
          await markJournalFailed(
            this.recoveryDb,
            requestId,
            journalFailureMessage(error),
            terminalRejection
              ? {
                  now: this.clock(),
                  recoveryDisposition: "terminal_rejected"
                }
              : this.clock()
          );
        }
      } catch (journalError) {
        console.error("PostgreSQL journal state update failed", {
          requestId,
          message: journalError?.message
        });
      }
      throw error;
    }
  }

  async replayRecoveryJournal({ limit = 24 } = {}) {
    if (!this.recoveryDb || !this.recoveryMasterKey) {
      return 0;
    }
    await requeueAmbiguousFailedJournalEntries(
      this.recoveryDb,
      this.clock()
    );
    const candidates = await loadRecoveryJournalCandidates(
      this.recoveryDb,
      limit
    );
    let replayed = 0;
    for (const entry of candidates) {
      try {
        const json = await decryptRecoveryString(
          entry.ciphertext,
          this.recoveryMasterKey,
          postgresJournalPurpose()
        );
        if (!constantTimeHexEqual(sha256HexUtf8(json), entry.payloadHash)) {
          throw new Error("Stored PostgreSQL journal payload hash mismatch.");
        }
        const payload = parseJournalPayload(json, entry.requestId);
        if (payload.operationKind !== entry.operationKind
            || payload.operations.length !== entry.statementCount) {
          throw new Error("Stored PostgreSQL journal metadata mismatch.");
        }
        const applied = await this.applyMutatingOperationsWithReceipt({
          requestId: entry.requestId,
          payloadHash: entry.payloadHash,
          operationKind: payload.operationKind,
          operations: payload.operations
        });
        await markJournalApplied(this.recoveryDb, entry.requestId, {
          appliedAt: this.clock(),
          postgresGeneration: applied.receipt.generation,
          postgresReceiptSeq: applied.receipt.receiptSeq
        });
        replayed += 1;
      } catch (error) {
        const definitive = error instanceof WriteReceiptConflictError
          || /Stored PostgreSQL journal/i.test(String(error?.message || ""));
        const terminalRejection = !definitive
          && isTerminalPostgresWriteRejection(error);
        try {
          if (terminalRejection) {
            await markJournalFailed(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              {
                now: this.clock(),
                recoveryDisposition: "terminal_rejected"
              }
            );
          } else if (!definitive && isAmbiguousPostgresWriteError(error)) {
            await markJournalPending(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              this.clock()
            );
          } else {
            await markJournalFailed(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              this.clock()
            );
          }
        } catch (journalError) {
          console.error("PostgreSQL journal replay state update failed", {
            requestId: entry.requestId,
            message: journalError?.message
          });
        }
        console.error("PostgreSQL journal replay item failed", {
          requestId: entry.requestId,
          message: error?.message
        });
      }
    }
    return replayed;
  }

  async cleanupRecoveryJournal({
    verifiedSnapshot = null,
    limit = 64
  } = {}) {
    if (!this.recoveryDb) return 0;
    return cleanupAppliedRecoveryJournal(this.recoveryDb, {
      verifiedSnapshot,
      limit
    });
  }

  async completeRecoveryReplay({
    snapshotCoverage,
    targetGeneration,
    limit = 24
  }) {
    if (!this.recoveryDb || !this.recoveryMasterKey) {
      throw new Error("Recovery journal is unavailable.");
    }
    await requeueAmbiguousFailedJournalEntries(
      this.recoveryDb,
      this.clock()
    );
    await this.promoteRecoveryGeneration(snapshotCoverage, targetGeneration);
    let replayed = 0;
    while (true) {
      const batch = await loadRecoveryReplayBatch(
        this.recoveryDb,
        snapshotCoverage,
        targetGeneration,
        limit
      );
      if (!batch.length) break;
      for (const entry of batch) {
        try {
          const json = await decryptRecoveryString(
            entry.ciphertext,
            this.recoveryMasterKey,
            postgresJournalPurpose()
          );
          if (!constantTimeHexEqual(sha256HexUtf8(json), entry.payloadHash)) {
            throw new Error("Stored PostgreSQL journal payload hash mismatch.");
          }
          const payload = parseJournalPayload(json, entry.requestId);
          if (payload.operationKind !== entry.operationKind
              || payload.operations.length !== entry.statementCount) {
            throw new Error("Stored PostgreSQL journal metadata mismatch.");
          }
          const applied = await this.applyMutatingOperationsWithReceipt({
            requestId: entry.requestId,
            payloadHash: entry.payloadHash,
            operationKind: payload.operationKind,
            operations: payload.operations,
            forcedGeneration: targetGeneration
          });
          await markJournalApplied(this.recoveryDb, entry.requestId, {
            appliedAt: this.clock(),
            postgresGeneration: applied.receipt.generation,
            postgresReceiptSeq: applied.receipt.receiptSeq
          });
          replayed += 1;
        } catch (error) {
          const definitive = error instanceof WriteReceiptConflictError
            || /Stored PostgreSQL journal/i.test(String(error?.message || ""));
          const terminalRejection = !definitive
            && isTerminalPostgresWriteRejection(error);
          if (terminalRejection) {
            await markJournalFailed(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              {
                now: this.clock(),
                recoveryDisposition: "terminal_rejected"
              }
            );
            continue;
          }
          if (!definitive && isAmbiguousPostgresWriteError(error)) {
            await markJournalPending(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              this.clock()
            );
          } else {
            await markJournalFailed(
              this.recoveryDb,
              entry.requestId,
              journalFailureMessage(error),
              this.clock()
            );
          }
          throw error;
        }
      }
    }
    const pending = await countRecoveryReplayPending(
      this.recoveryDb,
      snapshotCoverage,
      targetGeneration
    );
    const receipt = await this.getCurrentReceiptWatermark();
    return {
      generation: receipt.generation,
      receiptSeq: receipt.receiptSeq,
      replayed,
      pending
    };
  }

  ensureRecoveryJournalAvailable() {
    if (this.disableRecoveryJournal) return;
    if (!this.recoveryDb || typeof this.recoveryDb.prepare !== "function") {
      throw new Error(
        "PostgreSQL writes are blocked because the D1 recovery journal is unavailable."
      );
    }
    if (!this.recoveryMasterKey) {
      throw new Error(
        "PostgreSQL writes are blocked because CPOLY_BACKUP_MASTER_KEY is missing."
      );
    }
  }
}

export class PostgresD1Database extends JournaledPostgresD1Database {
  constructor(config, options = {}) {
    super(config, options);
    const connectionString = resolveConnectionString(config);
    if (!connectionString) {
      throw new Error("Hyperdrive connectionString is missing.");
    }
    this.client = postgres(connectionString, {
      max: Number(options.max ?? 1),
      prepare: options.prepare ?? true,
      fetch_types: options.fetchTypes ?? false,
      idle_timeout: Number(options.idleTimeout ?? 20),
      max_lifetime: Number(options.maxLifetime ?? 60),
      connection: {
        application_name: String(
          options.applicationName || DEFAULT_APPLICATION_NAME
        ),
        search_path: POSTGRES_SEARCH_PATH
      }
    });
  }

  async executeReadOperation(operation, client = this.client) {
    const sql = translateSqliteSqlToPostgres(
      operation.sql,
      operation.params
    );
    const params = normalizeParameters(operation.params);
    const result = await client.unsafe(sql, params, { prepare: true });
    return normalizeAllResult(result);
  }

  async executeMutatingOperation(operation) {
    return super.executeMutatingOperation(operation);
  }

  async applyMutatingOperationsWithReceipt({
    requestId,
    payloadHash,
    operationKind,
    operations,
    forcedGeneration = null
  }) {
    const appliedAt = this.clock();
    return this.client.begin(async transaction => {
      const currentGeneration = await this.getCurrentGeneration(
        transaction,
        true
      );
      const generation = forcedGeneration == null
        ? currentGeneration
        : Number(forcedGeneration);
      if (forcedGeneration != null && currentGeneration !== generation) {
        throw new Error(
          `PostgreSQL recovery generation mismatch: expected ${generation} but found ${currentGeneration}.`
        );
      }
      const claim = await transaction.unsafe(
        `INSERT INTO cpoly_write_receipts
          (generation, request_id, payload_hash, operation_kind, statement_count, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING receipt_seq, generation, request_id`,
        [
          generation,
          requestId,
          payloadHash,
          operationKind,
          operations.length,
          appliedAt
        ],
        { prepare: true }
      );
      if (Number(claim.count || 0) !== 1) {
        const existing = Array.from(await transaction.unsafe(
          `SELECT payload_hash, operation_kind, statement_count,
                  generation, receipt_seq
             FROM cpoly_write_receipts
            WHERE request_id = $1`,
          [requestId],
          { prepare: true }
        ));
        const row = existing[0];
        if (!row
            || row.payload_hash !== payloadHash
            || row.operation_kind !== operationKind
            || Number(row.statement_count || 0) !== operations.length) {
          throw new WriteReceiptConflictError(
            `PostgreSQL write receipt conflict for request ${requestId}.`
          );
        }
        return {
          results: zeroResultsForOperations(operations),
          receipt: {
            generation: Number(row.generation),
            receiptSeq: Number(row.receipt_seq)
          }
        };
      }
      const receiptRow = Array.from(claim)[0];
      const results = [];
      for (const operation of operations) {
        const mode = normalizeStatementMode(operation.mode, operation.sql);
        if (mode !== "run") {
          throw new Error("Mutating PostgreSQL journal entries must not contain reads.");
        }
        results.push(await executeTranslatedOperation(operation, transaction));
      }
      return {
        results,
        receipt: {
          generation: Number(receiptRow.generation),
          receiptSeq: Number(receiptRow.receipt_seq)
        }
      };
    });
  }

  async applyMutatingOperationsDirect(operations) {
    return this.client.begin(async transaction => {
      const results = [];
      for (const operation of operations) {
        results.push(await executeTranslatedOperation(operation, transaction));
      }
      return results;
    });
  }

  async replayRecoveryJournal({ limit = 24 } = {}) {
    return super.replayRecoveryJournal({ limit });
  }

  async cleanupRecoveryJournal({
    verifiedSnapshot = null,
    limit = 64
  } = {}) {
    return super.cleanupRecoveryJournal({ verifiedSnapshot, limit });
  }

  async completeRecoveryReplay({
    snapshotCoverage,
    targetGeneration,
    limit = 24
  }) {
    return super.completeRecoveryReplay({
      snapshotCoverage,
      targetGeneration,
      limit
    });
  }

  async promoteRecoveryGeneration(snapshotCoverage, targetGeneration) {
    await this.client.begin(async transaction => {
      const currentGeneration = await this.getCurrentGeneration(
        transaction,
        true
      );
      const currentReceipt = await this.getGlobalReceiptWatermark(transaction);
      if (currentGeneration === Number(targetGeneration)) {
        return;
      }
      if (currentGeneration !== Number(snapshotCoverage.generation)) {
        throw new Error(
          `PostgreSQL recovery generation mismatch: expected snapshot generation ${snapshotCoverage.generation} but found ${currentGeneration}.`
        );
      }
      if (currentReceipt < Number(snapshotCoverage.watermark)) {
        throw new Error(
          `PostgreSQL receipt watermark ${currentReceipt} did not cover snapshot watermark ${snapshotCoverage.watermark}.`
        );
      }
      await transaction.unsafe(
        `UPDATE cpoly_runtime_state
            SET current_generation = $1,
                updated_at = $2
          WHERE singleton = TRUE`,
        [Number(targetGeneration), this.clock()],
        { prepare: true }
      );
    });
  }

  async getCurrentReceiptWatermark() {
    return this.client.begin(async transaction => {
      const generation = await this.getCurrentGeneration(transaction, false);
      const receiptSeq = await this.getGlobalReceiptWatermark(transaction);
      return { generation, receiptSeq };
    });
  }

  async getCurrentGeneration(transaction, forUpdate = false) {
    const rows = Array.from(await transaction.unsafe(
      `SELECT current_generation
         FROM cpoly_runtime_state
        WHERE singleton = TRUE${forUpdate ? " FOR UPDATE" : ""}`,
      [],
      { prepare: true }
    ));
    const row = rows[0];
    if (!row) {
      throw new Error("PostgreSQL CPOLY runtime state is missing.");
    }
    return Number(row.current_generation);
  }

  async getGlobalReceiptWatermark(transaction) {
    const rows = Array.from(await transaction.unsafe(
      `SELECT COALESCE(MAX(receipt_seq), 0) AS receipt_seq
         FROM cpoly_write_receipts`,
      [],
      { prepare: true }
    ));
    return Number(rows[0]?.receipt_seq || 0);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.client.end();
  }
}

export class ContainerPostgresD1Database extends JournaledPostgresD1Database {
  constructor(config = {}, options = {}) {
    super(config, options);
    this.__isContainerPostgresD1Database = true;
  }

  async executeReadOperation(operation) {
    const payload = await callCpolyPostgresProviderJson(
      this.runtimeEnv,
      CPOLY_POSTGRES_QUERY_PATH,
      {
        method: "POST",
        json: buildContainerExecuteRequest({
          operations: [operation],
          operationKind: "read"
        })
      }
    );
    return normalizeContainerAllResult(payload, 1);
  }

  async applyMutatingOperationsWithReceipt({
    requestId,
    payloadHash,
    operationKind,
    operations,
    forcedGeneration = null
  }) {
    try {
      const payload = await callCpolyPostgresProviderJson(
        this.runtimeEnv,
        CPOLY_POSTGRES_QUERY_PATH,
        {
          method: "POST",
          json: buildContainerExecuteRequest({
            requestId,
            payloadHash,
            operationKind,
            operations,
            expectedGeneration: forcedGeneration
          })
        }
      );
      return {
        results: normalizeContainerRunResults(payload, operations.length),
        receipt: normalizeProviderReceipt(payload?.receipt)
      };
    } catch (error) {
      const normalized = normalizeContainerProviderWriteError(error);
      await attachContainerProviderDiagnostic(normalized, this.runtimeEnv);
      throw normalized;
    }
  }

  async applyMutatingOperationsDirect(operations) {
    const payload = await callCpolyPostgresProviderJson(
      this.runtimeEnv,
      CPOLY_POSTGRES_QUERY_PATH,
      {
        method: "POST",
        json: buildContainerExecuteRequest({
          operationKind: operations.length > 1 ? "batch" : "run",
          operations
        })
      }
    );
    return normalizeContainerRunResults(payload, operations.length);
  }

  async promoteRecoveryGeneration(snapshotCoverage, targetGeneration) {
    const payload = await callCpolyPostgresProviderJson(
      this.runtimeEnv,
      CPOLY_POSTGRES_PROMOTE_PATH,
      {
        method: "POST",
        json: {
          schema: CPOLY_POSTGRES_PROMOTE_SCHEMA,
          snapshotCoverage: {
            generation: Number(snapshotCoverage?.generation),
            watermark: Number(snapshotCoverage?.watermark)
          },
          targetGeneration: Number(targetGeneration)
        }
      }
    );
    const receipt = normalizeProviderReceipt(payload?.receipt);
    if (receipt.generation !== Number(targetGeneration)) {
      throw new Error(
        `CPOLY provider promoted generation ${receipt.generation}, expected ${targetGeneration}.`
      );
    }
  }

  async getCurrentReceiptWatermark() {
    const payload = await callCpolyPostgresProviderJson(
      this.runtimeEnv,
      CPOLY_POSTGRES_RECEIPT_PATH,
      { method: "GET" }
    );
    return normalizeProviderReceipt(payload?.receipt);
  }

  async close() {
    this.closed = true;
  }
}

class PostgresD1PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = String(sql);
    this.params = [...params];
  }

  bind(...params) {
    return new PostgresD1PreparedStatement(this.database, this.sql, params);
  }

  async first() {
    const result = await this.database.executeReadOperation(
      this.toOperation("all")
    );
    return result.results[0] ?? null;
  }

  async all() {
    return this.database.executeReadOperation(this.toOperation("all"));
  }

  async run() {
    return this.database.executeMutatingOperation(this.toOperation("run"));
  }

  toOperation(mode = inferStatementMode(this.sql)) {
    return {
      mode,
      sql: this.sql,
      params: this.params
    };
  }
}

export function inferStatementMode(sql) {
  const match = /^\s*([a-z]+)/iu.exec(String(sql || ""));
  const keyword = String(match?.[1] || "").toUpperCase();
  if (["SELECT", "PRAGMA", "EXPLAIN", "WITH"].includes(keyword)) {
    return "all";
  }
  return "run";
}

export function translateSqliteSqlToPostgres(sql, params = []) {
  const normalized = rewriteInsertOrIgnore(String(sql || ""));
  return replaceSqlitePlaceholders(normalized, params);
}

function resolveConnectionString(config) {
  if (typeof config === "string") return config.trim();
  if (config?.connectionString) {
    return String(config.connectionString).trim();
  }
  if (config?.HYPERDRIVE?.connectionString) {
    return String(config.HYPERDRIVE.connectionString).trim();
  }
  return "";
}

function normalizePreparedStatement(statement, database) {
  if (statement instanceof PostgresD1PreparedStatement) {
    return statement;
  }
  if (statement
      && typeof statement.sql === "string"
      && Array.isArray(statement.params)) {
    return new PostgresD1PreparedStatement(
      database,
      statement.sql,
      statement.params
    );
  }
  throw new TypeError("PostgresD1Database.batch expects prepared statements.");
}

function normalizeStatementMode(mode, sql) {
  const value = String(mode || inferStatementMode(sql)).toLowerCase();
  return value === "first" || value === "all"
    ? "all"
    : "run";
}

function normalizeParameters(params) {
  return Array.isArray(params)
    ? params.map(normalizeParameter)
    : [];
}

function buildContainerExecuteRequest({
  requestId = null,
  payloadHash = null,
  operationKind = "read",
  operations = [],
  expectedGeneration = null
}) {
  const normalizedOperations = operations.map(operation => ({
    mode: normalizeStatementMode(operation.mode, operation.sql),
    sql: translateSqliteSqlToPostgres(operation.sql, operation.params),
    params: encodeProviderParameters(normalizeParameters(operation.params))
  }));
  return {
    schema: CPOLY_POSTGRES_EXECUTE_SCHEMA,
    requestId: requestId == null ? null : String(requestId),
    payloadHash: payloadHash == null ? null : String(payloadHash),
    operationKind: String(operationKind || "read"),
    statementCount: normalizedOperations.length,
    transaction: normalizedOperations.some(
      operation => operation.mode === "run"
    ),
    expectedGeneration: expectedGeneration == null
      ? null
      : Number(expectedGeneration),
    operations: normalizedOperations
  };
}

function encodeProviderParameters(params) {
  return Array.isArray(params)
    ? params.map(encodeProviderParameter)
    : [];
}

function encodeProviderParameter(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") {
    return {
      __adgType: "bigint",
      value: value.toString(10)
    };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      __adgType: "bytes-base64",
      value: Buffer.from(value).toString("base64")
    };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      __adgType: "bytes-base64",
      value: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength
      ).toString("base64")
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      __adgType: "bytes-base64",
      value: Buffer.from(value).toString("base64")
    };
  }
  if (Array.isArray(value)) {
    return value.map(encodeProviderParameter);
  }
  if (value && typeof value === "object") {
    const encoded = {};
    for (const [key, item] of Object.entries(value)) {
      encoded[key] = encodeProviderParameter(item);
    }
    return encoded;
  }
  return value;
}

function normalizeParameter(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString(10);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  return value;
}

function normalizeContainerAllResult(payload, expectedCount) {
  const [result] = normalizeContainerResultList(payload, expectedCount, "all");
  return {
    success: true,
    results: result.results,
    meta: {
      changes: Number(result.meta?.changes || 0)
    }
  };
}

function normalizeContainerRunResults(payload, expectedCount) {
  return normalizeContainerResultList(payload, expectedCount, "run")
    .map(result => ({
      success: true,
      meta: {
        changes: Number(result.meta?.changes || 0),
        last_row_id: Number(result.meta?.last_row_id || 0)
      }
    }));
}

function normalizeContainerResultList(payload, expectedCount, expectedMode) {
  const results = Array.isArray(payload?.results) ? payload.results : null;
  if (!results || results.length !== expectedCount) {
    throw new Error(
      `CPOLY provider returned ${results?.length ?? 0} results, expected ${expectedCount}.`
    );
  }
  return results.map((result, index) =>
    normalizeContainerResult(result, expectedMode, index));
}

function normalizeContainerResult(result, expectedMode, index) {
  if (!result || result.success !== true) {
    throw new Error(
      `CPOLY provider result ${index} was unsuccessful or malformed.`
    );
  }
  const meta = {
    changes: Number(result.meta?.changes || 0),
    last_row_id: Number(result.meta?.last_row_id || 0)
  };
  if (expectedMode === "all") {
    if (!Array.isArray(result.results)) {
      throw new Error(
        `CPOLY provider read result ${index} did not include a results array.`
      );
    }
    return {
      success: true,
      results: result.results.map(normalizeProviderRow),
      meta
    };
  }
  return {
    success: true,
    meta
  };
}

function normalizeProviderRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("CPOLY provider returned a non-object row.");
  }
  return { ...row };
}

function normalizeProviderReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("CPOLY provider receipt payload was invalid.");
  }
  const generation = Number(receipt.generation);
  const receiptSeq = Number(receipt.receiptSeq);
  if (!Number.isFinite(generation) || generation < 1) {
    throw new Error("CPOLY provider generation was invalid.");
  }
  if (!Number.isFinite(receiptSeq) || receiptSeq < 0) {
    throw new Error("CPOLY provider receipt sequence was invalid.");
  }
  return { generation, receiptSeq };
}

function normalizeContainerProviderWriteError(error) {
  if (Number(error?.status || 0) === 409
      && String(error?.code || "").toLowerCase() === "write_receipt_conflict") {
    return new WriteReceiptConflictError(error.message);
  }
  return error;
}

async function attachContainerProviderDiagnostic(error, env) {
  if (Number(error?.status || 0) < 500) return;
  try {
    const status = await fetchCpolyPostgresStatus(env, {
      forceRefresh: true
    });
    const detail = String(status?.lastError || "").trim();
    if (detail) {
      error.providerLastError = detail.slice(0, 1000);
    }
  } catch (diagnosticError) {
    console.error("CPOLY provider diagnostic probe failed", {
      name: diagnosticError?.name,
      message: diagnosticError?.message
    });
  }
}

function journalFailureMessage(error) {
  return String(
    error?.providerLastError
    || error?.message
    || error
  );
}

function normalizeAllResult(result) {
  return {
    results: normalizeRows(result),
    success: true,
    meta: { changes: 0 }
  };
}

function normalizeRunResult(result) {
  return {
    success: true,
    meta: {
      changes: Number(result?.count || 0),
      last_row_id: 0
    }
  };
}

function normalizeRows(result) {
  const columns = Array.isArray(result?.columns) ? result.columns : [];
  const typeByName = new Map(columns.map(column => [column.name, column.type]));
  return Array.from(result || [], row => {
    const normalized = {};
    for (const [key, value] of Object.entries(row || {})) {
      normalized[key] = normalizeValue(value, typeByName.get(key));
    }
    return normalized;
  });
}

function normalizeValue(value, typeOid) {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString(10);
  }
  if (typeof value === "string"
      && INTEGER_OIDS.has(Number(typeOid))
      && /^-?\d+$/u.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value;
  }
  if (Buffer.isBuffer(value) && Number(typeOid) === BYTEA_OID) {
    return new Uint8Array(value);
  }
  return value;
}

function rewriteInsertOrIgnore(sql) {
  if (!/^\s*INSERT\s+OR\s+IGNORE\b/iu.test(sql)) return sql;
  const trailingSemicolon = /;\s*$/u.exec(sql)?.[0] || "";
  const body = trailingSemicolon
    ? sql.slice(0, -trailingSemicolon.length)
    : sql;
  const rewritten = body.replace(
    /^\s*INSERT\s+OR\s+IGNORE\b/iu,
    match => match.replace(/OR\s+IGNORE\b/iu, "")
  );
  return `${rewritten} ON CONFLICT DO NOTHING${trailingSemicolon}`;
}

function replaceSqlitePlaceholders(sql, params = []) {
  let parameterIndex = 0;
  let state = "normal";
  let result = "";

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (state === "line-comment") {
      result += current;
      if (current === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      result += current;
      if (current === "*" && next === "/") {
        result += next;
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (state === "single-quote") {
      result += current;
      if (current === "'" && next === "'") {
        result += next;
        index += 1;
      } else if (current === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      result += current;
      if (current === '"' && next === '"') {
        result += next;
        index += 1;
      } else if (current === '"') {
        state = "normal";
      }
      continue;
    }

    if (current === "-" && next === "-") {
      result += current + next;
      index += 1;
      state = "line-comment";
      continue;
    }

    if (current === "/" && next === "*") {
      result += current + next;
      index += 1;
      state = "block-comment";
      continue;
    }

    if (current === "'") {
      result += current;
      state = "single-quote";
      continue;
    }

    if (current === '"') {
      result += current;
      state = "double-quote";
      continue;
    }

    if (current === "?") {
      parameterIndex += 1;
      result += placeholderForValue(
        parameterIndex,
        Array.isArray(params) ? params[parameterIndex - 1] : undefined
      );
      continue;
    }

    result += current;
  }

  return result;
}

function placeholderForValue(index, value) {
  if (typeof value === "bigint") {
    return `CAST($${index} AS BIGINT)`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? `CAST($${index} AS BIGINT)`
      : `CAST($${index} AS DOUBLE PRECISION)`;
  }
  return `$${index}`;
}

async function executeTranslatedOperation(operation, client) {
  const sql = translateSqliteSqlToPostgres(operation.sql, operation.params);
  const params = normalizeParameters(operation.params);
  const result = await client.unsafe(sql, params, { prepare: true });
  return normalizeRunResult(result);
}

function zeroResultsForOperations(operations) {
  return operations.map(() => ({
    success: true,
    meta: {
      changes: 0,
      last_row_id: 0
    }
  }));
}

function isAmbiguousPostgresWriteError(error) {
  if (error instanceof WriteReceiptConflictError) return false;
  if (Boolean(error?.retryable)) return true;
  const status = Number(error?.status || 0);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }
  const code = String(error?.code || "");
  if (code && /^[0-9A-Z]{5}$/u.test(code)) {
    return code.startsWith("08")
      || code === "57P01"
      || code === "57P02"
      || code === "57P03";
  }
  const message = String(error?.message || "").toLowerCase();
  return AMBIGUOUS_POSTGRES_WRITE_ERROR_MARKERS.some(
    marker => message.includes(marker)
  );
}

function isTerminalPostgresWriteRejection(error) {
  if (error instanceof WriteReceiptConflictError) return false;
  const code = String(error?.code || "").toUpperCase();
  if (/^23[0-9A-Z]{3}$/u.test(code)) return true;
  const diagnostic = String(error?.providerLastError || "").toLowerCase();
  return diagnostic.includes("duplicate key value violates unique constraint")
    || diagnostic.includes("violates foreign key constraint")
    || diagnostic.includes("violates not-null constraint")
    || diagnostic.includes("violates check constraint")
    || diagnostic.includes("violates exclusion constraint");
}

class WriteReceiptConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "WriteReceiptConflictError";
  }
}
