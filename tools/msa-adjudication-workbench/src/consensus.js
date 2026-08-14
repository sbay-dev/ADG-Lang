export const CONSENSUS_POLICY_VERSION = "adg-consensus-policy-v1";
export const CONSENSUS_ROLES = Object.freeze(["A", "B", "J1", "J2"]);
export const ROUND_DEADLINE_MS = 14 * 24 * 60 * 60 * 1000;
export const APPEAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const DEFAULT_METRIC_POLICY = Object.freeze({
  schema: "adg-iaa-policy-v1",
  policyVersion: CONSENSUS_POLICY_VERSION,
  metrics: ["raw-agreement", "cohen-kappa"],
  minimumRawAgreement: 0.9,
  minimumDefinedKappa: 0.8,
  undefinedKappaFallback: "raw-agreement",
  automaticFinalization: false,
  claimBoundary:
    "Task-specific policy; no universal IAA threshold is claimed."
});

const ALLOWED_TRANSITIONS = new Map([
  ["draft", new Set(["open", "failed"])],
  ["open", new Set(["independent-review", "failed"])],
  ["independent-review", new Set([
    "discussion",
    "escalated",
    "failed"
  ])],
  ["discussion", new Set([
    "final-review",
    "escalated",
    "failed"
  ])],
  ["final-review", new Set([
    "approved",
    "escalated",
    "failed"
  ])],
  ["approved", new Set(["published", "revoked", "escalated"])],
  ["published", new Set(["revoked"])],
  ["escalated", new Set(["reissued", "failed"])],
  ["reissued", new Set(["independent-review", "failed"])],
  ["revoked", new Set(["reissued", "failed"])],
  ["failed", new Set()]
]);

export function assertConsensusTransition(fromState, toState) {
  if (!ALLOWED_TRANSITIONS.get(fromState)?.has(toState)) {
    throw new Error(
      `Consensus transition '${fromState}' -> '${toState}' is not allowed.`
    );
  }
}

export function taskVersionIdentity(packet, packetMerkleRoot) {
  return {
    id: `${packet.taskId}:v${packet.taskVersion}`,
    taskId: packet.taskId,
    taskVersion: packet.taskVersion,
    packetId: packet.packetId,
    holdoutId: packet.holdoutId,
    packetMerkleRoot,
    guidelineVersion: packet.guidelineVersion,
    dataVersion: packet.dataVersion,
    protocolVersion: packet.protocolVersion
  };
}

export function consensusRoundId(taskVersionId, roundNumber) {
  return `${taskVersionId}:r${roundNumber}`;
}

export function computeIndependentAgreement(annotationA, annotationB) {
  assertComparableCoverage(annotationA, annotationB);
  const dimensions = [
    dimension(
      "sentence.structurallyAcceptable",
      sentencePairs(annotationA, annotationB, "structurallyAcceptable")
    ),
    dimension(
      "sentence.completePredicate",
      sentencePairs(annotationA, annotationB, "completePredicate")
    ),
    ...[
      ["token.universalPartOfSpeech", "universalPartOfSpeech"],
      ["token.headTokenId", "headTokenId"],
      ["token.dependencyRelation", "dependencyRelation"],
      ["token.irabHeadTokenId", "irabHeadTokenId"],
      ["token.irabCategory", "irabCategory"],
      ["token.irabNotApplicable", "irabNotApplicable"]
    ].map(([name, field]) =>
      dimension(name, tokenPairs(annotationA, annotationB, field)))
  ];
  const rawValues = dimensions.map(value => value.rawAgreement);
  const definedKappas = dimensions
    .map(value => value.cohenKappa)
    .filter(value => value !== null);
  return {
    schema: "adg-independent-agreement-v1",
    unitCount: dimensions.reduce((sum, value) => sum + value.unitCount, 0),
    exactAgreement: dimensions.every(value => value.disagreementCount === 0),
    macroRawAgreement: average(rawValues),
    macroDefinedKappa: definedKappas.length
      ? average(definedKappas)
      : null,
    dimensions
  };
}

export function agreementPolicyPassed(
  metrics,
  policy = DEFAULT_METRIC_POLICY
) {
  if (metrics.macroRawAgreement < policy.minimumRawAgreement) return false;
  if (metrics.macroDefinedKappa === null) {
    return policy.undefinedKappaFallback === "raw-agreement";
  }
  return metrics.macroDefinedKappa >= policy.minimumDefinedKappa;
}

export function countNovelPrimaryDecisions(
  annotationA,
  annotationB,
  finalDecision
) {
  const a = decisionMap(annotationA);
  const b = decisionMap(annotationB);
  const final = decisionMap(finalDecision);
  let count = 0;
  for (const [key, finalValue] of final) {
    if (!a.has(key) || !b.has(key)) {
      throw new Error(`Final decision unit '${key}' is not bound to A and B.`);
    }
    if (finalValue !== a.get(key) && finalValue !== b.get(key)) {
      count += 1;
    }
  }
  if (final.size !== a.size || final.size !== b.size) {
    throw new Error("Final decision coverage differs from A or B.");
  }
  return count;
}

