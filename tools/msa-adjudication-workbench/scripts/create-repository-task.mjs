import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePacketMerkleRoot,
  validatePacket
} from "../public/protocol.js";

const [
  packetArgument,
  outputArgument,
  titleAr,
  summaryAr,
  assignmentMode = "open",
  lane = "standard"
] = process.argv.slice(2);

if (!packetArgument || !outputArgument || !titleAr || !summaryAr) {
  throw new Error(
    "Usage: node create-repository-task.mjs "
      + "<packet.json> <output.task.json> <title-ar> <summary-ar> "
      + "[mode] [lane]"
  );
}
if (!["open", "assigned"].includes(assignmentMode)) {
  throw new Error("Assignment mode must be open or assigned.");
}
if (!["standard", "operational-test"].includes(lane)) {
  throw new Error("Lane must be standard or operational-test.");
}

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packetPath = resolve(process.cwd(), packetArgument);
const outputPath = resolve(process.cwd(), outputArgument);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
validatePacket(packet);
const sourcePath = relative(repositoryRoot, outputPath).split(sep).join("/");
if (!sourcePath.startsWith("human-evidence/tasks/")) {
  throw new Error("Repository tasks must be written under human-evidence/tasks/.");
}

const manifest = {
  schema: "adg-msa-repository-task-v1",
  titleAr: titleAr.trim(),
  summaryAr: summaryAr.trim(),
  assignmentMode,
  lane,
  status: "active",
  sourcePath,
  packetMerkleRoot: await computePacketMerkleRoot(packet),
  packet
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  outputPath,
  packetId: packet.packetId,
  packetMerkleRoot: manifest.packetMerkleRoot
}));
