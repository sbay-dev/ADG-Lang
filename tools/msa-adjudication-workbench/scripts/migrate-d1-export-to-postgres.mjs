import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PostgresD1Database } from "../src/database.js";
import {
  DEFAULT_CONNECTION_STRING_ENV,
  projectRoot,
  resolveConnectionString
} from "./postgres-operator-utils.mjs";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const EXCLUDED_TABLES = new Set([
  "d1_migrations",
  "sqlite_sequence",
  "cpoly_backup_sets",
  "cpoly_backup_chunks",
  "cpoly_backup_chunk_inventory",
  "cpoly_signed_api_nonces",
  "cpoly_pg_write_journal",
  "cpoly_recovery_runtime"
]);
const INTERNAL_TABLE_PREFIXES = ["sqlite_", "_cf_"];
const TEMP_DIRECTORY_NAME = ".migration-work";
const REPORT_SCHEMA = "adg-d1-export-postgres-report-v1";
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write([
    "Usage:",
    "  node scripts/migrate-d1-export-to-postgres.mjs --source <wrangler-export.sql> [--apply] [--connection-string-env POSTGRES_CONNECTION_STRING]",
    "",
    "Environment:",
    `  ${DEFAULT_CONNECTION_STRING_ENV}`
  ].join("\n") + "\n");
  process.exit(0);
}

const scriptOptions = parseArguments(argv);
const tempDirectory = path.join(projectRoot, TEMP_DIRECTORY_NAME);
const tempDatabasePath = path.join(
  tempDirectory,
  `d1-export-${Date.now()}-${process.pid}-${randomUUID()}.sqlite`
);
const report = {
  schema: REPORT_SCHEMA,
  apply: scriptOptions.apply,
  dryRun: !scriptOptions.apply,
  connectionStringEnv: scriptOptions.connectionStringEnv,
  sourceExportPath: null,
  startedAtUtc: new Date().toISOString(),
  completedAtUtc: null,
  success: false,
  validation: scriptOptions.apply ? "pending" : "skipped-dry-run",
  tempDatabase: {
    path: path.relative(projectRoot, tempDatabasePath),
    deleted: false
  },
  tables: [],
  error: null
};

let sourceDatabase = null;
let targetDatabase = null;

