import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const options = parse(process.argv.slice(2));
const token = readFileSync(options.tokenFile, "utf8").trim();
const queryPath = "/api/internal/postgres/v1/query";

if (options.action === "seed") {
  const operation = {
    mode: "run",
    sql: `INSERT INTO adjudication.users
      (id, profile_ciphertext, consent_json, verified_email_hash,
       created_at, updated_at)
     VALUES ($1, $2, $3, NULL, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    params: [
      "cloudflare-seed",
      "EntityCrypt:validation-ciphertext",
      "{\"consent\":true}",
      1,
      1
    ]
  };
  const requestId = "11111111-1111-4111-8111-111111111111";
  const payloadHash = hashCanonical("run", [operation]);
  const body = {
    schema: "adg.cpoly-postgres.execute.v1",
    requestId,
    payloadHash,
    operationKind: "run",
    statementCount: 1,
    transaction: true,
    expectedGeneration: null,
    operations: [operation]
  };
  const first = await post(queryPath, body);
  const second = await post(queryPath, body);
  if (!first.ok || !first.receipt || !second.ok
      || second.receipt.receiptSeq !== first.receipt.receiptSeq) {
    throw new Error("Provider receipt idempotency failed.");
  }
  process.stdout.write(JSON.stringify(first.receipt) + "\n");
} else if (options.action === "hash") {
  const operation = {
    mode: "all",
    sql: `SELECT id, profile_ciphertext, consent_json, created_at, updated_at
            FROM adjudication.users
           WHERE id = $1`,
    params: ["cloudflare-seed"]
  };
  const result = await post(queryPath, {
    schema: "adg.cpoly-postgres.execute.v1",
    requestId: null,
    payloadHash: null,
    operationKind: "read",
    statementCount: 1,
    transaction: false,
    expectedGeneration: null,
    operations: [operation]
  });
  const rows = result.results?.[0]?.results || [];
  if (rows.length !== 1) throw new Error("Seed row is missing.");
  process.stdout.write(
    createHash("sha256").update(JSON.stringify(rows)).digest("hex") + "\n"
  );
} else if (options.action === "backup") {
  process.stdout.write(JSON.stringify(await post(
    "/api/internal/postgres/v1/backups/trigger",
    {
      schema: "adg.cpoly-postgres.backup-trigger.v1",
      reason: "validation",
      requestedAt: Date.now()
    }
  )) + "\n");
} else if (options.action === "recovery") {
  process.stdout.write(JSON.stringify(await get(
    "/api/internal/postgres/v1/status"
  )) + "\n");
} else {
  throw new Error(`Unsupported action: ${options.action}`);
}

function hashCanonical(operationKind, operations) {
  return createHash("sha256")
    .update(JSON.stringify({ operationKind, operations }), "utf8")
    .digest("hex");
}

async function post(path, body) {
  return await call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function get(path) {
  return await call(path, { method: "GET" });
}

async function call(path, init) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `${path} failed with HTTP ${response.status}: `
      + `${payload.error?.code || payload.error}`
    );
  }
  return payload;
}

function parse(values) {
  const result = { baseUrl: "", tokenFile: "", action: "" };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--base-url") result.baseUrl = values[++index];
    else if (values[index] === "--token-file") result.tokenFile = values[++index];
    else if (values[index] === "--action") result.action = values[++index];
    else throw new Error(`Unsupported argument: ${values[index]}`);
  }
  if (!result.baseUrl || !result.tokenFile || !result.action) {
    throw new Error("--base-url, --token-file, and --action are required.");
  }
  return result;
}

