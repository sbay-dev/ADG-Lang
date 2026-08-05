# ADG-Lang Quranic Core Research Lane v1

**Status:** Active research lane. **Research approval has not been granted.**

This lane turns Quranic grammatical evidence into two separately governed
artifacts:

1. an auditable deterministic executable ADG parser; and
2. an auditable derived grammar corpus for training CNS models.

The parser remains a Tool. The corpus is a separately versioned Data artifact.
Its non-normative `research` split may preserve contract-derived metadata before
approval; only approved contracts and reviewed evidence may enter normative
training splits. Neither artifact is itself a neural Model, Genius, or CGN.

## Binding classification

| Item | Classification |
| --- | --- |
| Quranic Core parser | Deterministic CNS Tool candidate |
| CNS grammar corpus | Separate derived Data artifact |
| QAC syntax and morphology | External evidence and gold oracle |
| Candidate198 | Frozen development oracle, not the final parser |
| ADG rule contracts | Executable grammatical knowledge |
| CNS consumption | Training corpus plus runtime generation constraints and verification |
| Raw QAC export | Prohibited without an explicit redistribution right |
| Genius / CGN claim | Blocked until separate CNS audit gates pass |

The required runtime direction is:

```text
Quranic evidence
  -> typed ADG rule contracts
  -> analyze / diagnose / reject / correct / diacritize
  -> deterministic re-verification
  -> derived CNS grammar corpus
  -> CNS training
  -> runtime generation constraint and validation API
```

It is not:

```text
raw QAC dump -> undocumented training -> untraceable model behavior
```

## Current evidence

The first lane artifact is a deterministic rule-evidence inventory:

| Measure | Result |
| --- | ---: |
| QAC syntax graphs | 7,373 |
| Dependency relations inventoried | 45 / 45 |
| Phrase tags inventoried | 6 / 6 |
| Dependency annotations bound | 45,087 |
| Phrase annotations bound | 11,574 |
| Executable dependency contracts | 45 / 45 |
| Executable phrase contracts | 6 / 6 |
| Source relation evidence accepted | 45,023 / 45,087 |
| Explicitly deferred source edges | 64 |
| Source phrase evidence accepted | 11,574 / 11,574 |
| Generated property and mutation tests | 325 / 325 |
| Audited named lexeme collections | 19 fields; 352 entries; 0 unregistered |
| Quranic evidence-only lexeme effects | 179 entries; 4,101 exact source matches; 0 zero-match |
| Natural heuristic effects | 173 explicit opt-in entries; 0 verified Quranic acceptances |
| Morphology selection score policy | v1; 63 Quranic and opt-in natural factors; root `3edb9636a42e399c776883e8994666cd6801b0d3b16f78c3617b8b9b0f52ba75` |
| Inventory Merkle root | `238add25642a5ddef5943f6c22c9882df7291d7709e2235171c241df210531b6` |
| Machine-readable rule contracts | 51 |
| Non-normative canonical-validator contracts | 51 |
| Evidence-only contracts | 0 |
| Contract set | `adg-quranic-grammar-contracts-v3` |
| Contract-set Merkle root | `2cf54347d9222f28f603c55d6ad2c330ba9c0cad5ef8e30ddb14f219682971f5` |
| Current strict parser candidate | Candidate205 |
| Quran-wide structural states | 5,708 Valid; 528 Unverified; 0 Invalid |
| Quran-wide unverified generated edges | 187 |
| Quranic verses in functional diacritic gate | 6,236 |
| Checked case-relation edges | 18,809 |
| Functionally verified edges | 11,970 |
| Functionally unverified edges | 6,839 |
| Functionally invalid edges | 0 |
| Controlled add/remove/replace mutations | 24 / 24 detected |
| Strict round-trip accepted slice | 69 verses; 77 units |
| Unsafe round-trip acceptances | 0 |
| Ordinary-software release snapshot | `versions/v4`; 61 artifacts; root `5c4a24c81c9e5154f435c72f47e5dca7f8ebf60341b96105e5b3bec38b60c026` |
| Research corpus records | 184 |
| Research corpus | `adg-cns-quranic-grammar-corpus-v3` |
| Research corpus Merkle root | `da8eea61727893362769608914237a018135d00b80fc2f49ab710b77d93bdf14` |
| Leakage groups | 51 groups; 184 records; 0 cross-split leakage |
| Split-manifest Merkle root | `c39aeda6789bdf5a021550c9ab0e978f183d5cffa2b6c621a75fa5f114e3f14e` |
| Runtime grammar API | Version/root-bound validation, constraint discovery, and correction requests; normative mode fail-closed |
| Knowledge-root projection records | 8,001 |
| Distinct morphology roots | 1,235 |
| Knowledge polarity | 7,791 Positive; 133 Negative; 77 Unverified |
| Knowledge-root Merkle root | `59fb1088af1c72f993885a1c9704a9c37ad591c6a46c032f9856ff498b7e6dbf` |
| Neural embedding vectors | 0 |
| Expert Council | Phase 1: 3 theses; Phase 2: 36/36 AGREE |
| Council verdict | Tool/Data PASS; research NOT APPROVED; no CNS/CGN/Genius claim |
| Council evidence root | `d03b1563d7823e198c21cc693f4e4e0b56295fa392a96e5fe848ffd70286b103` |

