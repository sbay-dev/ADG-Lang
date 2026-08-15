import assert from "node:assert/strict";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  computeRatificationMerkleRoot,
  sha256Json,
  validateAdjudicationBinding,
  validatePacket,
  validatePublicArtifactText,
  validateRatificationBinding,
  validateSubmissionBinding
} from "../../tools/msa-adjudication-workbench/public/protocol.js";

export const SUBMISSION_SCHEMA = "adg-msa-github-inbox-v1";
export const COMMENT_SCHEMA = "adg-msa-github-comment-v1";
export const TASK_STATE_SCHEMA = "adg-msa-task-state-v1";
export const SUBMISSION_EVIDENCE_TYPE = "submission";
export const COMMENT_EVIDENCE_TYPE = "comment";
export const TASK_STATE_EVIDENCE_TYPE = "task-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_RECEIPT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMENT_PSEUDONYM_PATTERN = /^adg-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PACKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONSENSUS_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ISO_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const COMMENT_CATEGORIES = new Set([
  "agreement",
  "disagreement",
  "question",
  "clarification",
  "evidence",
  "final-result",
  "consensus-proposal",
  "escalation",
  "appeal",
  "recusal"
]);
const ARTIFACT_TYPES = new Set([
  "independent-annotation",
  "adjudication-package",
  "ratification-package"
]);
const TASK_STATES = new Set([
  "draft",
  "open",
  "independent-review",
  "discussion",
  "final-review",
  "approved",
  "published",
  "escalated",
  "reissued",
  "revoked",
  "failed"
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "accountuserid",
  "affiliation",
  "authoritysource",
  "consent",
  "displayname",
  "email",
  "facebook",
  "fullname",
  "identity",
  "instagram",
  "linkedin",
  "objectid",
  "otherplatform",
  "otherusername",
  "participantid",
  "participantidentity",
  "phone",
  "privateidentity",
  "profile",
  "provider",
  "socialaccounts",
  "snapchat",
  "telegram",
  "threads",
  "tiktok",
  "whatsapp",
  "x",
  "youtube",
  "bluesky"
]);
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_LIKE_PATTERN =
  /(?:\+?\p{Nd}[\p{Nd}\s().-]{5,}\p{Nd})/u;
const RAW_HTML_PATTERN = /<[/!A-Za-z][^>]*>/;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\([^)]*\)/;
const DANGEROUS_URL_PATTERN = /\b(?:javascript|data)\s*:/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export async function validateSignedEnvelope(signed, hmacKey) {
  assert.equal(
    typeof hmacKey,
    "string",
    "ADG_SUBMISSION_HMAC must be a string."
  );
  assert.notEqual(hmacKey.length, 0, "ADG_SUBMISSION_HMAC is required.");
  assert.ok(signed && typeof signed === "object" && !Array.isArray(signed));

  const { hmacSha256, ...envelope } = signed;
  assert.match(hmacSha256, SHA256_PATTERN);

  const expectedHmac = createHmac("sha256", hmacKey)
    .update(JSON.stringify(envelope), "utf8")
    .digest("hex");
  assert.equal(
    timingSafeEqual(
      Buffer.from(hmacSha256, "hex"),
      Buffer.from(expectedHmac, "hex")
    ),
    true,
    "Submission HMAC does not match."
  );

  const schema = envelope?.schema;
  if (schema === SUBMISSION_SCHEMA) {
    await validateSubmissionEnvelope(envelope);
  } else if (schema === COMMENT_SCHEMA) {
    validateCommentEnvelope(envelope);
  } else if (schema === TASK_STATE_SCHEMA) {
    validateTaskStateEnvelope(envelope);
  } else {
    throw new Error(`Unsupported public envelope schema: ${schema}`);
  }

  return {
    evidenceType: classifyEvidenceType(schema),
    envelope,
    metadata: buildEvidenceMetadata(envelope),
    signed
  };
}

