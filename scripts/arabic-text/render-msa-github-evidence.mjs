import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  computeRatificationMerkleRoot
} from "../../tools/msa-adjudication-workbench/public/protocol.js";
import {
  COMMENT_EVIDENCE_TYPE,
  SUBMISSION_EVIDENCE_TYPE,
  TASK_STATE_EVIDENCE_TYPE,
  buildEvidenceMetadata,
  classifyEvidenceType
} from "./import-msa-portal-submission.mjs";

export async function renderEvidenceMarkdownFromPath(validatedJsonPath, outputPath) {
  const signed = JSON.parse(await readFile(validatedJsonPath, "utf8"));
  const markdown = await renderEvidenceMarkdown(signed, {
    outputPath
  });
  await writeFile(outputPath, markdown, "utf8");
}

export async function renderEvidenceMarkdown(signed, options = {}) {
  assert.ok(signed && typeof signed === "object" && !Array.isArray(signed));
  const { hmacSha256, ...envelope } = signed;
  void hmacSha256;

  const metadata = buildEvidenceMetadata(envelope);
  const evidenceType = classifyEvidenceType(envelope.schema);
  const lines = [];

  lines.push(
    evidenceType === SUBMISSION_EVIDENCE_TYPE
      ? "# بطاقة دليل التحكيم / Adjudication evidence card"
      : evidenceType === COMMENT_EVIDENCE_TYPE
        ? "# تعليق علمي بعد الإرسال / Post-submission scientific comment"
        : "# سجل حالة مهمة موثّق / Bound task-state record",
    "",
    "> [!WARNING]",
    "> هذه المادة مستوردة تقنيًا فقط، وتبقى غير موثوقة حتى تراجعها الصيانة العلمية والأمنية وسلامة الادعاء.",
    "> This imported record is untrusted until maintainers review provenance, integrity, and claim boundaries.",
    ""
  );

  if (evidenceType === SUBMISSION_EVIDENCE_TYPE) {
    lines.push(...await renderSubmission(envelope, metadata));
  } else if (evidenceType === COMMENT_EVIDENCE_TYPE) {
    lines.push(...renderComment(envelope, metadata, options.outputPath));
  } else {
    assert.equal(evidenceType, TASK_STATE_EVIDENCE_TYPE);
    lines.push(...renderTaskState(envelope, metadata));
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function escapePublicText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200b");
}

function escapeTableCell(value) {
  return displayValue(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return escapePublicText(value);
}

async function renderSubmission(envelope, metadata) {
  const packet = envelope.artifact.kind === "ratification-package"
    ? envelope.artifact.primaryArtifact.packet
    : envelope.artifact.packet;
  const packetRoot = await computePacketMerkleRoot(packet);
  const machineBinding = {
    schema: envelope.schema,
    receiptId: envelope.receiptId,
    packetId: metadata.packetId,
    artifactType: envelope.artifactType,
    artifactSha256: envelope.artifactSha256,
    packetMerkleRoot: packetRoot
  };

  if (envelope.artifact.kind === "independent-annotation") {
    machineBinding.annotationMerkleRoot = await computeAnnotationMerkleRoot(
      envelope.artifact.packet,
      envelope.artifact.annotation
    );
    machineBinding.annotatorSlot = envelope.artifact.annotation.annotatorSlot;
  } else if (envelope.artifact.kind === "adjudication-package") {
    machineBinding.annotationAMerkleRoot =
      envelope.artifact.adjudication.annotationAMerkleRoot;
    machineBinding.annotationBMerkleRoot =
      envelope.artifact.adjudication.annotationBMerkleRoot;
    machineBinding.adjudicationMerkleRoot =
      await computeAdjudicationMerkleRoot(
        envelope.artifact.packet,
        envelope.artifact.annotationA,
        envelope.artifact.annotationB,
        envelope.artifact.adjudication
      );
  } else {
    machineBinding.primaryReceiptId =
      envelope.artifact.ratification.primaryReceiptId;
    machineBinding.primaryAdjudicationMerkleRoot =
      envelope.artifact.ratification.primaryAdjudicationMerkleRoot;
    machineBinding.ratificationDecision =
      envelope.artifact.ratification.decision;
    machineBinding.ratificationMerkleRoot =
      await computeRatificationMerkleRoot(
        envelope.artifact.primaryArtifact,
        envelope.artifact.ratification
      );
  }

  return [
    "## بيانات تقنية / Technical metadata",
    "",
    "| الحقل / Field | القيمة / Value |",
    "| --- | --- |",
    `| النوع / Type | ${escapeTableCell("submission")} |`,
    `| المعرّف / Identifier | \`${escapePublicText(metadata.identifier)}\` |`,
    `| الحزمة / Packet | \`${escapePublicText(metadata.packetId)}\` |`,
    `| الاسم المستعار / Pseudonym | \`${escapePublicText(envelope.participantPseudonym)}\` |`,
    `| وقت الاستلام / Received at | \`${escapePublicText(envelope.receivedAtUtc)}\` |`,
    `| نوع الأثر / Artifact kind | \`${escapePublicText(envelope.artifactType)}\` |`,
    `| بصمة الأثر / Artifact SHA-256 | \`${escapePublicText(envelope.artifactSha256)}\` |`,
    "",
    "## حدود الادعاء / Claim boundaries",
    "",
    ...envelope.claimBoundaries.map(claim => `- ${escapePublicText(claim)}`),
    "",
    "## التعهدات العامة / Public attestation",
    "",
    "| البند / Item | القيمة / Value |",
    "| --- | --- |",
    `| الاستقلال / Independent | ${yesNo(envelope.attestation?.independent)} |`,
    `| التعمية / Blind | ${yesNo(envelope.attestation?.blind)} |`,
    `| الأصالة / Authentic | ${yesNo(envelope.attestation?.authentic)} |`,
    "",
    "## الربط الآلي / Machine binding",
    "",
    "```json",
    JSON.stringify(machineBinding, null, 2),
    "```",
    ""
  ];
}

function renderTaskState(envelope, metadata) {
  const machineBinding = {
    schema: envelope.schema,
    eventId: envelope.eventId,
    taskVersionId: envelope.taskVersionId,
    taskId: envelope.taskId,
    taskVersion: envelope.taskVersion,
    packetId: envelope.packetId,
    packetMerkleRoot: envelope.packetMerkleRoot,
    protocolVersion: envelope.protocolVersion,
    state: envelope.state,
    stateVersion: envelope.stateVersion,
    round: envelope.round,
    activeFinalReceiptId: envelope.activeFinalReceiptId,
    eventType: envelope.eventType,
    fromState: envelope.fromState,
    toState: envelope.toState,
    reasonCode: envelope.reasonCode,
    evidence: envelope.evidence,
    priorStateHash: envelope.priorStateHash,
    eventHash: envelope.eventHash
  };
  return [
    "## بيانات تقنية / Technical metadata",
    "",
    "| الحقل / Field | القيمة / Value |",
    "| --- | --- |",
    `| النوع / Type | ${escapeTableCell("task-state")} |`,
    `| الحدث / Event | \`${escapePublicText(metadata.eventId)}\` |`,
    `| نسخة المهمة / Task version | \`${escapePublicText(metadata.taskVersionId)}\` |`,
    `| الحزمة / Packet | \`${escapePublicText(metadata.packetId)}\` |`,
    `| الحالة / State | \`${escapePublicText(envelope.state)}\` |`,
    `| رقم الحالة / State version | \`${escapePublicText(envelope.stateVersion)}\` |`,
    `| الجولة / Round | \`${escapePublicText(envelope.round)}\` |`,
    `| وقت الانتقال / Transitioned at | \`${escapePublicText(envelope.transitionedAtUtc)}\` |`,
    "",
    "## حدود الادعاء / Claim boundaries",
    "",
    ...envelope.claimBoundaries.map(claim => `- ${escapePublicText(claim)}`),
    "",
    "## الربط الآلي / Machine binding",
    "",
    "```json",
    JSON.stringify(machineBinding, null, 2),
    "```",
    ""
  ];
}

function renderComment(envelope, metadata, outputPath) {
  const sourceLink = inboxReceiptLink(envelope.sourceReceiptId, outputPath);
  const targetLink = envelope.targetReceiptId
    ? inboxReceiptLink(envelope.targetReceiptId, outputPath)
    : "—";
  const categoryDescriptor = describeCommentCategory(envelope);
  const machineBinding = {
    schema: envelope.schema,
    commentId: envelope.commentId,
    packetId: envelope.packetId,
    sourceReceiptId: envelope.sourceReceiptId,
    targetReceiptId: envelope.targetReceiptId,
    targetArtifactSha256: envelope.targetArtifactSha256,
    parentCommentId: envelope.parentCommentId,
    category: envelope.category,
    location: envelope.location,
    mentions: envelope.mentions.length,
    resultReferences: envelope.resultReferences.length
  };

  const lines = [
    "## بيانات تقنية / Technical metadata",
    "",
    "| الحقل / Field | القيمة / Value |",
    "| --- | --- |",
    `| النوع / Type | ${escapeTableCell("comment")} |`,
    `| المعرّف / Identifier | \`${escapePublicText(metadata.identifier)}\` |`,
    `| الحزمة / Packet | \`${escapePublicText(metadata.packetId)}\` |`,
    `| الفئة / Category | ${escapeTableCell(`${categoryDescriptor.title} (${categoryDescriptor.label})`)} |`,
    `| صاحب التعليق / Author pseudonym | \`${escapePublicText(envelope.participantPseudonym)}\` |`,
    `| وقت الاستلام / Received at | \`${escapePublicText(envelope.receivedAtUtc)}\` |`,
    `| إيصال المصدر / Source receipt | ${sourceLink} |`,
    `| الإيصال المستهدف / Target receipt | ${targetLink} |`,
    `| بصمة الهدف / Target SHA-256 | ${envelope.targetArtifactSha256 ? `\`${escapePublicText(envelope.targetArtifactSha256)}\`` : "—"} |`,
    `| التعليق الأب / Parent comment | ${envelope.parentCommentId ? `\`${escapePublicText(envelope.parentCommentId)}\`` : "—"} |`,
    `| الموضع / Location | ${escapeTableCell(formatLocation(envelope.location))} |`,
    "",
    "## تصنيف GitHub / GitHub-native label",
    "",
    `- label: \`${escapePublicText(categoryDescriptor.label)}\``,
    `- meaning: ${escapePublicText(categoryDescriptor.title)}`,
    `- review boundary: ${escapePublicText(categoryDescriptor.reviewBoundary)}`,
    "",
    "## نص التعليق المنقّح / Sanitized comment body",
    "",
    "```text",
    sanitizeCommentBody(envelope.body),
    "```",
    "",
    "## حدود الادعاء / Claim boundaries",
    "",
    ...envelope.claimBoundaries.map(claim => `- ${escapePublicText(claim)}`),
    "",
    "## الإشارات / Mentions",
    ""
  ];

  if (envelope.mentions.length === 0) {
    lines.push("- لا توجد إشارات علنية إضافية. / No additional public mentions.");
  } else {
    lines.push(
      ...envelope.mentions.map(mention =>
        `- \`${escapePublicText(mention.pseudonym)}\` → `
        + `${inboxReceiptLink(mention.receiptId, outputPath)}`
      )
    );
  }

  lines.push(
    "",
    "## مراجع النتائج / Result references",
    ""
  );

  if (envelope.resultReferences.length === 0) {
    lines.push("- لا توجد مراجع نتائج مصرح بها. / No declared result references.");
  } else {
    lines.push(
      ...envelope.resultReferences.map(reference =>
        `- ${inboxReceiptLink(reference.receiptId, outputPath)} — `
        + `\`${escapePublicText(reference.pseudonym)}\` — `
        + `\`${escapePublicText(reference.kind)}\` — `
        + `final: \`${reference.isFinal ? "true" : "false"}\`` + " — "
        + `sha256 \`${escapePublicText(reference.artifactSha256)}\``
      )
    );
  }

  lines.push(
    "",
    "## الربط الآلي / Machine binding",
    "",
    "```json",
    JSON.stringify(machineBinding, null, 2),
    "```",
    ""
  );

  return lines;
}

function sanitizeCommentBody(body) {
  return escapePublicText(body).replace(/```/g, "``\u200b`");
}

function describeCommentCategory(envelope) {
  const hasFinalReference = envelope.resultReferences.some(reference => reference.isFinal);
  const disagreementBoundary = hasFinalReference
    ? "A bound final-result artifact is referenced, but maintainers must still verify repository-approved consensus before treating any disagreement, escalation, or appeal as an established error."
    : "This record does not establish an error by itself. Disagreement, escalation, and appeal remain review-state discussion unless a separately bound approved consensus/final-result record is referenced.";

  const categoryMap = {
    agreement: {
      label: "discussion:agreement",
      title: "Agreement / اتفاق",
      reviewBoundary: "Records alignment on a public technical point; it is not a merge decision or approval by itself."
    },
    disagreement: {
      label: "discussion:disagreement",
      title: "Disagreement / اعتراض علمي",
      reviewBoundary: disagreementBoundary
    },
    question: {
      label: "discussion:question",
      title: "Question / سؤال",
      reviewBoundary: "Requests clarification only; it does not assert a defect or repository conclusion."
    },
    clarification: {
      label: "discussion:clarification",
      title: "Clarification / إيضاح",
      reviewBoundary: "Supplies public clarification only; it does not by itself settle the underlying technical or scientific claim."
    },
    evidence: {
      label: "discussion:evidence",
      title: "Evidence / شاهد",
      reviewBoundary: "Points to public evidence for review; repository conclusions still depend on bound artifacts and maintainer assessment."
    },
    "final-result": {
      label: "discussion:final-result",
      title: "Final result / نتيجة نهائية",
      reviewBoundary: "Claims a final-result discussion state, but repository conclusions still depend on the bound final artifact and maintainer approval."
    },
    "consensus-proposal": {
      label: "discussion:consensus-proposal",
      title: "Consensus proposal / مقترح توافق",
      reviewBoundary: "Proposes a consensus path for review; it does not become repository-approved consensus unless maintainers separately bind and approve the referenced result."
    },
    escalation: {
      label: "discussion:escalation",
      title: "Escalation / تصعيد للمراجعة",
      reviewBoundary: disagreementBoundary
    },
    appeal: {
      label: "discussion:appeal",
      title: "Appeal / التماس مراجعة",
      reviewBoundary: disagreementBoundary
    },
    recusal: {
      label: "discussion:recusal",
      title: "Recusal / تنحٍّ",
      reviewBoundary: "Records a conflict-of-interest recusal. It changes eligibility only after the bound task-state protocol accepts the recusal."
    }
  };

  const description = categoryMap[envelope.category];
  assert.ok(description, `Unsupported comment category: ${envelope.category}`);
  return description;
}

function yesNo(value) {
  if (value === true) return "نعم / yes";
  if (value === false) return "لا / no";
  return "—";
}

function formatLocation(location) {
  const sentence = location?.sentenceId ? `sentence:${location.sentenceId}` : "sentence:—";
  const token = location?.tokenId ? `token:${location.tokenId}` : "token:—";
  return `${sentence}, ${token}`;
}

function inboxReceiptLink(receiptId, outputPath) {
  const relativeDisplay = `human-evidence/inbox/${receiptId}.json`;
  if (!outputPath) {
    return `\`${escapePublicText(relativeDisplay)}\``;
  }

  const normalizedOutput = resolve(outputPath).split(path.sep).join("/");
  let linkHref = relativeDisplay;
  if (normalizedOutput.includes("/human-evidence/comments/")) {
    linkHref = `../inbox/${receiptId}.json`;
  } else if (normalizedOutput.includes("/human-evidence/inbox/")) {
    linkHref = `./${receiptId}.json`;
  }
  return `[${escapePublicText(relativeDisplay)}](${escapePublicText(linkHref)})`;
}

export async function runCli(args = process.argv.slice(2)) {
  const [validatedJsonPath, outputPath] = args;
  if (!validatedJsonPath || !outputPath) {
    throw new Error(
      "Usage: node render-msa-github-evidence.mjs <validated-json> <output-md>"
    );
  }
  await renderEvidenceMarkdownFromPath(validatedJsonPath, outputPath);
}

const isDirectExecution =
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await runCli();
}
