const {
  Container,
  getContainer
} = await loadCloudflareContainersRuntime();

const DEFAULT_ALLOWED_ORIGIN = "https://adg.sbay.sa";
export const DEFAULT_CPOLY_POSTGRES_PROVIDER_PORT = 18444;
const DEFAULT_START_TIMEOUT_MS = 120000;
const STATUS_CACHE_SYMBOL = Symbol.for("adg.cpoly-postgres.status");
const PROVIDER_BASE_URL = "https://cpoly-postgres.internal";

export const CPOLY_POSTGRES_EXECUTE_SCHEMA = "adg.cpoly-postgres.execute.v1";
export const CPOLY_POSTGRES_STATUS_SCHEMA = "adg.cpoly-postgres.status.v1";
export const CPOLY_POSTGRES_RECEIPT_SCHEMA =
  "adg.cpoly-postgres.receipt-watermark.v1";
export const CPOLY_POSTGRES_PROMOTE_SCHEMA =
  "adg.cpoly-postgres.promote-generation.v1";
export const CPOLY_POSTGRES_KEEPALIVE_SCHEMA =
  "adg.cpoly-postgres.keepalive.v1";
export const CPOLY_POSTGRES_BACKUP_TRIGGER_SCHEMA =
  "adg.cpoly-postgres.backup-trigger.v1";

export const CPOLY_POSTGRES_STATUS_PATH = "/api/internal/postgres/v1/status";
export const CPOLY_POSTGRES_QUERY_PATH = "/api/internal/postgres/v1/query";
export const CPOLY_POSTGRES_RECEIPT_PATH =
  "/api/internal/postgres/v1/runtime/receipt-watermark";
export const CPOLY_POSTGRES_PROMOTE_PATH =
  "/api/internal/postgres/v1/runtime/promote-generation";
export const CPOLY_POSTGRES_KEEPALIVE_PATH =
  "/api/internal/postgres/v1/runtime/keepalive";
export const CPOLY_POSTGRES_BACKUP_TRIGGER_PATH =
  "/api/internal/postgres/v1/backups/trigger";

const ALLOWED_PROVIDER_PATHS = new Set([
  CPOLY_POSTGRES_STATUS_PATH,
  CPOLY_POSTGRES_QUERY_PATH,
  CPOLY_POSTGRES_RECEIPT_PATH,
  CPOLY_POSTGRES_PROMOTE_PATH,
  CPOLY_POSTGRES_KEEPALIVE_PATH,
  CPOLY_POSTGRES_BACKUP_TRIGGER_PATH
]);

async function loadCloudflareContainersRuntime() {
  try {
    return await import("@cloudflare/containers");
  } catch (error) {
    if (!runningUnderNode()) {
      throw error;
    }
  }
  return {
    Container: class ContainerShim {
      constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
      }

      async startAndWaitForPorts() {}

      async containerFetch(request) {
        if (typeof this.ctx?.containerFetch === "function") {
          return this.ctx.containerFetch(request);
        }
        throw new Error(
          "Cloudflare Container runtime is unavailable in the local shim."
        );
      }
    },
    getContainer(binding, name = "cf-singleton-container") {
      const objectId = binding?.idFromName?.(name);
      if (objectId != null && typeof binding?.get === "function") {
        return binding.get(objectId);
      }
      if (binding && typeof binding.fetch === "function") {
        return binding;
      }
      throw new Error("CPOLY_POSTGRES binding does not expose get() or fetch().");
    }
  };
}

function runningUnderNode() {
  return typeof process !== "undefined"
    && Boolean(process?.versions?.node);
}

export class CpolyPostgresProviderError extends Error {
  constructor(message, {
    status = 502,
    code = null,
    retryable = false,
    details = null
  } = {}) {
    super(message);
    this.name = "CpolyPostgresProviderError";
    this.status = Number(status || 502);
    this.code = code == null ? null : String(code);
    this.retryable = Boolean(retryable);
    this.details = details;
  }
}

export class CpolyPostgresNotReadyError extends CpolyPostgresProviderError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      status: options.status ?? 503
    });
    this.name = "CpolyPostgresNotReadyError";
  }
}

export class CpolyAdgPostgresContainer extends Container {
  defaultPort = DEFAULT_CPOLY_POSTGRES_PROVIDER_PORT;
  requiredPorts = [DEFAULT_CPOLY_POSTGRES_PROVIDER_PORT];
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    const providerPort = resolveCpolyPostgresProviderPort(env);
    this.providerPort = providerPort;
    this.defaultPort = providerPort;
    this.requiredPorts = [providerPort];
    this.envVars = buildCpolyPostgresContainerEnv(env);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (!cpolyPostgresProviderPathAllowed(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    if (!constantTimeTextEqual(
      extractBearerToken(request.headers.get("authorization")),
      nonEmptyString(this.env?.CPOLY_POSTGRES_INTERNAL_TOKEN)
    )) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "cache-control": "no-store" }
      });
    }
    await this.startAndWaitForPorts(this.providerPort, {
      instanceGetTimeoutMS: DEFAULT_START_TIMEOUT_MS,
      portReadyTimeoutMS: DEFAULT_START_TIMEOUT_MS
    });
    const upstream = new URL(url.pathname + url.search, `http://127.0.0.1:${this.providerPort}`);
    return this.containerFetch(new Request(upstream, request), this.providerPort);
  }
}

export function cpolyPostgresBindingPresent(env) {
  return Boolean(env?.CPOLY_POSTGRES);
}

export function cpolyPostgresConfigured(env) {
  return cpolyPostgresBindingPresent(env)
    && nonEmptyString(env?.CPOLY_POSTGRES_INSTANCE_ID)
    && nonEmptyString(env?.CPOLY_POSTGRES_INTERNAL_TOKEN);
}

export function resolveCpolyPostgresInstanceId(env) {
  const value = nonEmptyString(env?.CPOLY_POSTGRES_INSTANCE_ID);
  if (!value) {
    throw new Error(
      "CPOLY_POSTGRES_INSTANCE_ID is required when CPOLY_POSTGRES is bound."
    );
  }
  return value;
}

export function resolveCpolyPostgresProviderPort(env) {
  const parsed = Number(env?.CPOLY_POSTGRES_PROVIDER_PORT);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_CPOLY_POSTGRES_PROVIDER_PORT;
  }
  return parsed;
}

export function cpolyPostgresProviderPathAllowed(pathname) {
  return ALLOWED_PROVIDER_PATHS.has(String(pathname || ""));
}

export function resolveCpolyPostgresWorkerOrigin(env) {
  const raw = String(env?.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN).trim();
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ALLOWED_ORIGIN;
  }
}

export function buildCpolyPostgresContainerEnv(env) {
  return {
    CPOLY_POSTGRES_INSTANCE_ID: nonEmptyString(env?.CPOLY_POSTGRES_INSTANCE_ID),
    CPOLY_POSTGRES_PROVIDER_PORT: String(resolveCpolyPostgresProviderPort(env)),
    CPOLY_POSTGRES_INTERNAL_TOKEN: nonEmptyString(
      env?.CPOLY_POSTGRES_INTERNAL_TOKEN
    ),
    CPOLY_BACKUP_HMAC_KEY: nonEmptyString(env?.CPOLY_BACKUP_HMAC_KEY),
    CPOLY_BACKUP_BASE_URL: nonEmptyString(env?.CPOLY_BACKUP_BASE_URL)
      || resolveCpolyPostgresWorkerOrigin(env),
    ADG_MIGRATOR_PASSWORD: nonEmptyString(env?.ADG_MIGRATOR_PASSWORD),
    ADG_RUNTIME_PASSWORD: nonEmptyString(env?.ADG_RUNTIME_PASSWORD),
    ADG_BACKUP_PASSWORD: nonEmptyString(env?.ADG_BACKUP_PASSWORD),
    POSTGRES_SUPERUSER_PASSWORD: nonEmptyString(
      env?.POSTGRES_SUPERUSER_PASSWORD
    ),
    CPOLY_ALLOW_FRESH_BOOTSTRAP: String(
      env?.CPOLY_ALLOW_FRESH_BOOTSTRAP ?? "false"
    ),
    CPOLY_RESUME_RECOVERY: String(
      env?.CPOLY_RESUME_RECOVERY ?? "false"
    ),
    CPOLY_BACKUP_RETENTION_HOURS: String(
      env?.CPOLY_BACKUP_RETENTION_HOURS ?? "168"
    ),
    CPOLY_BACKUP_MAX_CHUNK_BYTES: String(
      env?.CPOLY_BACKUP_MAX_CHUNK_BYTES ?? "524288"
    ),
    CPOLY_BACKUP_MAX_BACKUP_BYTES: String(
      env?.CPOLY_BACKUP_MAX_BACKUP_BYTES ?? "33554432"
    ),
    CPOLY_BACKUP_MAX_CHUNKS: String(
      env?.CPOLY_BACKUP_MAX_CHUNKS ?? "512"
    )
  };
}