export function validateTaskStateEnvelope(envelope) {
  assert.equal(envelope.schema, TASK_STATE_SCHEMA);
  assert.match(envelope.nonce, CONSENSUS_ID_PATTERN);
  assert.match(envelope.eventId, CONSENSUS_ID_PATTERN);
  assert.equal(envelope.eventId, envelope.nonce);
  assert.equal(
    containsForbiddenPublicKeys(envelope),
    false,
    "PII found in task-state envelope."
  );
  assert.match(envelope.taskVersionId, CONSENSUS_ID_PATTERN);
  assert.equal(typeof envelope.taskId, "string");
  assert.ok(envelope.taskId.length > 0 && envelope.taskId.length <= 160);
  assert.ok(Number.isSafeInteger(envelope.taskVersion));
  assert.ok(envelope.taskVersion > 0);
  assert.match(envelope.packetId, PACKET_ID_PATTERN);
  assert.equal(typeof envelope.holdoutId, "string");
  assert.ok(envelope.holdoutId.length > 0 && envelope.holdoutId.length <= 160);
  assert.match(envelope.packetMerkleRoot, SHA256_PATTERN);
  for (const field of [
    "guidelineVersion",
    "dataVersion",
    "protocolVersion"
  ]) {
    assert.equal(typeof envelope[field], "string");
    assert.ok(envelope[field].length > 0 && envelope[field].length <= 160);
  }
  assert.ok(TASK_STATES.has(envelope.state), "Task state is unsupported.");
  assert.ok(Number.isSafeInteger(envelope.stateVersion));
  assert.ok(envelope.stateVersion >= 0);
  assert.ok(Number.isSafeInteger(envelope.round));
  assert.ok(envelope.round > 0);
  if (envelope.roundId !== null) {
    assert.match(envelope.roundId, CONSENSUS_ID_PATTERN);
  }
  assert.equal(
    isIsoUtcTimestamp(envelope.transitionedAtUtc),
    true,
    "Task transition timestamp is invalid."
  );
  assert.equal(envelope.createdAtUtc, envelope.transitionedAtUtc);
  assert.equal(typeof envelope.eventType, "string");
  assert.ok(envelope.eventType.length > 0 && envelope.eventType.length <= 160);
  if (envelope.fromState !== null) {
    assert.ok(
      TASK_STATES.has(envelope.fromState),
      "Prior task state is unsupported."
    );
  }
  assert.equal(envelope.toState, envelope.state);
  assert.equal(typeof envelope.reasonCode, "string");
  assert.ok(
    envelope.reasonCode.length > 0
      && envelope.reasonCode.length <= 160
  );
  assert.ok(
    envelope.evidence
      && typeof envelope.evidence === "object"
      && !Array.isArray(envelope.evidence)
  );
  if (envelope.priorStateHash !== null) {
    assert.match(envelope.priorStateHash, SHA256_PATTERN);
  }
  assert.match(envelope.eventHash, SHA256_PATTERN);
  assertNullableUuid(
    envelope.activeFinalReceiptId,
    "activeFinalReceiptId"
  );
  assert.ok(
    ["not-sent", "pending", "accepted", "rejected"]
      .includes(envelope.repositoryStatus)
  );
  assertValidClaimBoundaries(envelope.claimBoundaries);
}

export async function validateSubmissionEnvelope(envelope) {
  assert.equal(envelope.schema, SUBMISSION_SCHEMA);
  assert.match(envelope.receiptId, LEGACY_RECEIPT_UUID_PATTERN);
  assert.equal(
    containsForbiddenPublicKeys(envelope),
    false,
    "PII found in public envelope."
  );
  assert.match(envelope.artifactSha256, SHA256_PATTERN);
  assert.equal(
    envelope.artifactType,
    envelope.artifact?.kind,
    "Artifact type does not match artifact payload."
  );
  assert.equal(
    await sha256Json(envelope.artifact),
    envelope.artifactSha256,
    "Artifact SHA-256 does not match."
  );
  await validateArtifact(envelope.artifact);
}

