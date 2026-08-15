import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildEvidenceMetadata,
  validateSignedEnvelope
} from "../../../scripts/arabic-text/import-msa-portal-submission.mjs";
import {
  renderEvidenceMarkdown
} from "../../../scripts/arabic-text/render-msa-github-evidence.mjs";
import {
  RATIFICATION_SCHEMA,
  computeAdjudicationMerkleRoot,
  computePacketMerkleRoot,
  sha256Json
} from "../public/protocol.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const repositoryRootPath = fileURLToPath(repositoryRoot);
const importCliPath = fileURLToPath(new URL(
  "scripts/arabic-text/import-msa-portal-submission.mjs",
  repositoryRoot
));
const renderCliPath = fileURLToPath(new URL(
  "scripts/arabic-text/render-msa-github-evidence.mjs",
  repositoryRoot
));
const exampleDir = new URL(
  "examples/arabic-text/msa-adjudication-pilot-v1/",
  repositoryRoot
);
const hmacKey = "test-public-envelope-hmac";

test("valid submission backward compatibility remains accepted by the CLI", async t => {
  const dir = await createScratchDir(t, "submission-cli");
  const envelope = await createSubmissionEnvelope();
  const signed = signEnvelope(envelope, hmacKey);
  const inputPath = `${dir}/submission-input.json`;
  const outputPath = `${dir}/submission-output.json`;

  await writeJsonFile(inputPath, signed);
  const result = runNode(importCliPath, [inputPath, outputPath], {
    ADG_SUBMISSION_HMAC: hmacKey
  });

  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout.trim());
  assert.deepEqual(metadata, {
    evidenceType: "submission",
    identifier: envelope.receiptId,
    packetId: envelope.artifact.packet.packetId,
    artifactType: envelope.artifactType,
    artifactSha256: envelope.artifactSha256,
    relativeJsonPath: `human-evidence/inbox/${envelope.receiptId}.json`,
    relativeMarkdownPath: `human-evidence/inbox/${envelope.receiptId}.md`
  });

  assert.deepEqual(
    JSON.parse(await readFile(outputPath, "utf8")),
    signed
  );
});

test("operational tests render explicit non-independent public evidence", async () => {
  const envelope = await createSubmissionEnvelope();
  envelope.submissionMode = "operational-test";
  envelope.attestation = {
    independent: false,
    blind: false,
    authentic: true
  };
  envelope.artifact.annotation.independentFromImplementationTeam = false;
  envelope.artifact.annotation.blindToParserInternals = false;
  envelope.artifactSha256 = await sha256Json(envelope.artifact);
  envelope.claimBoundaries = [
    "This is an assisted operational test, not independent adjudication.",
    "This test does not occupy A, B, J1, or J2 and does not affect consensus."
  ];
  const signed = signEnvelope(envelope, hmacKey);

  await assert.doesNotReject(() => validateSignedEnvelope(signed, hmacKey));
  const markdown = await renderEvidenceMarkdown(signed);
  assert.match(markdown, /operational-test/);
  assert.match(markdown, /\| الاستقلال \/ Independent \| لا \/ no \|/);
  assert.match(markdown, /\| التعمية \/ Blind \| لا \/ no \|/);
  assert.match(markdown, /\| الأصالة \/ Authentic \| نعم \/ yes \|/);
  assert.match(markdown, /does not occupy A, B, J1, or J2/);
});