The inventory is complete as an **evidence inventory**, not as a complete
Quranic grammar claim. Every observed relation and phrase family now has an
executable contract, but 64 source relation edges remain explicitly deferred,
528 verses remain structurally `Unverified`, and official provenance,
independent rule authority, normative splitting, durable archival, and
independent evaluator gates remain open.

All 51 exported contracts currently set `isNormativeForCns=false`. They may not
enter the approved CNS training corpus until the corresponding rules pass
functional integration, mutation, round-trip, and review gates.

The lexeme audit treats each private parser collection as data, not as an
independent grammatical rule. For Quranic evidence-only entries it counts exact
lemma, root, or directed endpoint matches in the pinned source treebank. For
natural-Arabic entries it executes each registered form only through explicit
heuristic opt-in and counts verified Quranic outcomes; that count is zero.
The score-policy report separately binds every candidate and pair-selection
factor, its rationale, the beam bound, and deterministic tie-break order.

## Research documents

- `INDEPENDENT-RESEARCHER-HANDOFF.md` - authoritative public handoff and interpretation key.
- `REPRODUCTION-GUIDE.md` - clean-clone and external-evidence reproduction procedure.
- `CLAIM-BOUNDARIES.md` - allowed, prohibited, and still-unresolved claims.
- `KNOWN-LIMITATIONS.md` - frozen historical labels and current technical limits.
- `INDEPENDENT-REVIEW-CHECKLIST.md` - evaluator evidence and attestation form.
- `RESEARCH-CHARTER.md` - scope, hypotheses, evidence hierarchy, and exclusions.
- `DECISION-LOG.md` - binding architectural and claim-boundary decisions.
- `RULE-LIFECYCLE.md` - the required path from evidence to an approved rule.
- `ADG-INTEGRATION-MAP.md` - where Quranic contracts enter the existing parser.
- `CNS-INTEGRATION-CONTRACT.md` - CNS training/runtime version and policy contract.
- `CNS-TRAINING-CORPUS-SPEC.md` - derived corpus schema, provenance, splits, and gates.
- `QURANIC-KNOWLEDGE-ROOTS-SPEC.md` - polarity, projection, index, and distribution contract.
- `APPROVAL-GATES.md` - measurable research-lane gates and current status.
- `EVIDENCE-REGISTER.json` - hashes, Merkle roots, commands, and external inputs.
- `docs\kanban\ADG-QURANIC-CORE-KANBAN.md` - the canonical research board.

## Reproduce the evidence inventory

External QAC inputs are not redistributed. With verified local copies:

```powershell
dotnet build .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --nologo
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  quranic-rule-inventory <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --report <quranic-rule-inventory-v2.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  audit-quranic-relation-contracts <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --report <relation-contract-audit.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  audit-quranic-phrase-contracts <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --report <phrase-contract-audit.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  audit-quranic-lexeme-allowlists <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --report <lexeme-allowlist-audit.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  quranic-score-policy --report <score-policy.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  quranic-rule-contracts <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --out <quranic-rule-contracts-v3.jsonl> --manifest <contracts-manifest.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  evaluate-quranic-diacritics <quranic-corpus-morphology-0.4.txt> `
  --full-v0.4 --report <functional-diacritics.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  test-quranic-diacritic-mutations <quranic-corpus-morphology-0.4.txt> `
  --full-v0.4 --report <diacritic-mutations.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  evaluate-quranic-diacritization <quranic-corpus-morphology-0.4.txt> `
  --full-v0.4 --report <diacritization-roundtrip.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  build-cns-grammar-corpus <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --out <cns-quranic-grammar-corpus-v3.jsonl> --manifest <corpus-manifest.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  build-cns-corpus-splits <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --out <cns-quranic-corpus-splits-v1.jsonl> --manifest <split-manifest.json>

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- `
  build-cns-knowledge-roots <syntax.txt> <quranic-corpus-morphology-0.4.txt> `
  --syntax-morphology <morphology.txt> --pinned-2023 --full-v0.4 `
  --out <quranic-knowledge-roots-v2.jsonl> --manifest <knowledge-manifest.json>
```

The generated report contains derived evidence patterns and remains outside the
release until its redistribution boundary is reviewed. The compact contract
JSONL contains rules, counts, and constraints but no verse text. The repository
stores only sanitized hashes, commands, and claim boundaries at this stage.

The current 184-record corpus is a non-normative research foundation:
51 positive canonical-validator states and 133 controlled negative mutations.
It contains no verse text and cannot be promoted to
the normative CNS training split until rule approval and split/license gates
pass.

The bounded diacritizer is also non-normative. It accepts only additive
reconstruction when one canonical surface survives morphology ambiguity,
input/output parser states are valid, functional validation is valid, and the
graph, morphology, and rule fingerprints match. All other cases are rejected or
returned as `Unverified`.

## Approval rule

No document, test count, parser score, or council review may call this lane
approved while any mandatory gate in `APPROVAL-GATES.md` remains open.
