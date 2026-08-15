import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RATIFICATION_SCHEMA,
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  computeRatificationMerkleRoot,
  decisionNeedsResolution,
  validateAdjudicationBinding,
  validatePublicArtifactText,
  validateSubmissionBinding
} from "../public/protocol.js";

const repositoryRoot = new URL("../../../", import.meta.url);

test("browser packet root matches the .NET contract", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  assert.equal(
    await computePacketMerkleRoot(packet),
    "3a06e94d7b53f3f4938c074511836bc4a19c95c724b18d8276530b02bfb7b8e5"
  );
});

test("browser annotation root matches the .NET contract", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  const annotation = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-a.synthetic.json",
    repositoryRoot
  ));
  await validateSubmissionBinding(packet, annotation);
  assert.equal(
    await computeAnnotationMerkleRoot(packet, annotation),
    "407cc841fc005089aa7abb57f4d8fe0a3b51050fbeea0d8db88326acfcc6262a"
  );
});

test("adjudication and J2 ratification bind the exact final root", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  const annotationA = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-a.synthetic.json",
    repositoryRoot
  ));
  const annotationB = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-b.synthetic.json",
    repositoryRoot
  ));
  const adjudication = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "adjudication.synthetic.json",
    repositoryRoot
  ));
  const primaryArtifact = {
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
  assert.equal(
    finalRoot,
    "09187fcc68b933b7e413ea7505631b9b7fc102817284a01fed0c570ca03d4296"
  );
  const ratification = {
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
    reviewerPseudonym: "synthetic-j2",
    reviewerIsHuman: false,
    reviewerIsSynthetic: true,
    independentFromImplementationTeam: true,
    decision: "agree",
    rationale:
      "راجعت الحزمة والجذر النهائي ووافقت على سلامة الربط والحسم الموثق."
  };
  assert.match(
    await computeRatificationMerkleRoot(primaryArtifact, ratification),
    /^[a-f0-9]{64}$/
  );
});

test("consensus override requires resolution", () => {
  assert.equal(decisionNeedsResolution("NOUN", "NOUN", "NOUN"), false);
  assert.equal(decisionNeedsResolution("NOUN", "NOUN", "PROPN"), true);
  assert.equal(decisionNeedsResolution("NOUN", "PROPN", "NOUN"), true);
});

test("annotation and final coverage reject duplicated token identifiers", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  const annotationA = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-a.synthetic.json",
    repositoryRoot
  ));
  const duplicate = structuredClone(annotationA);
  duplicate.sentences[0].tokens[1].tokenId =
    duplicate.sentences[0].tokens[0].tokenId;
  await assert.rejects(
    validateSubmissionBinding(packet, duplicate),
    /ترقيم وحدات التعليق/
  );

  const annotationB = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-b.synthetic.json",
    repositoryRoot
  ));
  const adjudication = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "adjudication.synthetic.json",
    repositoryRoot
  ));
  const duplicatedDecision = structuredClone(adjudication);
  duplicatedDecision.sentences[0].tokens[1].tokenId =
    duplicatedDecision.sentences[0].tokens[0].tokenId;
  await assert.rejects(
    validateAdjudicationBinding(
      packet,
      annotationA,
      annotationB,
      duplicatedDecision
    ),
    /ترقيم وحدات التعليق/
  );
});

test("public artifact notes reject contact data", async () => {
  const packet = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
    repositoryRoot
  ));
  const annotation = await readJson(new URL(
    "examples/arabic-text/msa-adjudication-pilot-v1/"
      + "annotation-a.synthetic.json",
    repositoryRoot
  ));
  annotation.sentences[0].note = "للتواصل reviewer@example.com";
  assert.throws(
    () => validatePublicArtifactText({
      schema: "adg-msa-portal-artifact-v1",
      kind: "independent-annotation",
      packet,
      annotation
    }),
    /بيانات تواصل/
  );
});

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