test("valid signed comments validate, emit safe metadata, and render markdown", async t => {
  const dir = await createScratchDir(t, "comment-cli");
  const submission = await createSubmissionEnvelope();
  const comment = await createCommentEnvelope(submission);
  const signed = signEnvelope(comment, hmacKey);
  const inputPath = `${dir}/comment-input.json`;
  const validatedPath = `${dir}/comment-output.json`;
  const markdownDir = `${dir}/human-evidence/comments`;
  const markdownPath = `${markdownDir}/comment-output.md`;

  await writeJsonFile(inputPath, signed);
  const importResult = runNode(importCliPath, [inputPath, validatedPath], {
    ADG_SUBMISSION_HMAC: hmacKey
  });
  assert.equal(importResult.status, 0, importResult.stderr);

  const metadata = JSON.parse(importResult.stdout.trim());
  assert.deepEqual(metadata, {
    evidenceType: "comment",
    identifier: comment.commentId,
    packetId: comment.packetId,
    category: comment.category,
    sourceReceiptId: comment.sourceReceiptId,
    targetReceiptId: comment.targetReceiptId,
    targetArtifactSha256: comment.targetArtifactSha256,
    relativeJsonPath: `human-evidence/comments/${comment.commentId}.json`,
    relativeMarkdownPath: `human-evidence/comments/${comment.commentId}.md`
  });

  await mkdir(markdownDir, { recursive: true });
  const renderResult = runNode(renderCliPath, [validatedPath, markdownPath]);
  assert.equal(renderResult.status, 0, renderResult.stderr);

  const markdown = await readFile(markdownPath, "utf8");
  assert.match(markdown, /Post-submission scientific comment/);
  assert.match(markdown, /@\u200breviewer/);
  assert.match(markdown, /`adg-fedcba987654`/);
  assert.match(
    markdown,
    new RegExp(`\\[human-evidence/inbox/${comment.sourceReceiptId}\\.json\\]\\(\\.\\./inbox/${comment.sourceReceiptId}\\.json\\)`)
  );
});

