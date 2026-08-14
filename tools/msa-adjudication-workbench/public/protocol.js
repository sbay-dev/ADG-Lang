export const PACKET_SCHEMA = "adg-msa-adjudication-packet-v2";
export const ANNOTATION_SCHEMA = "adg-msa-annotation-submission-v2";
export const ADJUDICATION_SCHEMA = "adg-msa-adjudication-decision-v2";

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "analysis",
  "candidateAware",
  "dependencyGraph",
  "evaluation",
  "morphology",
  "parse",
  "parserOutput",
  "parserPredictions",
  "predictions",
  "strictTag"
]);

class CanonicalHashBuilder {
  #parts = [];
  #encoder = new TextEncoder();

  add(value) {
    if (value === null || value === undefined) {
      this.#parts.push("-1:");
      return;
    }

    const text = typeof value === "boolean"
      ? (value ? "true" : "false")
      : String(value);
    this.#parts.push(`${this.#encoder.encode(text).length}:${text}`);
  }

  async digest() {
    const bytes = this.#encoder.encode(this.#parts.join(""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
  }
}

export function validatePacket(packet) {
  if (!packet || packet.schema !== PACKET_SCHEMA) {
    throw new Error("مخطط حزمة النص غير مدعوم.");
  }
  if (!packet.parserPredictionsExcluded) {
    throw new Error("الحزمة تكشف توقعات البارسر؛ رُفضت حمايةً للتعمية.");
  }
  if (packet.derivedFromExcludedCorpus) {
    throw new Error("المادة مشتقة من PADT أو PUD؛ رُفضت.");
  }
  if (containsForbiddenEvidence(packet)) {
    throw new Error("الحزمة تحتوي حقول تحليل أو توقعات محظورة.");
  }
  if (!Array.isArray(packet.sentences) || packet.sentences.length === 0) {
    throw new Error("الحزمة لا تحتوي جملًا.");
  }
  for (const sentence of packet.sentences) {
    if (!sentence.sentenceId || !sentence.text
        || !Array.isArray(sentence.tokens)
        || sentence.tokens.length === 0) {
      throw new Error("إحدى الجمل ناقصة النص أو الوحدات.");
    }
    sentence.tokens.forEach((token, index) => {
      if (token.id !== index + 1 || !token.form) {
        throw new Error(`ترقيم وحدات الجملة ${sentence.sentenceId} غير صالح.`);
      }
    });
  }
}

export async function validateSubmissionBinding(packet, submission) {
  validatePacket(packet);
  if (!submission || submission.schema !== ANNOTATION_SCHEMA
      || submission.packetId !== packet.packetId
      || submission.holdoutId !== packet.holdoutId
      || submission.protocolId !== packet.protocolId) {
    throw new Error("أحد التعليقين غير مرتبط بالحزمة.");
  }

  const expectedPacketRoot = await computePacketMerkleRoot(packet);
  if (submission.packetMerkleRoot !== expectedPacketRoot) {
    throw new Error("تغيّرت الحزمة بعد إعداد التعليق؛ أعد التعليق على النسخة الحالية.");
  }
  validateAnnotationCoverage(packet, submission);
}

export async function validateAdjudicationBinding(
  packet,
  annotationA,
  annotationB,
  decision
) {
  await validateSubmissionBinding(packet, annotationA);
  await validateSubmissionBinding(packet, annotationB);
  if (!decision || decision.schema !== ADJUDICATION_SCHEMA
      || decision.packetId !== packet.packetId
      || decision.holdoutId !== packet.holdoutId
      || decision.protocolId !== packet.protocolId
      || decision.packetMerkleRoot !== await computePacketMerkleRoot(packet)
      || decision.annotationAMerkleRoot
        !== await computeAnnotationMerkleRoot(packet, annotationA)
      || decision.annotationBMerkleRoot
        !== await computeAnnotationMerkleRoot(packet, annotationB)) {
    throw new Error("قرار التحكيم غير مرتبط بالحزمة والتعليقين نفسيهما.");
  }
}

export async function computePacketMerkleRoot(packet) {
  validatePacket(packet);
  const builder = new CanonicalHashBuilder();
  builder.add("adg-msa-adjudication-packet-root-v2");
  builder.add(PACKET_SCHEMA);
  builder.add(packet.packetId);
  builder.add(packet.holdoutId);
  builder.add(packet.protocolId);
  builder.add(packet.releaseCandidateId);
  builder.add(packet.pilotOnly);
  builder.add(packet.developerVisible);
  builder.add(packet.parserPredictionsExcluded);
  builder.add(packet.derivedFromExcludedCorpus);
  builder.add(packet.holdoutManifestSha256);
  builder.add(packet.sentences.length);
  for (const sentence of packet.sentences) {
    builder.add(sentence.sentenceId);
    builder.add(sentence.text);
    builder.add(sentence.tokens.length);
    for (const token of sentence.tokens) {
      builder.add(token.id);
      builder.add(token.form);
    }
  }
  const instructions = packet.instructions ?? [];
  builder.add(instructions.length);
  instructions.forEach(value => builder.add(value));
  return builder.digest();
}

