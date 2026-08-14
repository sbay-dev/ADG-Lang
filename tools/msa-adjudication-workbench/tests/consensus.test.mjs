import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_METRIC_POLICY,
  agreementPolicyPassed,
  assertConsensusTransition,
  computeIndependentAgreement,
  consensusEventHash,
  countNovelPrimaryDecisions,
  taskVersionIdentity
} from "../src/consensus.js";

function annotation(relation = "nsubj") {
  return {
    sentences: [{
      sentenceId: "s1",
      structurallyAcceptable: true,
      completePredicate: true,
      tokens: [{
        tokenId: 1,
        universalPartOfSpeech: "NOUN",
        headTokenId: 2,
        dependencyRelation: relation,
        irabHeadTokenId: 2,
        irabCategory: "faail",
        irabNotApplicable: false
      }]
    }]
  };
}

test("consensus state transitions reject shortcuts", () => {
  assert.doesNotThrow(() =>
    assertConsensusTransition("final-review", "approved"));
  assert.throws(
    () => assertConsensusTransition("discussion", "published"),
    /not allowed/
  );
});

test("task identity binds policy and data versions", () => {
  assert.deepEqual(
    taskVersionIdentity({
      taskId: "msa-task",
      taskVersion: 2,
      packetId: "packet-2",
      holdoutId: "holdout-1",
      guidelineVersion: "guideline-3",
      dataVersion: "data-7",
      protocolVersion: "policy-1"
    }, "a".repeat(64)),
    {
      id: "msa-task:v2",
      taskId: "msa-task",
      taskVersion: 2,
      packetId: "packet-2",
      holdoutId: "holdout-1",
      packetMerkleRoot: "a".repeat(64),
      guidelineVersion: "guideline-3",
      dataVersion: "data-7",
      protocolVersion: "policy-1"
    }
  );
});

test("independent agreement is measured before adjudication", () => {
  const exact = computeIndependentAgreement(annotation(), annotation());
  assert.equal(exact.exactAgreement, true);
  assert.equal(exact.macroRawAgreement, 1);
  assert.equal(agreementPolicyPassed(exact, DEFAULT_METRIC_POLICY), true);

  const disagreement = computeIndependentAgreement(
    annotation("nsubj"),
    annotation("obj")
  );
  assert.equal(disagreement.exactAgreement, false);
  assert.ok(disagreement.macroRawAgreement < 1);
});

test("agreement metrics reject duplicated decision units", () => {
  const malformed = annotation();
  malformed.sentences[0].tokens.push({
    ...malformed.sentences[0].tokens[0]
  });
  assert.throws(
    () => computeIndependentAgreement(malformed, structuredClone(malformed)),
    /identifiers must be unique/
  );
});

test("novel primary choices are detected at atomic decision level", () => {
  assert.equal(
    countNovelPrimaryDecisions(
      annotation("nsubj"),
      annotation("obj"),
      annotation("dep")
    ),
    1
  );
  assert.equal(
    countNovelPrimaryDecisions(
      annotation("nsubj"),
      annotation("obj"),
      annotation("obj")
    ),
    0
  );
});

test("consensus event hashes are canonical across key order", async () => {
  assert.equal(
    await consensusEventHash({ b: 2, a: { d: 4, c: 3 } }),
    await consensusEventHash({ a: { c: 3, d: 4 }, b: 2 })
  );
});
