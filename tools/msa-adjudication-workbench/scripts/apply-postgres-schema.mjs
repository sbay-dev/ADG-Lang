import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import {
  DEFAULT_CONNECTION_STRING_ENV,
  DEFAULT_SCHEMA_PATH,
  projectRoot,
  resolveConnectionString
} from "./postgres-operator-utils.mjs";

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write([
    "Usage:",
    "  node scripts/apply-postgres-schema.mjs [--file <postgres/0001_portal_v15.sql>] [--connection-string-env POSTGRES_CONNECTION_STRING]",
    "",
    "Environment:",
    `  ${DEFAULT_CONNECTION_STRING_ENV}`
  ].join("\n") + "\n");
  process.exit(0);
}

const options = parseArguments(argv);
const connectionString = resolveConnectionString(options.connectionStringEnv);
const schemaPath = path.resolve(projectRoot, options.filePath);
const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  idle_timeout: 20,
  max_lifetime: 60,
  connection: {
    application_name: "adg-postgres-schema-apply"
  }
});

try {
  const schemaText = readFileSync(schemaPath, "utf8");
  await sql.unsafe(schemaText);
  process.stdout.write(JSON.stringify({
    applied: true,
    schemaFile: path.relative(projectRoot, schemaPath),
    connectionStringEnv: options.connectionStringEnv
  }, null, 2) + "\n");
} finally {
  await sql.end();
}

function parseArguments(values) {
  let filePath = path.relative(projectRoot, DEFAULT_SCHEMA_PATH);
  let connectionStringEnv = DEFAULT_CONNECTION_STRING_ENV;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--file") {
      filePath = values[index + 1];
      index += 1;
      continue;
    }
    if (value === "--connection-string-env") {
      connectionStringEnv = values[index + 1] || DEFAULT_CONNECTION_STRING_ENV;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument '${value}'.`);
  }
  return { filePath, connectionStringEnv };
}