try {
  const connectionString = resolveConnectionString(
    scriptOptions.connectionStringEnv
  );
  const sourcePath = path.resolve(projectRoot, scriptOptions.sourcePath);
  report.sourceExportPath = path.relative(projectRoot, sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error("The source D1 export SQL file was not found.");
  }

  mkdirSync(tempDirectory, { recursive: true });
  sourceDatabase = new DatabaseSync(tempDatabasePath);
  sourceDatabase.exec(readFileSync(sourcePath, "utf8"));

  targetDatabase = new PostgresD1Database({
    connectionString
  }, {
    applicationName: "adg-d1-export-migration",
    disableRecoveryJournal: true
  });

  const tables = loadApplicationTables(sourceDatabase);
  for (const table of tables) {
    const sourceRows = selectAllRows(sourceDatabase, table.name, table.columns);
    const targetColumns = await loadTargetColumns(targetDatabase, table.name);
    const importColumns = table.columns.filter(column => targetColumns.has(column.name));
    if (importColumns.length !== table.columns.length) {
      const missing = table.columns
        .filter(column => !targetColumns.has(column.name))
        .map(column => column.name);
      throw new Error(
        `Target table '${table.name}' is missing source columns: ${missing.join(", ")}`
      );
    }
    const sourceProfile = buildRowSetProfile(importColumns, sourceRows);
    const insertSql = createInsertSql(table.name, importColumns, table.conflictProtected);
    const tableReport = {
      name: table.name,
      conflictStrategy: table.conflictProtected
        ? "on-conflict-do-nothing"
        : "plain-insert",
      source: {
        columns: importColumns.map(column => ({
          name: column.name,
          type: column.type,
          notNull: column.notNull,
          primaryKeyOrder: column.primaryKeyOrder
        })),
        count: sourceProfile.count,
        sha256: sourceProfile.sha256
      },
      target: {
        count: null,
        sha256: null
      },
      validation: scriptOptions.apply ? "pending" : "skipped-dry-run"
    };
    report.tables.push(tableReport);

    if (scriptOptions.apply && sourceRows.length) {
      const statements = sourceRows.map(row =>
        targetDatabase.prepare(insertSql).bind(
          ...importColumns.map(column =>
            normalizeTargetParameter(row[column.name]))
        ));
      await targetDatabase.batch(statements);
    }

    const targetRows = await selectTargetRows(
      targetDatabase,
      table.name,
      importColumns
    );
    const targetProfile = buildRowSetProfile(importColumns, targetRows);
    tableReport.target.count = targetProfile.count;
    tableReport.target.sha256 = targetProfile.sha256;

    if (scriptOptions.apply) {
      const matched = targetProfile.count === sourceProfile.count
        && targetProfile.sha256 === sourceProfile.sha256;
      tableReport.validation = matched ? "matched" : "mismatch";
      if (!matched) {
        throw new Error(
          `Imported table '${table.name}' did not match the source count/hash.`
        );
      }
    }
  }

  report.validation = scriptOptions.apply ? "matched" : "skipped-dry-run";
  report.success = true;
} catch (error) {
  report.validation = "failed";
  report.error = {
    message: String(error?.message || "D1 export migration failed.")
      .slice(0, 400)
  };
} finally {
  try {
    sourceDatabase?.close();
  } catch {
    // ignore close failures
  }
  try {
    await targetDatabase?.close();
  } catch {
    // ignore close failures
  }
  try {
    rmSync(tempDatabasePath, { force: true });
    report.tempDatabase.deleted = !existsSync(tempDatabasePath);
    if (existsSync(tempDirectory)) {
      try {
        rmSync(tempDirectory, { recursive: false });
      } catch {
        // Another concurrent run still uses the shared directory.
      }
    }
  } catch {
    report.tempDatabase.deleted = false;
  }
  report.completedAtUtc = new Date().toISOString();
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!report.success) {
  process.exitCode = 1;
}

function parseArguments(values) {
  let sourcePath = null;
  let apply = false;
  let connectionStringEnv = DEFAULT_CONNECTION_STRING_ENV;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") {
      apply = true;
      continue;
    }
    if (value === "--source") {
      sourcePath = values[index + 1];
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
  if (!sourcePath) {
    throw new Error("A source D1 export SQL file is required via --source.");
  }
  return { sourcePath, apply, connectionStringEnv };
}

function loadApplicationTables(database) {
  const tableRows = database.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
      ORDER BY rowid`
  ).all();
  const tables = [];
  for (const row of tableRows) {
    const tableName = String(row.name);
    if (EXCLUDED_TABLES.has(tableName) || isInternalTableName(tableName)) {
      continue;
    }
    assertSafeIdentifier(tableName, "table");
    const columns = database.prepare(
      `PRAGMA table_info(${quoteIdentifier(tableName)})`
    ).all().map(column => {
      const name = String(column.name);
      assertSafeIdentifier(name, "column");
      return {
        name,
        type: String(column.type || ""),
        notNull: Number(column.notnull || 0) === 1,
        primaryKeyOrder: Number(column.pk || 0)
      };
    });
    const foreignKeys = database.prepare(
      `PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`
    ).all().map(item => String(item.table));
    const indices = database.prepare(
      `PRAGMA index_list(${quoteIdentifier(tableName)})`
    ).all();
    tables.push({
      name: tableName,
      columns,
      dependencies: foreignKeys.filter(name =>
        !EXCLUDED_TABLES.has(name) && !isInternalTableName(name)),
      conflictProtected:
        columns.some(column => column.primaryKeyOrder > 0)
        || indices.some(index => Number(index.unique || 0) === 1)
    });
  }
  return topologicallySortTables(tables);
}

function topologicallySortTables(tables) {
  const orderByName = new Map(tables.map((table, index) => [table.name, index]));
  const remaining = new Map(tables.map(table => [
    table.name,
    new Set(
      table.dependencies
        .filter(dependency => orderByName.has(dependency)
          && dependency !== table.name)
    )
  ]));
  const tablesByName = new Map(tables.map(table => [table.name, table]));
  const ordered = [];

  while (remaining.size) {
    const readyNames = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([name]) => name)
      .sort((left, right) =>
        Number(orderByName.get(left)) - Number(orderByName.get(right)));
    const nextNames = readyNames.length
      ? readyNames
      : [[...remaining.keys()].sort((left, right) =>
        Number(orderByName.get(left)) - Number(orderByName.get(right)))[0]];
    for (const name of nextNames) {
      ordered.push(tablesByName.get(name));
      remaining.delete(name);
      for (const dependencies of remaining.values()) {
        dependencies.delete(name);
      }
    }
  }
  return ordered;
}

async function loadTargetColumns(database, tableName) {
  const rows = await database.prepare(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ?
      ORDER BY ordinal_position`
  ).bind(tableName).all();
  if (!(rows.results || []).length) {
    throw new Error(`Target table '${tableName}' was not found.`);
  }
  return new Set((rows.results || []).map(row => String(row.column_name)));
}

