# Quranic Grammar Rule Lifecycle

No observed annotation becomes an ADG rule in one step.

## Required lifecycle

| Step | Required output | Failure behavior |
| ---: | --- | --- |
| 1. Source registration | Pinned source, hash, license/access boundary, and location. | Reject unpinned or unverifiable evidence. |
| 2. Evidence extraction | QAC relation/phrase occurrences, structural signatures, lexical signatures, and samples. | Keep as evidence-only when extraction is incomplete. |
| 3. Linguistic statement | A bounded Arabic grammatical claim written independently of parser code. | Reject a claim that only repeats a QAC label. |
| 4. Typed ADG contract | Stable rule ID; operator, head, dependent, case, mood, voice, agreement, and ordering constraints. | Mark unsupported features explicitly; do not guess. |
| 5. Diagnostic contract | Stable code, token/span, expected feature, observed feature, and explanation. | Do not silently return success. |
| 6. Correction policy | `None`, `CaseOnly`, `DiacriticOnly`, `RequiresAuthorDecision`, or another reviewed bounded action. | Never make an undeclared lexical rewrite. |
| 7. Positive fixtures | Canonical Quranic occurrences accepted with exact evidence references. | Rule remains proposed. |
| 8. Near-miss fixtures | Similar structures that must not trigger the rule. | Rule remains proposed if specificity is unproved. |
| 9. Mutation fixtures | Add/remove/replace fatha, damma, kasra, sukun, shadda, and tanwin where applicable. | Any surviving invalid mutation blocks approval. |
| 10. Functional integration | Rule runs through ADG analysis, diagnosis, correction, semantic gate, and rewrite verification. | Oracle-only behavior is insufficient. |
| 11. Round-trip gate | `parse -> diacritize -> parse` preserves the verified graph and expected surface marks. | Mismatch is Invalid and reopens the rule. |
| 12. Quran-wide replay | Byte-identical report and Merkle root from two independent runs. | Nondeterminism blocks promotion. |
| 13. Corpus materialization | Approved rule emits licensed/synthetic positive, negative, correction, and diacritization records with provenance. | Unapproved rules remain outside normative training. |
| 14. CNS runtime interface | Rule is exposed as typed runtime constraints and validation results with the same rule ID. | Training/runtime rule drift blocks CNS binding. |
| 15. Review and promotion | Independent review, Kanban evidence, and approved status. | Rule stays Proposed or EvidenceOnly. |

## Minimum rule record

```text
rule_id
status
arabic_claim
evidence_source
evidence_locations
operator_constraints
dependent_constraints
head_constraints
expected_case
expected_mood
expected_voice
agreement_constraints
direction_constraints
diagnostic_code
diagnostic_explanation
correction_policy
positive_fixtures
near_miss_fixtures
mutation_fixtures
replay_root
corpus_record_ids
corpus_split
review_decision
```

## Rule statuses

| Status | Meaning |
| --- | --- |
| `EvidenceOnly` | Observed and inventoried; no functional claim. |
| `Proposed` | Linguistic statement and draft contract exist. |
| `Implemented` | Executable contract and diagnostics exist. |
| `Verified` | Positive, near-miss, mutation, and round-trip gates pass. |
| `Approved` | Independent review and release evidence pass. |
| `Rejected` | Evidence contradicted the proposed generalization. |
| `Deferred` | Evidence is insufficient; parser fails closed. |

## Promotion rule

Only `Approved` rules may enter the normative CNS grammar corpus or be
advertised as runtime generation constraints. `EvidenceOnly`, `Proposed`, and
`Deferred` records may be used only as non-normative research metadata.
