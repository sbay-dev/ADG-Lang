# Independent Quranic Parser Review Checklist

## Evaluator identity and environment

- Reviewer or organization:
- Review date:
- Repository commit:
- Operating system:
- .NET SDK:
- PowerShell:
- External data acquired directly from upstream: Yes / No
- Conflicts of interest:

Do not place private credentials, local paths, raw corpus content, or
unpublished review transcripts in the public form.

## Public package checks

- [ ] I read `INDEPENDENT-RESEARCHER-HANDOFF.md`.
- [ ] I read `CLAIM-BOUNDARIES.md`.
- [ ] Both solutions build with zero warnings and zero errors.
- [ ] The bounded causal corpus passes 16/16.
- [ ] The syntax property suite passes 325/325.
- [ ] The score-policy artifact reports 63 justified factors.
- [ ] The v4 manifest has 61 artifacts.
- [ ] The v4 Merkle root equals
      `5c4a24c81c9e5154f435c72f47e5dca7f8ebf60341b96105e5b3bec38b60c026`.
- [ ] Regenerating the v4 manifest leaves no diff.
- [ ] The public disclosure audit passes.
- [ ] No raw QAC/UD input or generated verse-level report is tracked.

## External evidence checks

- [ ] I obtained external inputs from the stated upstream sources.
- [ ] The pinned syntax and compact-morphology hashes match.
- [ ] I separately recorded the official QAC morphology hash.
- [ ] The official morphology file matches the audited mirror, or I recorded
      the mismatch as a blocking failure.
- [ ] All 45 relation labels and six phrase tags were observed.
- [ ] All 45,087 relation edges received a contract verdict.
- [ ] Exactly 64 unsupported/contradictory source edges remain deferred.
- [ ] All 11,574 phrase nodes received an accepted contract verdict.
- [ ] Generated reports match the registered hashes or every difference is
      explained.

## Interpretation checks

- [ ] I kept `Valid`, `Invalid`, and `Unverified` distinct.
- [ ] I did not interpret zero `Invalid` as perfect Quranic coverage.
- [ ] I did not interpret inventory completeness as complete Quranic grammar.
- [ ] I verified that all 51 contracts are non-normative.
- [ ] I verified that knowledge roots contain no neural vectors.
- [ ] I did not infer a CNS Model, CGN, Genius, or production-readiness claim.
- [ ] I assessed the remaining scholarly, provenance, license, split,
      archival, and evaluator gates independently.

## Result

- Public reproducibility: PASS / FAIL / NOT RUN
- External-data reproducibility: PASS / FAIL / NOT RUN
- Claim-boundary compliance: PASS / FAIL
- Ordinary Tool/Data release assessment: PASS / FAIL
- Quranic research approval assessment: APPROVED / NOT APPROVED
- CNS Model/CGN/Genius authorization: AUTHORIZED / NOT AUTHORIZED

## Deviations and falsifying evidence

List every mismatch, omitted command, changed dependency, hash difference,
unexpected acceptance, false rejection, leakage observation, or licensing
concern. Include minimal sanitized reproduction steps.

## Attestation

> I evaluated the identified commit against the published reproduction guide
> and claim matrix. My result applies only to the checks I marked as executed.
> A reproducible software result does not by itself establish complete Quranic
> grammar, normative training suitability, or CNS Model/CGN/Genius approval.

Name:

Signature or verifiable identity:

Date:
