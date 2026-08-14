import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDirectory, "..");
export const DEFAULT_CONNECTION_STRING_ENV = "POSTGRES_CONNECTION_STRING";
export const DEFAULT_SCHEMA_PATH = path.join(
  projectRoot,
  "postgres",
  "0001_portal_v15.sql"
);

export function resolveConnectionString(envName = DEFAULT_CONNECTION_STRING_ENV) {
  const value = String(process.env[envName] || "").trim();
  if (!value) {
    throw new Error(`${envName} is required.`);
  }
  assertTrustedConnectionString(value);
  return value;
}

export function assertTrustedConnectionString(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("PostgreSQL connection string must be a valid URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("PostgreSQL connection string must use postgres://.");
  }
  if (isLocalHost(url.hostname)) return;
  const sslMode = String(
    url.searchParams.get("sslmode")
      || url.searchParams.get("ssl")
      || ""
  ).trim().toLowerCase();
  if (!["require", "verify-ca", "verify-full", "true", "1"].includes(
    sslMode
  )) {
    throw new Error(
      "Remote PostgreSQL connection strings must require TLS "
        + "(sslmode=require or stronger)."
    );
  }
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(
    String(hostname || "").trim().toLowerCase()
  );
}
