import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "integrity.sha256");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".validation-")
          || entry.name === "__pycache__") return [];
      return walk(full);
    }
    if (entry.name.endsWith(".pyc")) return [];
    return full === manifestPath ? [] : [full];
  });
}

if (!fs.existsSync(manifestPath)) {
  console.error("integrity.sha256 is missing");
  process.exit(1);
}

const expected = new Map();
for (const line of fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/)) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) {
    console.error(`Invalid integrity manifest line: ${line}`);
    process.exit(1);
  }
  expected.set(match[2], match[1]);
}

const files = walk(root).sort((left, right) => left.localeCompare(right));
const actualNames = files.map((file) => path.relative(root, file).replaceAll("\\", "/"));
if (actualNames.length !== expected.size ||
    actualNames.some((name) => !expected.has(name))) {
  console.error("integrity.sha256 file set does not match the package tree");
  process.exit(1);
}

for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (expected.get(relative) !== digest) {
    console.error(`Integrity mismatch: ${relative}`);
    process.exit(1);
  }
}

console.log(`OK integrity.sha256 verifies ${files.length} package files`);