test("HMAC mismatches are rejected", async t => {
  const dir = await createScratchDir(t, "bad-hmac");
  const envelope = await createSubmissionEnvelope();
  const signed = signEnvelope(envelope, "wrong-hmac-key");
  const inputPath = `${dir}/input.json`;
  const outputPath = `${dir}/output.json`;

  await writeJsonFile(inputPath, signed);
  const result = runNode(importCliPath, [inputPath, outputPath], {
    ADG_SUBMISSION_HMAC: hmacKey
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HMAC/i);
});

test("PII-bearing comment keys and unsafe public body content are rejected", async () => {
  const submission = await createSubmissionEnvelope();

  const commentWithEmail = signEnvelope({
    ...await createCommentEnvelope(submission),
    body: "Please email me at judge@example.test with the private notes."
  }, hmacKey);
  await assert.rejects(
    () => validateSignedEnvelope(commentWithEmail, hmacKey),
    /disallowed public content/i
  );

  const commentWithIdentity = signEnvelope({
    ...await createCommentEnvelope(submission),
    profile: {
      email: "judge@example.test"
    }
  }, hmacKey);
  await assert.rejects(
    () => validateSignedEnvelope(commentWithIdentity, hmacKey),
    /identity\/provider field/i
  );
});

test("PII-bearing artifact notes are rejected before public import", async () => {
  const envelope = await createSubmissionEnvelope();
  envelope.artifact.annotation.sentences[0].note =
    "تواصل معي على judge@example.test لمراجعة هذه الجملة.";
  envelope.artifactSha256 = await sha256Json(envelope.artifact);
  await assert.rejects(
    () => validateSignedEnvelope(signEnvelope(envelope, hmacKey), hmacKey),
    /بيانات تواصل/
  );
});

test("rendering neutralizes GitHub mentions and preserves only safe inbox references", async () => {
  const submission = await createSubmissionEnvelope();
  const comment = signEnvelope({
    ...await createCommentEnvelope(submission),
    body: "Please @reviewer compare the token note with the linked result."
  }, hmacKey);

  const markdown = await renderEvidenceMarkdown(comment, {
    outputPath: fileURLToPath(new URL(
      "human-evidence/comments/demo.md",
      repositoryRoot
    ))
  });

  assert.equal(markdown.includes("@reviewer"), false);
  assert.match(markdown, /@\u200breviewer/);
  assert.match(markdown, /`adg-fedcba987654`/);
  assert.match(markdown, /\.\.\/inbox\//);
  assert.equal(markdown.includes("!["), false);
});

test("metadata paths are derived only from validated identifiers", async () => {
  const submission = await createSubmissionEnvelope();
  const comment = await createCommentEnvelope(submission);
  const submissionMetadata = buildEvidenceMetadata(submission);
  const commentMetadata = buildEvidenceMetadata(comment);

  assert.equal(
    submissionMetadata.relativeJsonPath,
    `human-evidence/inbox/${submission.receiptId}.json`
  );
  assert.equal(
    commentMetadata.relativeJsonPath,
    `human-evidence/comments/${comment.commentId}.json`
  );
  assert.equal(submissionMetadata.relativeJsonPath.includes(".."), false);
  assert.equal(commentMetadata.relativeJsonPath.includes(".."), false);
  assert.equal(submissionMetadata.relativeJsonPath.includes("\\"), false);
  assert.equal(commentMetadata.relativeJsonPath.includes("\\"), false);
});

test("extended discussion categories validate and render GitHub-native labels", async () => {
  const submission = await createSubmissionEnvelope();
  const cases = [
    {
      category: "consensus-proposal",
      title: "Consensus proposal / مقترح توافق"
    },
    {
      category: "escalation",
      title: "Escalation / تصعيد للمراجعة"
    },
    {
      category: "appeal",
      title: "Appeal / التماس مراجعة"
    },
    {
      category: "recusal",
      title: "Recusal / تنحٍّ"
    }
  ];

  for (const entry of cases) {
    const signed = signEnvelope(
      await createCommentEnvelope(submission, {
        category: entry.category
      }),
      hmacKey
    );
    await assert.doesNotReject(() => validateSignedEnvelope(signed, hmacKey));
    const markdown = await renderEvidenceMarkdown(signed, {
      outputPath: fileURLToPath(new URL(
        "human-evidence/comments/demo.md",
        repositoryRoot
      ))
    });
    assert.match(markdown, new RegExp("`discussion:" + entry.category + "`"));
    assert.match(markdown, new RegExp(escapeRegex(entry.title)));
  }
});

test("disagreement-like categories are rendered as review-state, not established error", async () => {
  const submission = await createSubmissionEnvelope();
  const signed = signEnvelope(
    await createCommentEnvelope(submission, {
      category: "disagreement",
      resultReferences: []
    }),
    hmacKey
  );

  const markdown = await renderEvidenceMarkdown(signed, {
    outputPath: fileURLToPath(new URL(
      "human-evidence/comments/demo.md",
      repositoryRoot
    ))
  });

  assert.match(markdown, /does not establish an error by itself/i);
  assert.match(
    markdown,
    /separately bound approved consensus\/final-result record/i
  );
});

test("J2 ratification packages validate as bound public evidence", async () => {
  const envelope = await createRatificationEnvelope();
  const signed = signEnvelope(envelope, hmacKey);
  const result = await validateSignedEnvelope(signed, hmacKey);

  assert.equal(result.metadata.evidenceType, "submission");
  assert.equal(result.metadata.artifactType, "ratification-package");
  const markdown = await renderEvidenceMarkdown(signed);
  assert.match(markdown, /ratification-package/);
  assert.match(markdown, /ratificationMerkleRoot/);
});

test("task-state records use Windows-safe deterministic paths", async () => {
  const envelope = {
    schema: "adg-msa-task-state-v1",
    nonce: "77777777-7777-4777-8777-777777777777",
    eventId: "77777777-7777-4777-8777-777777777777",
    taskVersionId: "msa-adjudication-pilot:v1",
    taskId: "msa-adjudication-pilot",
    taskVersion: 1,
    packetId: "msa-adjudication-pilot-v1",
    holdoutId: "pilot-authored-msa-not-final",
    packetMerkleRoot: "a".repeat(64),
    guidelineVersion: "msa-human-guidelines-v1",
    dataVersion: "pilot-authored-msa-v1",
    protocolVersion: "adg-consensus-policy-v1",
    state: "approved",
    stateVersion: 4,
    round: 1,
    roundId: "msa-adjudication-pilot:v1:r1",
    eventType: "secondary-ratification-approved",
    fromState: "final-review",
    toState: "approved",
    reasonCode: "j2-exact-root-cosign",
    evidence: {
      finalMerkleRoot: "b".repeat(64)
    },
    priorStateHash: "c".repeat(64),
    eventHash: "d".repeat(64),
    activeFinalReceiptId: "11111111-1111-4111-8111-111111111111",
    repositoryStatus: "not-sent",
    createdAtUtc: "2026-08-14T12:00:00.000Z",
    transitionedAtUtc: "2026-08-14T12:00:00.000Z",
    claimBoundaries: [
      "This is a signed workflow-state event, not linguistic gold.",
      "Participant identity and contact data are excluded."
    ]
  };
  const signed = signEnvelope(envelope, hmacKey);
  const result = await validateSignedEnvelope(signed, hmacKey);

  assert.equal(result.metadata.evidenceType, "task-state");
  assert.equal(result.metadata.state, "approved");
  assert.equal(result.metadata.relativeJsonPath.includes(":"), false);
  assert.equal(result.metadata.relativeJsonPath.includes("\\"), false);
  const markdown = await renderEvidenceMarkdown(signed);
  assert.match(markdown, /Bound task-state record/);
  assert.match(markdown, /secondary-ratification-approved/);
});

test("merged-receipt workflow requires trusted main-branch provenance", async () => {
  const workflow = await readFile(new URL(
    ".github/workflows/import-msa-adjudication.yml",
    repositoryRoot
  ), "utf8");
  assert.match(workflow, /pull_request\.base\.ref == 'main'/);
  assert.match(
    workflow,
    /pull_request\.head\.repo\.full_name == github\.repository/
  );
  assert.match(
    workflow,
    /pull_request\.user\.login == 'github-actions\[bot\]'/
  );
  assert.match(workflow, /Import PR changed files outside the evidence boundary/);
  assert.match(
    workflow,
    /import-msa-portal-submission\.mjs[\s\S]+render-msa-github-evidence\.mjs/
  );
});

async function createScratchDir(t, name) {
  const dir = fileURLToPath(new URL(
    `tools/msa-adjudication-workbench/tests/.scratch-github-import/${name}/`,
    repositoryRoot
  ));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir.replace(/\\/g, "/");
}

async function createSubmissionEnvelope() {
  const packet = await readJson(new URL("packet.json", exampleDir));
  const annotation = await readJson(new URL("annotation-a.synthetic.json", exampleDir));
  const artifact = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "independent-annotation",
    packet,
    annotation
  };
  const receiptId = "11111111-1111-4111-8111-111111111111";
  return {
    schema: "adg-msa-github-inbox-v1",
    receiptId,
    participantPseudonym: `adg-${receiptId.slice(0, 12)}`,
    receivedAtUtc: "2026-08-14T10:00:00.000Z",
    artifactType: artifact.kind,
    artifactSha256: await sha256Json(artifact),
    attestation: {
      independent: true,
      blind: true,
      authentic: true
    },
    artifact,
    claimBoundaries: [
      "Participant identity is stored separately and is not present here.",
      "This submission is untrusted until repository validation passes.",
      "Pilot submissions cannot become final MSA readiness evidence."
    ]
  };
}

async function createRatificationEnvelope() {
  const packet = await readJson(new URL("packet.json", exampleDir));
  const annotationA = await readJson(new URL(
    "annotation-a.synthetic.json",
    exampleDir
  ));
  const annotationB = await readJson(new URL(
    "annotation-b.synthetic.json",
    exampleDir
  ));
  const adjudication = await readJson(new URL(
    "adjudication.synthetic.json",
    exampleDir
  ));
  const primaryArtifact = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "adjudication-package",
    packet,
    annotationA,
    annotationB,
    adjudication
  };
  const finalRoot = await computeAdjudicationMerkleRoot(
    packet,
    annotationA,
    annotationB,
    adjudication
  );
  const artifact = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "ratification-package",
    primaryArtifact,
    ratification: {
      schema: RATIFICATION_SCHEMA,
      taskId: packet.taskId,
      taskVersion: packet.taskVersion,
      packetId: packet.packetId,
      holdoutId: packet.holdoutId,
      protocolVersion: packet.protocolVersion,
      packetMerkleRoot: await computePacketMerkleRoot(packet),
      primaryReceiptId: "11111111-1111-4111-8111-111111111111",
      primaryAdjudicationMerkleRoot: finalRoot,
      reviewerSlot: "J2",
      reviewerPseudonym: "human-j2",
      reviewerIsHuman: true,
      reviewerIsSynthetic: false,
      independentFromImplementationTeam: true,
      decision: "agree",
      rationale:
        "راجعت الجذر النهائي ووافقت على سلامة الحسم والربط بالأدلة."
    }
  };
  const receiptId = "66666666-6666-4666-8666-666666666666";
  return {
    schema: "adg-msa-github-inbox-v1",
    receiptId,
    participantPseudonym: `adg-${receiptId.slice(0, 12)}`,
    receivedAtUtc: "2026-08-14T12:00:00.000Z",
    artifactType: artifact.kind,
    artifactSha256: await sha256Json(artifact),
    attestation: {
      independent: true,
      blind: true,
      authentic: true
    },
    artifact,
    claimBoundaries: [
      "Participant identity is excluded.",
      "Repository validation remains required."
    ]
  };
}

