import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import postgres from "postgres";

const EXECUTE_SCHEMA = "adg.cpoly-postgres.execute.v1";
const STATUS_SCHEMA = "adg.cpoly-postgres.status.v1";
const RECEIPT_SCHEMA = "adg.cpoly-postgres.receipt-watermark.v1";
const PROMOTE_SCHEMA = "adg.cpoly-postgres.promote-generation.v1";
const KEEPALIVE_SCHEMA = "adg.cpoly-postgres.keepalive.v1";
const BACKUP_SCHEMA = "adg.cpoly-postgres.backup-trigger.v1";

const paths = {
  status: "/api/internal/postgres/v1/status",
  query: "/api/internal/postgres/v1/query",
  receipt: "/api/internal/postgres/v1/runtime/receipt-watermark",
  promote: "/api/internal/postgres/v1/runtime/promote-generation",
  keepalive: "/api/internal/postgres/v1/runtime/keepalive",
  backup: "/api/internal/postgres/v1/backups/trigger"
};

const port = boundedInteger(
  process.env.CPOLY_POSTGRES_PROVIDER_PORT || process.env.PORT,
  18444,
  1,
  65535
);
const token = required(
  process.env.CPOLY_POSTGRES_INTERNAL_TOKEN
    || process.env.CPOLY_DB_BRIDGE_TOKEN,
  "CPOLY_POSTGRES_INTERNAL_TOKEN"
);
const runtimePassword = required(process.env.ADG_RUNTIME_PASSWORD, "ADG_RUNTIME_PASSWORD");
const maxBodyBytes = boundedInteger(
  process.env.CPOLY_DB_BRIDGE_MAX_BODY_BYTES,
  1024 * 1024,
  1024,
  4 * 1024 * 1024
);
const maxOperations = boundedInteger(
  process.env.CPOLY_DB_BRIDGE_MAX_OPERATIONS,
  64,
  1,
  256
);
const instanceId = String(
  process.env.CPOLY_POSTGRES_INSTANCE_ID || "standard-1"
);

const sql = postgres({
  host: process.env.PGHOST || "/var/run/postgresql",
  database: process.env.PGDATABASE || "adg_adjudication",
  username: process.env.PGUSER || "adg_runtime",
  password: runtimePassword,
  max: 4,
  prepare: false,
  idle_timeout: 20,
  max_lifetime: 300,
  connection: { application_name: "adg-cpoly-container-provider" }
});