export async function computeAnnotationMerkleRoot(packet, submission) {
  const packetRoot = await computePacketMerkleRoot(packet);
  if (submission.packetMerkleRoot !== packetRoot) {
    throw new Error("التعليق لا يحمل جذر الحزمة الصحيح.");
  }
  const builder = new CanonicalHashBuilder();
  builder.add("adg-msa-annotation-submission-root-v2");
  builder.add(ANNOTATION_SCHEMA);
  builder.add(submission.packetMerkleRoot);
  builder.add(submission.packetId);
  builder.add(submission.holdoutId);
  builder.add(submission.protocolId);
  builder.add(submission.annotatorSlot);
  builder.add(submission.annotatorPseudonym);
  builder.add(submission.isHuman);
  builder.add(submission.isSynthetic);
  builder.add(submission.independentFromImplementationTeam);
  builder.add(submission.blindToParserInternals);
  builder.add(submission.parserPredictionsViewed);
  addAnnotations(builder, submission.sentences, "note");
  return builder.digest();
}

export async function computeAdjudicationMerkleRoot(
  packet,
  annotationA,
  annotationB,
  decision
) {
  await validateAdjudicationBinding(
    packet,
    annotationA,
    annotationB,
    decision
  );
  const builder = new CanonicalHashBuilder();
  builder.add("adg-msa-adjudication-decision-root-v2");
  builder.add(ADJUDICATION_SCHEMA);
  builder.add(decision.packetMerkleRoot);
  builder.add(decision.annotationAMerkleRoot);
  builder.add(decision.annotationBMerkleRoot);
  builder.add(decision.packetId);
  builder.add(decision.holdoutId);
  builder.add(decision.protocolId);
  builder.add(decision.annotationASlot);
  builder.add(decision.annotationBSlot);
  builder.add(decision.adjudicatorPseudonym);
  builder.add(decision.adjudicatorIsHuman);
  builder.add(decision.adjudicatorIsSynthetic);
  builder.add(decision.independentFromImplementationTeam);
  builder.add(decision.blindToParserInternals);
  builder.add(decision.parserPredictionsViewed);
  addAnnotations(builder, decision.sentences, "resolutionNote");
  return builder.digest();
}

export function decisionNeedsResolution(
  annotationA,
  annotationB,
  finalDecision
) {
  return annotationA !== annotationB
    || (annotationA === annotationB && finalDecision !== annotationA);
}

export function tokenDecisionKey(token) {
  return JSON.stringify([
    token.universalPartOfSpeech,
    token.headTokenId,
    token.dependencyRelation,
    token.irabHeadTokenId,
    token.irabCategory,
    token.irabNotApplicable
  ]);
}

export async function sha256Json(value) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function addAnnotations(builder, sentences, noteName) {
  builder.add(sentences.length);
  for (const sentence of sentences) {
    builder.add(sentence.sentenceId);
    builder.add(sentence.structurallyAcceptable);
    builder.add(sentence.completePredicate);
    builder.add(sentence[noteName]);
    builder.add(sentence.tokens.length);
    for (const token of sentence.tokens) {
      builder.add(token.tokenId);
      builder.add(token.universalPartOfSpeech);
      builder.add(token.headTokenId);
      builder.add(token.dependencyRelation);
      builder.add(token.irabHeadTokenId);
      builder.add(token.irabCategory);
      builder.add(token.irabNotApplicable);
      builder.add(token[noteName]);
    }
  }
}

function validateAnnotationCoverage(packet, submission) {
  if (!Array.isArray(submission.sentences)
      || submission.sentences.length !== packet.sentences.length) {
    throw new Error("التعليق لا يغطي جميع جمل الحزمة.");
  }
  const bySentence = new Map(
    submission.sentences.map(sentence => [sentence.sentenceId, sentence])
  );
  for (const source of packet.sentences) {
    const annotated = bySentence.get(source.sentenceId);
    if (!annotated || !Array.isArray(annotated.tokens)
        || annotated.tokens.length !== source.tokens.length) {
      throw new Error(`التعليق ناقص في الجملة ${source.sentenceId}.`);
    }
  }
}

function containsForbiddenEvidence(value) {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenEvidence);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_EVIDENCE_KEYS.has(key) || containsForbiddenEvidence(child));
}
