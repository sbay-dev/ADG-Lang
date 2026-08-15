export const PACKET_SCHEMA = "adg-msa-adjudication-packet-v3";
export const ANNOTATION_SCHEMA = "adg-msa-annotation-submission-v3";
export const ADJUDICATION_SCHEMA = "adg-msa-adjudication-decision-v3";
export const RATIFICATION_SCHEMA = "adg-msa-ratification-decision-v1";

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
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){7,}/u;
const RAW_HTML_PATTERN = /<\/?[a-z][^>]*>/iu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\s*\(/u;
const UNSAFE_URL_PATTERN = /\b(?:javascript|data):/iu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

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
  if (!identifier(packet.taskId)
      || !Number.isInteger(packet.taskVersion)
      || packet.taskVersion < 1
      || !identifier(packet.packetId)
      || !identifier(packet.holdoutId)
      || !identifier(packet.protocolId)
      || !identifier(packet.guidelineVersion)
      || !identifier(packet.dataVersion)
      || !identifier(packet.protocolVersion)) {
    throw new Error("هوية المهمة أو إصداراتها غير مكتملة.");
  }
  if (!packet.metricPolicy
      || packet.metricPolicy.schema !== "adg-iaa-policy-v1"
      || !Array.isArray(packet.metricPolicy.metrics)
      || typeof packet.metricPolicy.minimumRawAgreement !== "number"
      || typeof packet.metricPolicy.minimumDefinedKappa !== "number"
      || packet.metricPolicy.minimumRawAgreement < 0
      || packet.metricPolicy.minimumRawAgreement > 1
      || packet.metricPolicy.minimumDefinedKappa < -1
      || packet.metricPolicy.minimumDefinedKappa > 1) {
    throw new Error("سياسة قياس الاتفاق للمهمة غير صالحة.");
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
  const sentenceIds = new Set();
  for (const sentence of packet.sentences) {
    if (!sentence.sentenceId || !sentence.text
        || !Array.isArray(sentence.tokens)
        || sentence.tokens.length === 0) {
      throw new Error("إحدى الجمل ناقصة النص أو الوحدات.");
    }
    if (sentenceIds.has(sentence.sentenceId)) {
      throw new Error(`معرف الجملة ${sentence.sentenceId} مكرر.`);
    }
    sentenceIds.add(sentence.sentenceId);
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
      || submission.protocolId !== packet.protocolId
      || submission.taskId !== packet.taskId
      || submission.taskVersion !== packet.taskVersion
      || submission.guidelineVersion !== packet.guidelineVersion
      || submission.dataVersion !== packet.dataVersion
      || submission.protocolVersion !== packet.protocolVersion
      || !["A", "B"].includes(submission.annotatorSlot)) {
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
      || decision.taskId !== packet.taskId
      || decision.taskVersion !== packet.taskVersion
      || decision.guidelineVersion !== packet.guidelineVersion
      || decision.dataVersion !== packet.dataVersion
      || decision.protocolVersion !== packet.protocolVersion
      || decision.adjudicatorSlot !== "J1"
      || decision.packetMerkleRoot !== await computePacketMerkleRoot(packet)
      || decision.annotationAMerkleRoot
        !== await computeAnnotationMerkleRoot(packet, annotationA)
      || decision.annotationBMerkleRoot
        !== await computeAnnotationMerkleRoot(packet, annotationB)) {
    throw new Error("قرار التحكيم غير مرتبط بالحزمة والتعليقين نفسيهما.");
  }
  if (annotationA.annotatorSlot === annotationB.annotatorSlot
      || decision.annotationASlot !== annotationA.annotatorSlot
      || decision.annotationBSlot !== annotationB.annotatorSlot) {
    throw new Error("أدوار التعليق والتحكيم غير مستقلة أو غير متطابقة.");
  }
  validateAnnotationCoverage(packet, decision);
  validateAdjudicationResolutions(annotationA, annotationB, decision);
}

export function validatePublicArtifactText(artifact) {
  const values = [];
  collectPublicNotes(artifact, values);
  if (values.some(containsUnsafePublicText)) {
    throw new Error(
      "تحتوي الملاحظات على بيانات تواصل أو محتوى غير مسموح للنشر العام."
    );
  }
}

export async function computePacketMerkleRoot(packet) {
  validatePacket(packet);
  const builder = new CanonicalHashBuilder();
  builder.add("adg-msa-adjudication-packet-root-v3");
  builder.add(PACKET_SCHEMA);
  builder.add(packet.taskId);
  builder.add(packet.taskVersion);
  builder.add(packet.packetId);
  builder.add(packet.holdoutId);
  builder.add(packet.protocolId);
  builder.add(packet.guidelineVersion);
  builder.add(packet.dataVersion);
  builder.add(packet.protocolVersion);
  builder.add(canonicalJson(packet.metricPolicy));
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
  builder.add("adg-msa-annotation-submission-root-v3");
  builder.add(ANNOTATION_SCHEMA);
  builder.add(submission.packetMerkleRoot);
  builder.add(submission.taskId);
  builder.add(submission.taskVersion);
  builder.add(submission.packetId);
  builder.add(submission.holdoutId);
  builder.add(submission.protocolId);
  builder.add(submission.guidelineVersion);
  builder.add(submission.dataVersion);
  builder.add(submission.protocolVersion);
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
  builder.add("adg-msa-adjudication-decision-root-v3");
  builder.add(ADJUDICATION_SCHEMA);
  builder.add(decision.packetMerkleRoot);
  builder.add(decision.annotationAMerkleRoot);
  builder.add(decision.annotationBMerkleRoot);
  builder.add(decision.taskId);
  builder.add(decision.taskVersion);
  builder.add(decision.packetId);
  builder.add(decision.holdoutId);
  builder.add(decision.protocolId);
  builder.add(decision.guidelineVersion);
  builder.add(decision.dataVersion);
  builder.add(decision.protocolVersion);
  builder.add(decision.annotationASlot);
  builder.add(decision.annotationBSlot);
  builder.add(decision.adjudicatorSlot);
  builder.add(decision.adjudicatorPseudonym);
  builder.add(decision.adjudicatorIsHuman);
  builder.add(decision.adjudicatorIsSynthetic);
  builder.add(decision.independentFromImplementationTeam);
  builder.add(decision.blindToParserInternals);
  builder.add(decision.parserPredictionsViewed);
  addAnnotations(builder, decision.sentences, "resolutionNote");
  return builder.digest();
}

export async function validateRatificationBinding(
  primaryArtifact,
  ratification
) {
  if (!primaryArtifact
      || primaryArtifact.kind !== "adjudication-package") {
    throw new Error("حزمة التحكيم الأولية غير صالحة.");
  }
  await validateAdjudicationBinding(
    primaryArtifact.packet,
    primaryArtifact.annotationA,
    primaryArtifact.annotationB,
    primaryArtifact.adjudication
  );
  const packet = primaryArtifact.packet;
  const primaryRoot = await computeAdjudicationMerkleRoot(
    packet,
    primaryArtifact.annotationA,
    primaryArtifact.annotationB,
    primaryArtifact.adjudication
  );
  if (!ratification
      || ratification.schema !== RATIFICATION_SCHEMA
      || ratification.taskId !== packet.taskId
      || ratification.taskVersion !== packet.taskVersion
      || ratification.packetId !== packet.packetId
      || ratification.holdoutId !== packet.holdoutId
      || ratification.protocolVersion !== packet.protocolVersion
      || ratification.packetMerkleRoot !== await computePacketMerkleRoot(packet)
      || ratification.primaryAdjudicationMerkleRoot !== primaryRoot
      || ratification.reviewerSlot !== "J2"
      || !["agree", "disagree", "recuse"].includes(ratification.decision)
      || typeof ratification.rationale !== "string"
      || ratification.rationale.trim().length < 20
      || ratification.rationale.length > 4000) {
    throw new Error("قرار المراجعة الثانية غير مرتبط بالحزمة النهائية.");
  }
}

export async function computeRatificationMerkleRoot(
  primaryArtifact,
  ratification
) {
  await validateRatificationBinding(primaryArtifact, ratification);
  const builder = new CanonicalHashBuilder();
  builder.add("adg-msa-ratification-decision-root-v1");
  builder.add(RATIFICATION_SCHEMA);
  builder.add(ratification.taskId);
  builder.add(ratification.taskVersion);
  builder.add(ratification.packetId);
  builder.add(ratification.holdoutId);
  builder.add(ratification.protocolVersion);
  builder.add(ratification.packetMerkleRoot);
  builder.add(ratification.primaryReceiptId);
  builder.add(ratification.primaryAdjudicationMerkleRoot);
  builder.add(ratification.reviewerSlot);
  builder.add(ratification.reviewerPseudonym);
  builder.add(ratification.reviewerIsHuman);
  builder.add(ratification.reviewerIsSynthetic);
  builder.add(ratification.independentFromImplementationTeam);
  builder.add(ratification.decision);
  builder.add(ratification.rationale.trim());
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
  const bySentence = new Map();
  for (const sentence of submission.sentences) {
    if (!sentence || bySentence.has(sentence.sentenceId)) {
      throw new Error("التعليق يحتوي معرف جملة مكررًا أو غير صالح.");
    }
    bySentence.set(sentence.sentenceId, sentence);
  }
  for (const source of packet.sentences) {
    const annotated = bySentence.get(source.sentenceId);
    if (!annotated || !Array.isArray(annotated.tokens)
        || annotated.tokens.length !== source.tokens.length) {
      throw new Error(`التعليق ناقص في الجملة ${source.sentenceId}.`);
    }
    const sourceTokenIds = new Set(source.tokens.map(token => token.id));
    const annotatedTokenIds = new Set();
    for (const token of annotated.tokens) {
      if (!Number.isInteger(token?.tokenId)
          || annotatedTokenIds.has(token.tokenId)
          || !sourceTokenIds.has(token.tokenId)) {
        throw new Error(
          `ترقيم وحدات التعليق في الجملة ${source.sentenceId} غير مطابق.`
        );
      }
      annotatedTokenIds.add(token.tokenId);
    }
    if (annotatedTokenIds.size !== sourceTokenIds.size) {
      throw new Error(`التعليق ناقص في الجملة ${source.sentenceId}.`);
    }
  }
}

function validateAdjudicationResolutions(annotationA, annotationB, decision) {
  const aSentences = new Map(
    annotationA.sentences.map(sentence => [sentence.sentenceId, sentence])
  );
  const bSentences = new Map(
    annotationB.sentences.map(sentence => [sentence.sentenceId, sentence])
  );
  for (const finalSentence of decision.sentences || []) {
    const aSentence = aSentences.get(finalSentence.sentenceId);
    const bSentence = bSentences.get(finalSentence.sentenceId);
    if (!aSentence || !bSentence) {
      throw new Error("قرار التحكيم لا يغطي جمل التعليقين نفسيهما.");
    }
    if ((decisionNeedsResolution(
          aSentence.structurallyAcceptable,
          bSentence.structurallyAcceptable,
          finalSentence.structurallyAcceptable)
        || decisionNeedsResolution(
          aSentence.completePredicate,
          bSentence.completePredicate,
          finalSentence.completePredicate))
        && !String(finalSentence.resolutionNote || "").trim()) {
      throw new Error(
        `قرار الجملة ${finalSentence.sentenceId} يحتاج سبب حسم موثقًا.`
      );
    }
    const aTokens = new Map(
      aSentence.tokens.map(token => [token.tokenId, token])
    );
    const bTokens = new Map(
      bSentence.tokens.map(token => [token.tokenId, token])
    );
    for (const finalToken of finalSentence.tokens || []) {
      const tokenA = aTokens.get(finalToken.tokenId);
      const tokenB = bTokens.get(finalToken.tokenId);
      if (!tokenA || !tokenB) {
        throw new Error(
          `قرار الوحدة ${finalToken.tokenId} غير مرتبط بالتعليقين.`
        );
      }
      if (decisionNeedsResolution(
            tokenDecisionKey(tokenA),
            tokenDecisionKey(tokenB),
            tokenDecisionKey(finalToken))
          && !String(finalToken.resolutionNote || "").trim()) {
        throw new Error(
          `قرار الوحدة ${finalToken.tokenId} في الجملة `
          + `${finalSentence.sentenceId} يحتاج سبب حسم موثقًا.`
        );
      }
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

function collectPublicNotes(value, output) {
  if (Array.isArray(value)) {
    for (const child of value) collectPublicNotes(child, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["note", "resolutionNote", "rationale"].includes(key)
        && child !== null && child !== undefined) {
      output.push(String(child));
    } else {
      collectPublicNotes(child, output);
    }
  }
}

function containsUnsafePublicText(value) {
  return EMAIL_PATTERN.test(value)
    || PHONE_PATTERN.test(value)
    || RAW_HTML_PATTERN.test(value)
    || MARKDOWN_IMAGE_PATTERN.test(value)
    || UNSAFE_URL_PATTERN.test(value)
    || CONTROL_PATTERN.test(value);
}

function identifier(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
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