export async function fetchCpolyPostgresStatus(
  env,
  { forceRefresh = false } = {}
) {
  if (!cpolyPostgresBindingPresent(env)) return null;
  if (!forceRefresh && env?.[STATUS_CACHE_SYMBOL]) {
    return env[STATUS_CACHE_SYMBOL];
  }
  const promise = callCpolyPostgresProviderJson(
    env,
    CPOLY_POSTGRES_STATUS_PATH,
    { method: "GET" }
  ).then(normalizeCpolyPostgresStatus);
  if (env && typeof env === "object") {
    env[STATUS_CACHE_SYMBOL] = promise;
  }
  return promise;
}

export async function keepaliveCpolyPostgresContainer(env) {
  if (!cpolyPostgresBindingPresent(env)) return null;
  const payload = await callCpolyPostgresProviderJson(
    env,
    CPOLY_POSTGRES_KEEPALIVE_PATH,
    {
      method: "POST",
      json: {
        schema: CPOLY_POSTGRES_KEEPALIVE_SCHEMA,
        reason: "scheduled",
        requestedAt: Date.now()
      }
    }
  );
  const status = normalizeCpolyPostgresStatus(payload);
  if (env && typeof env === "object") {
    env[STATUS_CACHE_SYMBOL] = Promise.resolve(status);
  }
  return status;
}

export async function triggerCpolyPostgresBackup(env, reason = "scheduled") {
  if (!cpolyPostgresBindingPresent(env)) return null;
  return callCpolyPostgresProviderJson(
    env,
    CPOLY_POSTGRES_BACKUP_TRIGGER_PATH,
    {
      method: "POST",
      json: {
        schema: CPOLY_POSTGRES_BACKUP_TRIGGER_SCHEMA,
        reason: String(reason || "scheduled"),
        workerOrigin: resolveCpolyPostgresWorkerOrigin(env),
        backupApiBaseUrl: `${resolveCpolyPostgresWorkerOrigin(env)}/api/internal/cpoly-backups`,
        requestedAt: Date.now()
      }
    }
  );
}

export async function processCpolyPostgresContainerMaintenance(
  env,
  { triggerBackup = true } = {}
) {
  if (!cpolyPostgresBindingPresent(env)) return null;
  const status = await keepaliveCpolyPostgresContainer(env);
  if (!status.ready || !triggerBackup) {
    return status;
  }
  await triggerCpolyPostgresBackup(env, "scheduled");
  return status;
}

export async function callCpolyPostgresProvider(env, path, options = {}) {
  if (!cpolyPostgresProviderPathAllowed(path)) {
    throw new Error(`CPOLY provider path is not allowed: ${path}`);
  }
  const token = nonEmptyString(env?.CPOLY_POSTGRES_INTERNAL_TOKEN);
  const instanceId = resolveCpolyPostgresInstanceId(env);
  if (!token) {
    throw new Error(
      "CPOLY_POSTGRES_INTERNAL_TOKEN is required when CPOLY_POSTGRES is bound."
    );
  }
  const container = resolveCpolyPostgresContainer(env, instanceId);
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  headers.set("cache-control", "no-store");
  let body = options.body;
  if (options.json != null) {
    if (body != null) {
      throw new TypeError("Provide either json or body when calling CPOLY_POSTGRES.");
    }
    headers.set("content-type", "application/json; charset=utf-8");
    body = JSON.stringify(options.json);
  }
  return container.fetch(new Request(
    new URL(path, PROVIDER_BASE_URL),
    {
      method: String(options.method || "GET").toUpperCase(),
      headers,
      body
    }
  ));
}

