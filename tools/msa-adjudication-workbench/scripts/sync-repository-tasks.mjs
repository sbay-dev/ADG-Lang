import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePacketMerkleRoot,
  validatePacket,
  validatePublicArtifactText
} from "../public/protocol.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const tasksDirectory = resolve(repositoryRoot, "human-evidence", "tasks");
const validateOnly = process.argv.includes("--validate-only");
const repository = process.env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang";
const sourceCommitSha = process.env.GITHUB_SHA || argumentValue("--commit");

const files = (await readdir(tasksDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith(".task.json"))
  .map(entry => resolve(tasksDirectory, entry.name))
  .sort((left, right) => left.localeCompare(right, "en"));

if (files.length === 0) {
  throw new Error("No repository task manifests were found.");
}

const tasks = [];
for (const path of files) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const sourcePath = relative(repositoryRoot, path).split(sep).join("/");
  await validateManifest(manifest, sourcePath);
  tasks.push(manifest);
}

if (validateOnly) {
  console.log(JSON.stringify({
    valid: true,
    count: tasks.length,
    packetIds: tasks.map(task => task.packet.packetId)
  }));
  process.exit(0);
}

if (!/^[a-f0-9]{40}$/.test(sourceCommitSha || "")) {
  throw new Error("GITHUB_SHA or --commit must be a lowercase 40-byte SHA.");
}
const endpoint = String(
  process.env.ADG_PORTAL_TASK_SYNC_URL
    || "https://adg.sbay.sa/api/repository/tasks/sync"
);
const hmacKey = process.env.ADG_REPOSITORY_RECEIPT_HMAC;
if (!hmacKey) {
  throw new Error("ADG_REPOSITORY_RECEIPT_HMAC is required.");
}

const envelope = {
  schema: "adg-msa-repository-task-sync-v1",
  repository,
  sourceCommitSha,
  nonce: crypto.randomUUID(),
  requestedAtUtc: new Date().toISOString(),
  tasks
};
const serialized = JSON.stringify(envelope);
const payload = {
  ...envelope,
  hmacSha256: createHmac("sha256", hmacKey)
    .update(serialized, "utf8")
    .digest("hex")
};
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json"
  },
  body: JSON.stringify(payload)
});
const result = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(
    `Task synchronization returned ${response.status}: `
      + String(result.message || "unknown error")
  );
}
console.log(JSON.stringify(result));

async function validateManifest(manifest, sourcePath) {
  const allowedKeys = new Set([
    "schema",
    "titleAr",
    "summaryAr",
    "assignmentMode",
    "lane",
    "status",
    "sourcePath",
    "packetMerkleRoot",
    "packet"
  ]);
  if (!manifest
      || manifest.schema !== "adg-msa-repository-task-v1"
      || Object.keys(manifest).some(key => !allowedKeys.has(key))
      || manifest.sourcePath !== sourcePath
      || !["open", "assigned"].includes(manifest.assignmentMode)
      || !["standard", "operational-test"].includes(manifest.lane)
      || !["active", "withdrawn"].includes(manifest.status)
      || typeof manifest.titleAr !== "string"
      || manifest.titleAr.trim().length < 5
      || typeof manifest.summaryAr !== "string"
      || manifest.summaryAr.trim().length < 10) {
    throw new Error(`Invalid repository task manifest: ${sourcePath}`);
  }
  validatePacket(manifest.packet);
  validatePublicArtifactText({
    titleAr: manifest.titleAr,
    summaryAr: manifest.summaryAr,
    packet: manifest.packet
  });
  const root = await computePacketMerkleRoot(manifest.packet);
  if (manifest.packetMerkleRoot !== root) {
    throw new Error(
      `Packet Merkle mismatch in ${sourcePath}: `
        + `${manifest.packetMerkleRoot} != ${root}`
    );
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
