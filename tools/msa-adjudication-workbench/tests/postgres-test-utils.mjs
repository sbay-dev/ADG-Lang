import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import postgres from "postgres";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(projectRoot, "postgres", "0001_portal_v15.sql");

export const dockerAvailable = spawnSync("docker", ["--version"], {
  stdio: "ignore"
}).status === 0;
const POSTGRES_SEARCH_PATH = "adjudication,public";

export async function createPostgresFixture(tag) {
  if (!dockerAvailable) {
    throw new Error("Docker is not available.");
  }
  const port = await allocatePort();
  const containerName = `adg-portal-pg-${process.pid}-${tag}-${randomUUID().slice(0, 8)}`;
  const run = spawnSync("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    "POSTGRES_DB=adg",
    "-p",
    `${port}:5432`,
    "postgres:16-alpine"
  ], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "docker run failed").trim());
  }

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/adg`;
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60,
    connection: {
      application_name: "adg-postgres-test",
      search_path: POSTGRES_SEARCH_PATH
    }
  });

  try {
    await waitForReadiness(connectionString);
    await sql.unsafe(readFileSync(schemaPath, "utf8"));
  } catch (error) {
    await safeEnd(sql);
    stopContainer(containerName);
    throw error;
  }

  return {
    connectionString,
    containerName,
    sql,
    async close() {
      await safeEnd(sql);
      stopContainer(containerName);
    }
  };
}

export async function runNodeScript(scriptPath, args = [], env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...env
      },
      encoding: "utf8"
    });
    resolve({
      status: child.status,
      signal: child.signal,
      stdout: child.stdout || "",
      stderr: child.stderr || ""
    });
  });
}

async function waitForReadiness(connectionString) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = postgres(connectionString, {
      max: 1,
      prepare: false,
      idle_timeout: 5,
      max_lifetime: 30,
      connection: {
        application_name: "adg-postgres-ready",
        search_path: POSTGRES_SEARCH_PATH
      }
    });
    try {
      await probe`SELECT 1`;
      await probe.end();
      return;
    } catch {
      await safeEnd(probe);
      await delay(1000);
    }
  }
  throw new Error("Timed out waiting for PostgreSQL 16 test container.");
}

function stopContainer(containerName) {
  spawnSync("docker", ["stop", containerName], {
    cwd: projectRoot,
    stdio: "ignore"
  });
}

async function safeEnd(client) {
  try {
    await client.end();
  } catch {
    // ignore close failures during cleanup
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a port.")));
        return;
      }
      const { port } = address;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
