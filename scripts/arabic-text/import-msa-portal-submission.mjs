import assert from "node:assert/strict";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  sha256Json,
  validateAdjudicationBinding,
  validatePacket,
  validateSubmissionBinding
} from "../../tools/msa-adjudication-workbench/public/protocol.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: node import-msa-portal-submission.mjs <input> <output>");
}

const hmacKey = process.env.ADG_SUBMISSION_HMAC;
if (!hmacKey) {
  throw new Error("ADG_SUBMISSION_HMAC is required.");
}

const signed = JSON.parse(await readFile(inputPath, "utf8"));
const { hmacSha256, ...envelope } = signed;
assert.match(hmacSha256, /^[a-f0-9]{64}$/);
const expectedHmac = createHmac("sha256", hmacKey)
  .update(JSON.stringify(envelope), "utf8")
  .digest("hex");
assert.equal(
  timingSafeEqual(
    Buffer.from(hmacSha256, "hex"),
    Buffer.from(expectedHmac, "hex")),
  true,
  "Submission HMAC does not match."
);

assert.equal(envelope.schema, "adg-msa-github-inbox-v1");
assert.match(
  envelope.receiptId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
);
assert.equal(containsPii(envelope), false, "PII found in public envelope.");
assert.equal(
  await sha256Json(envelope.artifact),
  envelope.artifactSha256,
  "Artifact SHA-256 does not match."
);

await validateArtifact(envelope.artifact);
await writeFile(
  outputPath,
  JSON.stringify(signed, null, 2) + "\n",
  "utf8"
);
console.log(JSON.stringify({
  receiptId: envelope.receiptId,
  artifactType: envelope.artifactType,
  artifactSha256: envelope.artifactSha256
}));

async function validateArtifact(artifact) {
  assert.equal(artifact.schema, "adg-msa-portal-artifact-v1");
  validatePacket(artifact.packet);
  assert.equal(
    artifact.packet.schema,
    "adg-msa-adjudication-packet-v2"
  );
  assert.match(await computePacketMerkleRoot(artifact.packet), /^[a-f0-9]{64}$/);

  if (artifact.kind === "independent-annotation") {
    await validateSubmissionBinding(artifact.packet, artifact.annotation);
    assert.match(
      await computeAnnotationMerkleRoot(
        artifact.packet,
        artifact.annotation),
      /^[a-f0-9]{64}$/
    );
    return;
  }

  assert.equal(artifact.kind, "adjudication-package");
  await validateAdjudicationBinding(
    artifact.packet,
    artifact.annotationA,
    artifact.annotationB,
    artifact.adjudication
  );
  assert.match(
    await computeAdjudicationMerkleRoot(
      artifact.packet,
      artifact.annotationA,
      artifact.annotationB,
      artifact.adjudication),
    /^[a-f0-9]{64}$/
  );
}

function containsPii(value) {
  const forbidden = new Set([
    "fullName",
    "email",
    "phone",
    "affiliation"
  ]);
  if (Array.isArray(value)) return value.some(containsPii);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    forbidden.has(key) || containsPii(child));
}