export async function callCpolyPostgresProviderJson(env, path, options = {}) {
  const response = await callCpolyPostgresProvider(env, path, options);
  const payload = await parseProviderResponseBody(response);
  if (!response.ok) {
    throw providerErrorFromResponse(response, payload);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CpolyPostgresProviderError(
      `CPOLY provider returned invalid JSON for ${path}.`,
      { status: 502 }
    );
  }
  return payload;
}

export function normalizeCpolyPostgresStatus(payload) {
  const status = payload?.status;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new CpolyPostgresProviderError(
      "CPOLY provider status payload was invalid.",
      { status: 502 }
    );
  }
  const state = normalizeProviderState(status.state);
  return {
    schema: String(payload.schema || CPOLY_POSTGRES_STATUS_SCHEMA),
    state,
    ready: Boolean(status.ready && state === "ready"),
    instanceId: status.instanceId == null ? null : String(status.instanceId),
    currentGeneration: numericOrNull(status.currentGeneration),
    receiptWatermark: numericOrNull(status.receiptWatermark),
    restoreBackupId: status.restoreBackupId == null
      ? null
      : String(status.restoreBackupId),
    restoreSnapshotGeneration: numericOrNull(
      status.restoreSnapshotGeneration
    ),
    restoreSnapshotWatermark: numericOrNull(
      status.restoreSnapshotWatermark
    ),
    lastBackupId: status.lastBackupId == null
      ? null
      : String(status.lastBackupId),
    backupInProgress: Boolean(status.backupInProgress),
    lastError: status.lastError == null ? null : String(status.lastError)
  };
}

function resolveCpolyPostgresContainer(env, instanceId) {
  const override = env?.__CPOLY_POSTGRES_GET_CONTAINER__;
  const resolver = typeof override === "function" ? override : getContainer;
  const container = resolver(env.CPOLY_POSTGRES, instanceId);
  if (!container || typeof container.fetch !== "function") {
    throw new Error("CPOLY_POSTGRES did not resolve to a container fetch client.");
  }
  return container;
}

async function parseProviderResponseBody(response) {
  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: {
          code: "invalid_json",
          message: text.slice(0, 512)
        }
      };
    }
  }
  try {
    return await response.json();
  } catch {
    throw new CpolyPostgresProviderError(
      "CPOLY provider returned malformed JSON.",
      { status: 502 }
    );
  }
}

function providerErrorFromResponse(response, payload) {
  const details = payload?.error && typeof payload.error === "object"
    ? payload.error
    : payload;
  const message = normalizeProviderMessage(
    details?.message,
    `CPOLY provider request failed with status ${response.status}.`
  );
  const options = {
    status: response.status,
    code: details?.code ?? null,
    retryable: Boolean(details?.retryable),
    details: details ?? null
  };
  if (response.status === 503) {
    return new CpolyPostgresNotReadyError(message, options);
  }
  return new CpolyPostgresProviderError(message, options);
}

function normalizeProviderMessage(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeProviderState(value) {
  const state = String(value || "").trim().toLowerCase();
  if (["starting", "restoring", "ready", "error"].includes(state)) {
    return state;
  }
  return "error";
}

function numericOrNull(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractBearerToken(value) {
  const match = /^\s*Bearer\s+(.+?)\s*$/iu.exec(String(value || ""));
  return match?.[1] ? String(match[1]) : "";
}

function constantTimeTextEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  let difference = leftBytes.length ^ rightBytes.length;
  const size = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function nonEmptyString(value) {
  const text = String(value || "").trim();
  return text || "";
}