let backupProcess = null;
let backupStatus = {
  state: "never",
  reason: null,
  startedAt: null,
  completedAt: null,
  exitCode: null
};
let lastError = null;

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) {
      return sendError(response, 401, "unauthorized", "Bearer token is invalid.");
    }
    const url = new URL(request.url, "http://container.internal");
    if (request.method === "GET" && url.pathname === paths.status) {
      return sendJson(response, 200, await statusPayload(STATUS_SCHEMA));
    }
    if (request.method === "POST" && url.pathname === paths.keepalive) {
      const body = await readJson(request);
      requireSchema(body, KEEPALIVE_SCHEMA);
      return sendJson(response, 200, await statusPayload(KEEPALIVE_SCHEMA));
    }
    if (request.method === "GET" && url.pathname === paths.receipt) {
      return sendJson(response, 200, {
        ok: true,
        schema: RECEIPT_SCHEMA,
        receipt: await receiptWatermark()
      });
    }
    if (request.method === "POST" && url.pathname === paths.promote) {
      const body = await readJson(request);
      requireSchema(body, PROMOTE_SCHEMA);
      return sendJson(response, 200, {
        ok: true,
        schema: PROMOTE_SCHEMA,
        receipt: await promoteGeneration(body)
      });
    }
    if (request.method === "POST" && url.pathname === paths.query) {
      return sendJson(response, 200, await execute(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === paths.backup) {
      const body = await readJson(request);
      requireSchema(body, BACKUP_SCHEMA);
      if (backupProcess && backupProcess.exitCode == null) {
        return sendJson(response, 202, {
          accepted: true,
          schema: BACKUP_SCHEMA,
          status: (await statusPayload(BACKUP_SCHEMA)).status,
          backup: { state: "running", reason: backupStatus.reason, backupId: null }
        });
      }
      startBackup(
        String(body.reason || "on-demand"),
        normalizeBackupOrigin(
          body.backupApiBaseUrl || process.env.CPOLY_BACKUP_BASE_URL
        )
      );
      return sendJson(response, 202, {
        accepted: true,
        schema: BACKUP_SCHEMA,
        status: (await statusPayload(BACKUP_SCHEMA)).status,
        backup: { state: "queued", reason: backupStatus.reason, backupId: null }
      });
    }
    return sendError(response, 404, "not_found", "Provider path was not found.");
  } catch (error) {
    if (error instanceof ProviderError) {
      return sendError(response, error.status, error.code, error.message);
    }
    lastError = String(error?.message || error);
    console.error("CPOLY PostgreSQL provider failed", {
      path: request.url,
      message: lastError
    });
    return sendError(response, 500, "internal_error", "Provider request failed.");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CPOLY PostgreSQL provider listening on ${port}`);
});

async function execute(body) {
  requireSchema(body, EXECUTE_SCHEMA);
  const operationKind = String(body.operationKind || "read");
  if (!["read", "run", "batch"].includes(operationKind)
      || !Array.isArray(body.operations)
      || body.operations.length < 1
      || body.operations.length > maxOperations
      || Number(body.statementCount) !== body.operations.length) {
    throw new ProviderError("execute_invalid", 400, "Execute payload is invalid.");
  }
  const operations = body.operations.map(normalizeOperation);
  const transactionRequired = Boolean(body.transaction);
  const mutating = operations.some(operation => operation.mode === "run");
  if (transactionRequired !== mutating) {
    throw new ProviderError(
      "transaction_flag_invalid",
      400,
      "Transaction flag did not match operation modes."
    );
  }
  const requestId = body.requestId == null ? null : String(body.requestId);
  const payloadHash = body.payloadHash == null ? null : String(body.payloadHash);
  if (mutating && requestId != null
      && (!isUuidV4(requestId) || !/^[0-9a-f]{64}$/u.test(payloadHash))) {
    throw new ProviderError(
      "request_identity_invalid",
      400,
      "Mutating request identity is invalid."
    );
  }
  if (body.expectedGeneration != null
      && (!Number.isInteger(Number(body.expectedGeneration))
        || Number(body.expectedGeneration) < 1)) {
    throw new ProviderError(
      "expected_generation_invalid",
      400,
      "Expected generation is invalid."
    );
  }
  return await sql.begin(async transaction => {
    const generation = await currentGeneration(transaction, mutating);
    if (body.expectedGeneration != null
        && generation !== Number(body.expectedGeneration)) {
      throw new ProviderError(
        "generation_conflict",
        409,
        "PostgreSQL generation did not match the expected generation."
      );
    }
    let receipt = null;
    if (mutating && requestId) {
      receipt = await claimReceipt(transaction, {
        generation,
        requestId,
        payloadHash,
        operationKind,
        statementCount: operations.length
      });
      if (receipt.idempotent) {
        return {
          ok: true,
          schema: EXECUTE_SCHEMA,
          results: operations.map(operation => operation.mode === "all"
            ? { success: true, results: [], meta: { changes: 0 } }
            : { success: true, meta: { changes: 0, last_row_id: 0 } }),
          receipt: {
            generation: receipt.generation,
            receiptSeq: receipt.receiptSeq
          }
        };
      }
    }
    const results = [];
    for (const operation of operations) {
      const result = await transaction.unsafe(
        operation.sql,
        operation.params,
        { prepare: true }
      );
      results.push(operation.mode === "all"
        ? {
            success: true,
            results: Array.from(result).map(serializeRow),
            meta: { changes: 0 }
          }
        : {
            success: true,
            meta: { changes: Number(result.count || 0), last_row_id: 0 }
          });
    }
    return {
      ok: true,
      schema: EXECUTE_SCHEMA,
      results,
      receipt: receipt
        ? { generation: receipt.generation, receiptSeq: receipt.receiptSeq }
        : null
    };
  });
}

async function claimReceipt(transaction, values) {
  const inserted = await transaction`
    INSERT INTO adjudication.cpoly_write_receipts
      (generation, request_id, payload_hash, operation_kind,
       statement_count, applied_at)
    VALUES
      (${values.generation}, ${values.requestId}, ${values.payloadHash},
       ${values.operationKind}, ${values.statementCount}, ${Date.now()})
    ON CONFLICT DO NOTHING
    RETURNING receipt_seq, generation
  `;
  if (inserted.length) {
    return {
      idempotent: false,
      generation: Number(inserted[0].generation),
      receiptSeq: Number(inserted[0].receipt_seq)
    };
  }
  const existing = await transaction`
    SELECT generation, receipt_seq, payload_hash, operation_kind,
           statement_count
      FROM adjudication.cpoly_write_receipts
     WHERE request_id = ${values.requestId}
  `;
  const row = existing[0];
  if (!row || row.payload_hash !== values.payloadHash
      || row.operation_kind !== values.operationKind
      || Number(row.statement_count) !== values.statementCount) {
    throw new ProviderError(
      "write_receipt_conflict",
      409,
      "Write receipt conflicts with an existing request."
    );
  }
  return {
    idempotent: true,
    generation: Number(row.generation),
    receiptSeq: Number(row.receipt_seq)
  };
}

async function promoteGeneration(body) {
  const coverage = body.snapshotCoverage;
  const target = Number(body.targetGeneration);
  if (!coverage || !Number.isInteger(target) || target < 1
      || !Number.isInteger(Number(coverage.generation))
      || !Number.isInteger(Number(coverage.watermark))) {
    throw new ProviderError(
      "promotion_invalid",
      400,
      "Recovery promotion payload is invalid."
    );
  }
  return await sql.begin(async transaction => {
    const current = await currentGeneration(transaction, true);
    const watermark = await receiptForGeneration(transaction, current);
    if (current !== target) {
      if (current !== Number(coverage.generation)
          || watermark < Number(coverage.watermark)) {
        throw new ProviderError(
          "promotion_conflict",
          409,
          "Snapshot coverage cannot be promoted."
        );
      }
      await transaction`
        UPDATE adjudication.cpoly_runtime_state
           SET current_generation = ${target}, updated_at = ${Date.now()}
         WHERE singleton = TRUE
      `;
    }
    return {
      generation: target,
      receiptSeq: await receiptForGeneration(transaction, target)
    };
  });
}

async function receiptWatermark() {
  return await sql.begin(async transaction => {
    const generation = await currentGeneration(transaction, false);
    return {
      generation,
      receiptSeq: await receiptForGeneration(transaction, generation)
    };
  });
}

async function currentGeneration(transaction, lock) {
  const result = await transaction.unsafe(
    `SELECT current_generation
       FROM adjudication.cpoly_runtime_state
      WHERE singleton = TRUE${lock ? " FOR UPDATE" : ""}`,
    [],
    { prepare: true }
  );
  const generation = Number(result[0]?.current_generation || 0);
  if (generation < 1) {
    throw new ProviderError(
      "generation_missing",
      503,
      "PostgreSQL runtime generation is missing."
    );
  }
  return generation;
}

async function receiptForGeneration(transaction, generation) {
  const rows = await transaction`
    SELECT COALESCE(MAX(receipt_seq), 0) AS receipt_seq
      FROM adjudication.cpoly_write_receipts
     WHERE generation = ${generation}
  `;
  return Number(rows[0]?.receipt_seq || 0);
}

async function statusPayload(schema) {
  let recovery;
  try {
    recovery = await readRecoveryState();
  } catch {
    recovery = {
      ready: false,
      workerStatus: "starting",
      generation: null,
      receiptSeq: null,
      snapshotGeneration: null,
      postgresReceiptWatermark: null
    };
  }
  const state = recovery.ready ? "ready" : "restoring";
  return {
    ok: true,
    schema,
    status: {
      instanceId,
      state,
      ready: recovery.ready,
      currentGeneration: recovery.generation,
      receiptWatermark: recovery.receiptSeq,
      restoreBackupId: null,
      restoreSnapshotGeneration: recovery.snapshotGeneration,
      restoreSnapshotWatermark: recovery.postgresReceiptWatermark,
      lastBackupId: null,
      backupInProgress: backupProcess?.exitCode == null && backupProcess != null,
      lastError
    }
  };
}

async function readRecoveryState() {
  const rows = await sql`
    SELECT gate.ready, gate.worker_status, gate.snapshot_generation,
           gate.postgres_receipt_watermark, runtime.current_generation,
           COALESCE(MAX(receipt.receipt_seq), 0) AS receipt_seq
      FROM adjudication.cpoly_recovery_state AS gate
      JOIN adjudication.cpoly_runtime_state AS runtime
        ON runtime.singleton = gate.singleton
      LEFT JOIN adjudication.cpoly_write_receipts AS receipt
        ON receipt.generation = runtime.current_generation
     WHERE gate.singleton = TRUE
     GROUP BY gate.ready, gate.worker_status, gate.snapshot_generation,
              gate.postgres_receipt_watermark, runtime.current_generation
  `;
  const row = rows[0];
  return {
    ready: Boolean(row?.ready) && row?.worker_status === "ready",
    workerStatus: row?.worker_status || "not_ready",
    snapshotGeneration: Number(row?.snapshot_generation || 0),
    postgresReceiptWatermark: Number(row?.postgres_receipt_watermark || 0),
    generation: Number(row?.current_generation || 0),
    receiptSeq: Number(row?.receipt_seq || 0)
  };
}

function startBackup(reason, backupOrigin) {
  backupStatus = {
    state: "running",
    reason,
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null
  };
  backupProcess = spawn("/opt/cpoly/bin/backup-now.sh", [], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      CPOLY_BACKUP_BASE_URL: backupOrigin
    }
  });
  backupProcess.once("exit", code => {
    backupStatus = {
      ...backupStatus,
      state: code === 0 ? "complete" : "failed",
      completedAt: new Date().toISOString(),
      exitCode: Number(code ?? 1)
    };
    if (code !== 0) lastError = "backup_failed";
  });
}

function normalizeBackupOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && process.env.ADG_BACKUP_ALLOW_HTTP !== "true") {
      throw new Error("HTTPS is required.");
    }
    return url.origin;
  } catch {
    throw new ProviderError(
      "backup_origin_invalid",
      400,
      "Backup API origin is invalid."
    );
  }
}

function normalizeOperation(value) {
  if (!value || !["run", "all"].includes(value.mode)
      || typeof value.sql !== "string"
      || value.sql.length < 1
      || value.sql.length > 1024 * 1024
      || !Array.isArray(value.params)
      || value.params.length > 1024) {
    throw new ProviderError("operation_invalid", 400, "Operation is invalid.");
  }
  const sqlText = value.sql.trim();
  const withoutTrailing = sqlText.endsWith(";")
    ? sqlText.slice(0, -1)
    : sqlText;
  if (withoutTrailing.includes(";")) {
    throw new ProviderError(
      "multiple_statements_forbidden",
      400,
      "Multiple SQL statements are forbidden."
    );
  }
  return {
    mode: value.mode,
    sql: withoutTrailing,
    params: value.params.map(decodeParameter)
  };
}

function decodeParameter(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.__adgType === "bigint") return String(value.value);
    if (value.__adgType === "bytes-base64") {
      return Buffer.from(String(value.value || ""), "base64");
    }
  }
  return value;
}

function serializeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === "bigint"
      ? value.toString()
      : value instanceof Uint8Array
        ? Buffer.from(value).toString("base64")
        : value
  ]));
}

async function readJson(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > maxBodyBytes) {
    throw new ProviderError("body_too_large", 413, "Request body is too large.");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) {
      throw new ProviderError("body_too_large", 413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderError("json_invalid", 400, "Request JSON is invalid.");
  }
}

function requireSchema(body, schema) {
  if (!body || body.schema !== schema) {
    throw new ProviderError("schema_invalid", 400, "Request schema is invalid.");
  }
}

function authorized(request) {
  const match = /^Bearer\s+(.+)$/iu.exec(
    String(request.headers.authorization || "").trim()
  );
  return Boolean(match && constantTimeEqual(match[1], token));
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(String(value || ""));
}

function sendError(response, status, code, message) {
  return sendJson(response, status, {
    ok: false,
    error: { code, message, retryable: status >= 500 }
  });
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(body.length)
  });
  response.end(body);
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

class ProviderError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function shutdown(signal) {
  console.log(`CPOLY PostgreSQL provider received ${signal}`);
  server.close();
  if (backupProcess && backupProcess.exitCode == null) {
    backupProcess.kill("SIGTERM");
  }
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