async function createCommentEnvelope(submission, overrides = {}) {
  const base = {
    schema: "adg-msa-github-comment-v1",
    commentId: "22222222-2222-4222-8222-222222222222",
    participantPseudonym: "adg-0123456789ab",
    receivedAtUtc: "2026-08-14T11:00:00.000Z",
    packetId: submission.artifact.packet.packetId,
    sourceReceiptId: submission.receiptId,
    targetReceiptId: submission.receiptId,
    targetArtifactSha256: submission.artifactSha256,
    parentCommentId: null,
    category: "evidence",
    body: "Please @reviewer compare token 2 with the linked evidence package.",
    location: {
      sentenceId: "pilot-01",
      tokenId: 2
    },
    mentions: [
      {
        receiptId: submission.receiptId,
        pseudonym: "adg-fedcba987654"
      }
    ],
    resultReferences: [
      {
        receiptId: submission.receiptId,
        artifactSha256: submission.artifactSha256,
        kind: submission.artifactType,
        pseudonym: "adg-fedcba987654",
        isFinal: false
      }
    ],
    attestation: {
      authoredAfterIndependentSubmission: true,
      publicTechnicalDiscussion: true
    },
    claimBoundaries: [
      "This comment discusses a public technical artifact only.",
      "It does not reveal participant identity or private infrastructure.",
      "It does not by itself establish final parser readiness."
    ]
  };

  return {
    ...base,
    ...overrides,
    location: overrides.location ?? base.location,
    mentions: overrides.mentions ?? base.mentions,
    resultReferences: overrides.resultReferences ?? base.resultReferences,
    attestation: overrides.attestation ?? base.attestation,
    claimBoundaries: overrides.claimBoundaries ?? base.claimBoundaries
  };
}

function signEnvelope(envelope, key) {
  return {
    ...envelope,
    hmacSha256: createHmac("sha256", key)
      .update(JSON.stringify(envelope), "utf8")
      .digest("hex")
  };
}

function runNode(scriptPath, args, extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRootPath,
    env: {
      ...process.env,
      ...extraEnv
    },
    encoding: "utf8"
  });
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJsonFile(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