export function validateCommentEnvelope(envelope) {
  assert.equal(envelope.schema, COMMENT_SCHEMA);
  assert.match(envelope.commentId, UUID_PATTERN);
  assert.match(envelope.participantPseudonym, COMMENT_PSEUDONYM_PATTERN);
  assert.equal(
    isIsoUtcTimestamp(envelope.receivedAtUtc),
    true,
    "Comment timestamp is invalid."
  );
  assert.match(envelope.packetId, PACKET_ID_PATTERN);
  if (envelope.taskVersionId !== undefined) {
    assert.match(envelope.taskVersionId, CONSENSUS_ID_PATTERN);
  }
  if (envelope.roundId !== undefined) {
    assert.match(envelope.roundId, CONSENSUS_ID_PATTERN);
  }
  assert.match(envelope.sourceReceiptId, UUID_PATTERN);
  assert.equal(
    containsForbiddenPublicKeys(envelope),
    false,
    "PII or hidden identity/provider field found in comment."
  );

  assertNullableUuid(envelope.targetReceiptId, "targetReceiptId");
  assertNullableSha256(envelope.targetArtifactSha256, "targetArtifactSha256");
  assertNullableUuid(envelope.parentCommentId, "parentCommentId");
  assert.ok(
    COMMENT_CATEGORIES.has(envelope.category),
    "Comment category is not supported."
  );

  assert.equal(typeof envelope.body, "string");
  assert.ok(
    envelope.body.length >= 20 && envelope.body.length <= 4000,
    "Comment body length is out of range."
  );
  assert.equal(
    containsUnsafeCommentBody(envelope.body),
    false,
    "Comment body contains disallowed public content."
  );

  assertValidLocation(envelope.location);
  assertValidMentions(envelope.mentions);
  assertValidResultReferences(envelope.resultReferences);

  assert.deepEqual(
    envelope.attestation,
    {
      authoredAfterIndependentSubmission: true,
      publicTechnicalDiscussion: true
    },
    "Comment attestation is incomplete."
  );

  assertValidClaimBoundaries(envelope.claimBoundaries);
}

export function buildEvidenceMetadata(envelope) {
  const evidenceType = classifyEvidenceType(envelope.schema);
  if (evidenceType === SUBMISSION_EVIDENCE_TYPE) {
    const identifier = envelope.receiptId;
    assert.match(identifier, LEGACY_RECEIPT_UUID_PATTERN);
    const packetId = envelope.artifact?.packet?.packetId
      ?? envelope.artifact?.primaryArtifact?.packet?.packetId;
    assert.match(packetId, PACKET_ID_PATTERN);
    return {
      evidenceType,
      identifier,
      packetId,
      artifactType: envelope.artifactType,
      artifactSha256: envelope.artifactSha256,
      relativeJsonPath: safeEvidenceRelativePath(evidenceType, identifier, "json"),
      relativeMarkdownPath: safeEvidenceRelativePath(evidenceType, identifier, "md")
    };
  }
  if (evidenceType === TASK_STATE_EVIDENCE_TYPE) {
    const identifier = envelope.eventId;
    assert.match(identifier, CONSENSUS_ID_PATTERN);
    assert.match(envelope.taskVersionId, CONSENSUS_ID_PATTERN);
    assert.match(envelope.packetId, PACKET_ID_PATTERN);
    const taskPathId = Buffer.from(
      envelope.taskVersionId,
      "utf8"
    ).toString("base64url");
    const eventPathId = Buffer.from(
      envelope.eventId,
      "utf8"
    ).toString("base64url");
    const relativeRoot = posix.join(
      "human-evidence/task-state",
      taskPathId
    );
    const filename = `${envelope.stateVersion}-${eventPathId}`;
    return {
      evidenceType,
      identifier,
      packetId: envelope.packetId,
      taskVersionId: envelope.taskVersionId,
      state: envelope.state,
      stateVersion: envelope.stateVersion,
      eventId: envelope.eventId,
      relativeJsonPath: posix.join(relativeRoot, `${filename}.json`),
      relativeMarkdownPath: posix.join(relativeRoot, `${filename}.md`)
    };
  }

  const identifier = envelope.commentId;
  assert.match(identifier, UUID_PATTERN);
  assert.match(envelope.packetId, PACKET_ID_PATTERN);
  return {
    evidenceType,
    identifier,
    packetId: envelope.packetId,
    category: envelope.category,
    taskVersionId: envelope.taskVersionId,
    roundId: envelope.roundId,
    sourceReceiptId: envelope.sourceReceiptId,
    targetReceiptId: envelope.targetReceiptId,
    targetArtifactSha256: envelope.targetArtifactSha256,
    relativeJsonPath: safeEvidenceRelativePath(evidenceType, identifier, "json"),
    relativeMarkdownPath: safeEvidenceRelativePath(evidenceType, identifier, "md")
  };
}