export async function consensusEventHash(event) {
  const canonical = JSON.stringify(sortObject(event));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function dimension(name, pairs) {
  const unitCount = pairs.length;
  const disagreementCount = pairs
    .filter(([left, right]) => left !== right)
    .length;
  return {
    name,
    unitCount,
    disagreementCount,
    rawAgreement: unitCount
      ? (unitCount - disagreementCount) / unitCount
      : 1,
    cohenKappa: cohenKappa(pairs)
  };
}

function cohenKappa(pairs) {
  if (!pairs.length) return null;
  const leftCounts = new Map();
  const rightCounts = new Map();
  let agreement = 0;
  for (const [left, right] of pairs) {
    if (left === right) agreement += 1;
    leftCounts.set(left, (leftCounts.get(left) || 0) + 1);
    rightCounts.set(right, (rightCounts.get(right) || 0) + 1);
  }
  const observed = agreement / pairs.length;
  const labels = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  let expected = 0;
  for (const label of labels) {
    expected += ((leftCounts.get(label) || 0) / pairs.length)
      * ((rightCounts.get(label) || 0) / pairs.length);
  }
  if (expected === 1) return null;
  return (observed - expected) / (1 - expected);
}

function sentencePairs(annotationA, annotationB, field) {
  const right = new Map(
    annotationB.sentences.map(sentence => [sentence.sentenceId, sentence])
  );
  return annotationA.sentences.map(sentence => {
    const other = right.get(sentence.sentenceId);
    if (!other) throw new Error("Independent sentence coverage differs.");
    return [canonicalValue(sentence[field]), canonicalValue(other[field])];
  });
}

function tokenPairs(annotationA, annotationB, field) {
  const right = new Map();
  for (const sentence of annotationB.sentences) {
    for (const token of sentence.tokens) {
      right.set(`${sentence.sentenceId}:${token.tokenId}`, token);
    }
  }
  const pairs = [];
  for (const sentence of annotationA.sentences) {
    for (const token of sentence.tokens) {
      const key = `${sentence.sentenceId}:${token.tokenId}`;
      const other = right.get(key);
      if (!other) throw new Error("Independent token coverage differs.");
      pairs.push([
        canonicalValue(token[field]),
        canonicalValue(other[field])
      ]);
    }
  }
  return pairs;
}

function decisionMap(annotation) {
  const values = new Map();
  for (const sentence of annotation.sentences) {
    setUniqueDecisionValue(
      values,
      `${sentence.sentenceId}:structurallyAcceptable`,
      canonicalValue(sentence.structurallyAcceptable)
    );
    setUniqueDecisionValue(
      values,
      `${sentence.sentenceId}:completePredicate`,
      canonicalValue(sentence.completePredicate)
    );
    for (const token of sentence.tokens) {
      const prefix = `${sentence.sentenceId}:${token.tokenId}`;
      for (const field of [
        "universalPartOfSpeech",
        "headTokenId",
        "dependencyRelation",
        "irabHeadTokenId",
        "irabCategory",
        "irabNotApplicable"
      ]) {
        setUniqueDecisionValue(
          values,
          `${prefix}:${field}`,
          canonicalValue(token[field])
        );
      }
    }
  }
  return values;
}

function assertComparableCoverage(annotationA, annotationB) {
  const left = annotationCoverage(annotationA);
  const right = annotationCoverage(annotationB);
  if (left.size !== right.size
      || [...left].some(key => !right.has(key))) {
    throw new Error("Independent annotation coverage differs.");
  }
}

function annotationCoverage(annotation) {
  if (!Array.isArray(annotation?.sentences)) {
    throw new Error("Independent annotation sentences are missing.");
  }
  const keys = new Set();
  for (const sentence of annotation.sentences) {
    const sentenceKey = `sentence:${sentence?.sentenceId}`;
    if (!sentence?.sentenceId || keys.has(sentenceKey)) {
      throw new Error("Independent sentence identifiers must be unique.");
    }
    keys.add(sentenceKey);
    if (!Array.isArray(sentence.tokens)) {
      throw new Error("Independent annotation tokens are missing.");
    }
    for (const token of sentence.tokens) {
      const tokenKey = `token:${sentence.sentenceId}:${token?.tokenId}`;
      if (!Number.isInteger(token?.tokenId) || keys.has(tokenKey)) {
        throw new Error("Independent token identifiers must be unique.");
      }
      keys.add(tokenKey);
    }
  }
  return keys;
}

function setUniqueDecisionValue(values, key, value) {
  if (values.has(key)) {
    throw new Error(`Decision unit '${key}' is duplicated.`);
  }
  values.set(key, value);
}

function canonicalValue(value) {
  return value === null || value === undefined
    ? "null"
    : JSON.stringify(value);
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortObject(value[key])])
  );
}
