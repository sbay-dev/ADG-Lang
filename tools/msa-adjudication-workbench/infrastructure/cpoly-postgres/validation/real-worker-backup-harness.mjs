import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeCpolyBackupRequest } from "../../../src/cpoly-recovery.js";

const validationDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(validationDirectory, "..", "..", "..");
const options = parseArguments(process.argv.slice(2));
const hmacKey = readFileSync(options.keyFile, "utf8").trim();
const bridgeToken = options.bridgeTokenFile
  ? readFileSync(options.bridgeTokenFile, "utf8").trim()
  : "";
if (hmacKey.length < 32) {
  throw new Error("Harness HMAC key must contain at least 32 characters.");
}

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

class D1HarnessDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    const migrationDirectory = path.join(projectRoot, "migrations");
    for (const fileName of readdirSync(migrationDirectory)
      .filter(name => /^\d+.*\.sql$/u.test(name))
      .sort()) {
      this.database.exec(readFileSync(
        path.join(migrationDirectory, fileName),
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

class KvHarnessStore {
  constructor() {
    this.values = new Map();
    this.hiddenReads = new Map();
  }

  async put(key, value) {
    this.values.set(String(key), Buffer.from(value));
  }

  async get(key, options = {}) {
    const normalizedKey = String(key);
    const delayed = Number(this.hiddenReads.get(normalizedKey) || 0);
    if (delayed > 0) {
      this.hiddenReads.set(normalizedKey, delayed - 1);
      return null;
    }
    const value = this.values.get(normalizedKey);
    if (!value) return null;
    if (options === "arrayBuffer" || options?.type === "arrayBuffer") {
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength
      );
    }
    return value.toString("utf8");
  }

  async delete(key) {
    this.values.delete(String(key));
  }

  delay(key, reads) {
    this.hiddenReads.set(String(key), Number(reads));
  }
}

const recoveryDb = new D1HarnessDatabase();
const kvStore = new KvHarnessStore();
const env = {
  RECOVERY_DB: recoveryDb,
  CPOLY_BACKUPS: kvStore,
  DB: {
    __isPostgresD1Database: true,
    async completeRecoveryReplay({ snapshotCoverage, targetGeneration }) {
      if (options.bridgeBaseUrl) {
        await bridgeExecute(
          `UPDATE adjudication.cpoly_runtime_state
              SET current_generation = $1, updated_at = $2
            WHERE singleton = TRUE`,
          [Number(targetGeneration), Date.now()]
        );
        const receipt = await bridgeExecute(
          `UPDATE adjudication.cpoly_runtime_state
              SET updated_at = updated_at
            WHERE singleton = TRUE`,
          []
        );
        return {
          generation: Number(receipt.generation),
          receiptSeq: Number(receipt.receiptSeq),
          replayed: 1,
          pending: 0
        };
      }
      return {
        generation: Number(targetGeneration),
        receiptSeq: Number(snapshotCoverage.watermark),
        replayed: 0,
        pending: 0
      };
    }
  },
  CPOLY_BACKUP_HMAC_KEY: hmacKey,
  CPOLY_BACKUP_MASTER_KEY: "validation-only-worker-master-key-32-bytes",
  CPOLY_BACKUP_MAX_CHUNK_BYTES: "524288",
  CPOLY_BACKUP_MAX_BACKUP_BYTES: "268435456",
  CPOLY_BACKUP_MAX_BACKUP_CHUNKS: "512"
};

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === "/__harness/healthz") {
      const body = Buffer.from('{"ok":true}');
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "application/json");
      outgoing.setHeader("content-length", String(body.length));
      outgoing.end(body);
      return;
    }
    if (incoming.url?.startsWith("/__harness/delay-latest")) {
      const url = new URL(incoming.url, "http://harness.internal");
      const reads = Math.max(1, Number(url.searchParams.get("reads") || 8));
      const latest = recoveryDb.database.prepare(
        `SELECT id
           FROM cpoly_backup_sets
          WHERE status = 'complete'
          ORDER BY snapshot_generation DESC, snapshot_watermark DESC
          LIMIT 1`
      ).get();
      if (!latest) throw new Error("No complete backup exists to delay.");
      const keys = recoveryDb.database.prepare(
        `SELECT kv_key
           FROM cpoly_backup_chunk_inventory
          WHERE backup_id = ?
          ORDER BY chunk_index`
      ).all(latest.id);
      for (const row of keys) kvStore.delay(row.kv_key, reads);
      const body = Buffer.from(JSON.stringify({
        ok: true,
        backupId: latest.id,
        delayedKeys: keys.length,
        reads
      }));
      outgoing.statusCode = 200;
      outgoing.setHeader("content-type", "application/json");
      outgoing.setHeader("content-length", String(body.length));
      outgoing.end(body);
      return;
    }
    const body = await readBody(incoming);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value != null) {
        headers.set(name, value);
      }
    }
    const request = new Request(
      `http://${options.host}:${options.port}${incoming.url}`,
      {
        method: incoming.method,
        headers,
        body: ["GET", "HEAD"].includes(incoming.method)
          ? undefined
          : body
      }
    );
    const requestUrl = new URL(request.url);
    const response = requestUrl.pathname.startsWith("/api/internal/cpoly-")
      ? await routeCpolyBackupRequest(request, env, requestUrl)
      : new Response("Not Found", { status: 404 });
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers.entries()) {
      outgoing.setHeader(name, value);
    }
    const responseBody = Buffer.from(await response.arrayBuffer());
    outgoing.setHeader("content-length", String(responseBody.length));
    outgoing.end(responseBody);
  } catch (error) {
    const body = Buffer.from(JSON.stringify({
      message: "Harness request failed.",
      detail: String(error?.message || error)
    }));
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json");
    outgoing.setHeader("content-length", String(body.length));
    outgoing.end(body);
  }
});

server.listen(options.port, options.host, () => {
  process.stdout.write(`READY http://${options.host}:${options.port}\n`);
});

function parseArguments(values) {
  const result = {
    host: "127.0.0.1",
    port: 18765,
    keyFile: ""
    ,
    bridgeBaseUrl: "",
    bridgeTokenFile: ""
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--host") result.host = values[++index];
    else if (value === "--port") result.port = Number(values[++index]);
    else if (value === "--key-file") result.keyFile = values[++index];
    else if (value === "--bridge-base-url") result.bridgeBaseUrl = values[++index];
    else if (value === "--bridge-token-file") result.bridgeTokenFile = values[++index];
    else throw new Error(`Unsupported harness argument: ${value}`);
  }
  if (!result.keyFile || !Number.isInteger(result.port)) {
    throw new Error("Harness requires --key-file and an integer --port.");
  }
  return result;
}

async function bridgeExecute(sql, params) {
  if (!bridgeToken) throw new Error("Bridge token is unavailable.");
  const operation = { mode: "run", sql, params };
  const canonical = JSON.stringify({
    operationKind: "run",
    operations: [operation]
  });
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  const response = await fetch(
    `${options.bridgeBaseUrl}/api/internal/postgres/v1/query`,
    {
    method: "POST",
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      schema: "adg.cpoly-postgres.execute.v1",
      requestId: randomUUID(),
      payloadHash,
      operationKind: "run",
      statementCount: 1,
      transaction: true,
      expectedGeneration: null,
      operations: [operation]
    })
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Bridge replay failed with HTTP ${response.status}.`);
  }
  return payload.receipt;
}

async function readBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