export function safeEvidenceRelativePath(evidenceType, identifier, extension) {
  const root =
    evidenceType === SUBMISSION_EVIDENCE_TYPE
      ? "human-evidence/inbox"
      : evidenceType === COMMENT_EVIDENCE_TYPE
        ? "human-evidence/comments"
        : null;
  assert.ok(root, `Unknown evidence type: ${evidenceType}`);
  const pattern =
    evidenceType === SUBMISSION_EVIDENCE_TYPE
      ? LEGACY_RECEIPT_UUID_PATTERN
      : UUID_PATTERN;
  assert.match(identifier, pattern);
  assert.ok(extension === "json" || extension === "md");
  return posix.join(root, `${identifier}.${extension}`);
}

export function classifyEvidenceType(schema) {
  if (schema === SUBMISSION_SCHEMA) return SUBMISSION_EVIDENCE_TYPE;
  if (schema === COMMENT_SCHEMA) return COMMENT_EVIDENCE_TYPE;
  if (schema === TASK_STATE_SCHEMA) return TASK_STATE_EVIDENCE_TYPE;
  throw new Error(`Unsupported public envelope schema: ${schema}`);
}

export async function readSignedEnvelope(inputPath) {
  return JSON.parse(await readFile(inputPath, "utf8"));
}

export async function writeValidatedEnvelope(outputPath, signed) {
  await writeFile(outputPath, JSON.stringify(signed, null, 2) + "\n", "utf8");
}

export async function runCli(args = process.argv.slice(2)) {
  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: node import-msa-portal-submission.mjs <input> <output>"
    );
  }

  const hmacKey = process.env.ADG_SUBMISSION_HMAC;
  if (!hmacKey) {
    throw new Error("ADG_SUBMISSION_HMAC is required.");
  }

  const signed = await readSignedEnvelope(inputPath);
  const result = await validateSignedEnvelope(signed, hmacKey);
  await writeValidatedEnvelope(outputPath, result.signed);
  console.log(JSON.stringify(result.metadata));
}

async function validateArtifact(artifact) {
  assert.equal(artifact.schema, "adg-msa-portal-artifact-v1");
  assert.ok(
    ARTIFACT_TYPES.has(artifact.kind),
    "Artifact kind is not supported."
  );
  validatePublicArtifactText(artifact);
  if (artifact.kind === "ratification-package") {
    const primary = artifact.primaryArtifact;
    assert.equal(primary?.schema, "adg-msa-portal-artifact-v1");
    assert.equal(primary?.kind, "adjudication-package");
    await validateAdjudicationBinding(
      primary.packet,
      primary.annotationA,
      primary.annotationB,
      primary.adjudication
    );
    await validateRatificationBinding(primary, artifact.ratification);
    assert.match(
      await computeRatificationMerkleRoot(
        primary,
        artifact.ratification
      ),
      SHA256_PATTERN
    );
    return;
  }
  validatePacket(artifact.packet);
  assert.equal(artifact.packet.schema, "adg-msa-adjudication-packet-v3");
  assert.match(await computePacketMerkleRoot(artifact.packet), SHA256_PATTERN);

  if (artifact.kind === "independent-annotation") {
    await validateSubmissionBinding(artifact.packet, artifact.annotation);
    assert.match(
      await computeAnnotationMerkleRoot(
        artifact.packet,
        artifact.annotation
      ),
      SHA256_PATTERN
    );
    return;
  }

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
      artifact.adjudication
    ),
    SHA256_PATTERN
  );
}