function createInsertSql(tableName, columns, conflictProtected) {
  const quotedTable = quoteIdentifier(tableName);
  const quotedColumns = columns.map(column => quoteIdentifier(column.name));
  const placeholders = columns.map(() => "?");
  const conflictClause = conflictProtected
    ? " ON CONFLICT DO NOTHING"
    : "";
  return `INSERT INTO ${quotedTable} (${quotedColumns.join(", ")}) `
    + `VALUES (${placeholders.join(", ")})${conflictClause}`;
}

function selectAllRows(database, tableName, columns) {
  const sql = createSelectSql(tableName, columns);
  return database.prepare(sql).all();
}

async function selectTargetRows(database, tableName, columns) {
  const sql = createSelectSql(tableName, columns);
  const result = await database.prepare(sql).all();
  return result.results || [];
}

function createSelectSql(tableName, columns) {
  return `SELECT ${columns.map(column => quoteIdentifier(column.name)).join(", ")} `
    + `FROM ${quoteIdentifier(tableName)}`;
}

function buildRowSetProfile(columns, rows) {
  const rowStrings = rows.map(row =>
    JSON.stringify(columns.map(column => [
      column.name,
      canonicalizeValue(row[column.name])
    ])));
  rowStrings.sort();
  return {
    count: rows.length,
    sha256: createHash("sha256")
      .update(rowStrings.join("\n"), "utf8")
      .digest("hex")
  };
}

function canonicalizeValue(value) {
  if (value === null) return ["null", null];
  if (typeof value === "bigint") return ["bigint", value.toString(10)];
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? ["number", value]
      : ["number", String(value)];
  }
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (value instanceof Uint8Array) {
    return ["blob", Buffer.from(value).toString("base64")];
  }
  if (ArrayBuffer.isView(value)) {
    return [
      "blob",
      Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength
      ).toString("base64")
    ];
  }
  if (value instanceof ArrayBuffer) {
    return ["blob", Buffer.from(value).toString("base64")];
  }
  return ["json", JSON.stringify(value)];
}

function normalizeTargetParameter(value) {
  if (value === null) return null;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString(10);
  }
  if (value instanceof Uint8Array
      || ArrayBuffer.isView(value)
      || value instanceof ArrayBuffer) {
    throw new Error("Binary values are not supported by this migration CLI.");
  }
  return value;
}

function isInternalTableName(name) {
  return INTERNAL_TABLE_PREFIXES.some(prefix => name.startsWith(prefix));
}

function assertSafeIdentifier(name, kind) {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Unexpected ${kind} identifier '${name}'.`);
  }
}

function quoteIdentifier(name) {
  assertSafeIdentifier(name, "SQL");
  return `"${name}"`;
}