function containsForbiddenPublicKeys(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenPublicKeys);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    isForbiddenPublicKey(key) || containsForbiddenPublicKeys(child)
  );
}

function isForbiddenPublicKey(key) {
  const normalized = String(key).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return FORBIDDEN_PUBLIC_KEYS.has(normalized)
    || normalized.includes("identity")
    || normalized.includes("provider");
}

function containsUnsafeCommentBody(body) {
  return EMAIL_PATTERN.test(body)
    || PHONE_LIKE_PATTERN.test(body)
    || RAW_HTML_PATTERN.test(body)
    || MARKDOWN_IMAGE_PATTERN.test(body)
    || DANGEROUS_URL_PATTERN.test(body)
    || CONTROL_CHARACTER_PATTERN.test(body);
}

function assertValidLocation(location) {
  assert.ok(location && typeof location === "object" && !Array.isArray(location));
  const { sentenceId, tokenId } = location;
  if (sentenceId !== null) {
    assert.equal(typeof sentenceId, "string");
    assert.ok(sentenceId.length > 0 && sentenceId.length <= 160);
    assert.equal(
      CONTROL_CHARACTER_PATTERN.test(sentenceId),
      false,
      "location.sentenceId contains control characters."
    );
  }
  if (tokenId !== null) {
    assert.ok(Number.isSafeInteger(tokenId) && tokenId > 0);
  }
}

function assertValidMentions(mentions) {
  assert.ok(Array.isArray(mentions), "mentions must be an array.");
  assert.ok(mentions.length <= 20, "mentions exceed the allowed maximum.");
  for (const mention of mentions) {
    assert.ok(mention && typeof mention === "object" && !Array.isArray(mention));
    assert.match(mention.receiptId, UUID_PATTERN);
    assert.match(mention.pseudonym, COMMENT_PSEUDONYM_PATTERN);
  }
}

function assertValidResultReferences(resultReferences) {
  assert.ok(
    Array.isArray(resultReferences),
    "resultReferences must be an array."
  );
  assert.ok(
    resultReferences.length <= 20,
    "resultReferences exceed the allowed maximum."
  );
  for (const reference of resultReferences) {
    assert.ok(
      reference && typeof reference === "object" && !Array.isArray(reference)
    );
    assert.match(reference.receiptId, UUID_PATTERN);
    assert.match(reference.artifactSha256, SHA256_PATTERN);
    assert.ok(
      ARTIFACT_TYPES.has(reference.kind),
      "result reference kind is not supported."
    );
    assert.match(reference.pseudonym, COMMENT_PSEUDONYM_PATTERN);
    assert.equal(typeof reference.isFinal, "boolean");
  }
}

function assertValidClaimBoundaries(claimBoundaries) {
  assert.ok(Array.isArray(claimBoundaries), "claimBoundaries must be an array.");
  assert.ok(
    claimBoundaries.length > 0 && claimBoundaries.length <= 40,
    "claimBoundaries length is invalid."
  );
  for (const claim of claimBoundaries) {
    assert.equal(typeof claim, "string");
    const trimmed = claim.trim();
    assert.ok(
      trimmed.length > 0 && trimmed.length <= 500,
      "A claim boundary is empty or too long."
    );
    assert.equal(
      CONTROL_CHARACTER_PATTERN.test(claim),
      false,
      "A claim boundary contains control characters."
    );
  }
}

function assertNullableUuid(value, fieldName) {
  if (value === null) return;
  assert.match(value, UUID_PATTERN, `${fieldName} must be a UUID or null.`);
}

function assertNullableSha256(value, fieldName) {
  if (value === null) return;
  assert.match(value, SHA256_PATTERN, `${fieldName} must be a SHA-256 or null.`);
}

function isIsoUtcTimestamp(value) {
  return typeof value === "string"
    && ISO_UTC_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value));
}

const isDirectExecution =
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await runCli();
}
