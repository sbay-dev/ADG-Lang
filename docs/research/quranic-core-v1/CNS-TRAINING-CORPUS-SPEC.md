# CNS Quranic Grammar Corpus Specification

## Purpose

Build a high-integrity corpus that can ultimately teach CNS models to generate,
diagnose, reject, correct, and diacritize Arabic according to approved Quranic
grammar contracts.

The corpus is derived from parser rule contracts. It is not a raw QAC export
and it is not stored inside parser source code. Before approval, contract-only
records may exist in a non-normative `research` split. Only approved rules may
produce normative train, development, or holdout records.

## Record schema

```json
{
  "recordId": "QRC-...",
  "schemaVersion": 2,
  "contractSetRoot": "sha256",
  "ruleIds": ["QUR-QAC-REL-SUBJ"],
  "task": "validate-grammar-state | validate-conditional-constraint | diagnose-grammar-mutation | diagnose-phrase-mutation",
  "input": {
    "relation": "QAC relation or phrase code",
    "contractStatus": "CanonicalValidator",
    "dependent": {
      "tag": "optional",
      "lemma": "optional",
      "case": "optional",
      "aspect": "optional",
      "mood": "optional",
      "voice": "optional"
    },
    "head": "same typed node-state shape or null",
    "phrase": {
      "tag": "optional phrase code",
      "resolvedContiguousSpan": true,
      "laminarSpanSet": true,
      "startNodeSignature": "optional",
      "endNodeSignature": "optional",
      "requiredMemberTags": [],
      "parentRelation": "optional",
      "childRelation": "optional"
    }
  },
  "target": {
    "status": "Valid | Invalid | Unverified",
    "diagnosticCodes": [],
    "consumptionPolicy": "ResearchMetadataOnly"
  },
  "provenance": {
    "kind": "contract-derived",
    "sourceId": "contract-root:rule-id",
    "licenseId": "ADG-Lang-derived-contracts"
  },
  "mutation": {
    "kind": "none | replace",
    "feature": "typed node, relation, or phrase feature",
    "from": "optional",
    "to": "optional"
  },
  "split": "research | train | development | holdout",
  "normative": false
}
```

`research` records are always `normative=false`. A record in `train`,
`development`, or `holdout` must be `normative=true`, reference only approved
rules, and pass every provenance, license, split, and replay gate.

## Current research foundation

`Adg.QuranicTraining` currently emits 184 deterministic contract-state records:
51 positive canonical-validator states and 133 controlled negative mutations,
including typed phrase-boundary, role, member, contiguity, and laminarity
mutations. Every record uses `split=research` and
`normative=false`; no Quranic verse surface is embedded.

The current artifact is `adg-cns-quranic-grammar-corpus-v3`, derived from
contract root
`2cf54347d9222f28f603c55d6ad2c330ba9c0cad5ef8e30ddb14f219682971f5`.
Its byte-identical JSONL has SHA-256
`a5490c637427406f70896b86646a1871f8c59d80196047f8047dcfa7ae5f2187`
and corpus Merkle root
`da8eea61727893362769608914237a018135d00b80fc2f49ab710b77d93bdf14`.
It validates the schema and deterministic builder only. It is not an
authorized CNS training split.

The separate knowledge-root projection
`adg-cns-quranic-knowledge-roots-v2` binds this corpus to 1,235 morphology
roots and the complete 51-rule inventory. Its 8,001 records are divided into
7,791 Positive, 133 controlled Negative, and 77 source-evidence Unverified
records. The
artifact SHA-256 is
`cae05754f0a35ee67fb84d10df2463a34aa9089f15e4dc7dc19cfcd5af017344`
and its Merkle root is
`59fb1088af1c72f993885a1c9704a9c37ad591c6a46c032f9856ff498b7e6dbf`.
It emits no vectors and does not authorize CNS training.

## Required task families

| Task | Input | Target |
| --- | --- | --- |
| Generation constraint | Partial verified graph and open role | Allowed feature set and rule IDs |
| Validation | Candidate surface and graph claim | Valid/Invalid/Unverified plus diagnostics |
| Error diagnosis | Controlled malformed surface | Exact rule, span, observed and expected feature |
| Correction | Invalid diacritic-only candidate | Corrected surface after semantic and rewrite verification |
| Diacritization | Stripped approved surface | Canonical marks within the approved contract scope |
| Graph construction | Surface plus morphology | Verified dependent-to-head ADG graph |

## Corpus sources

1. Approved Quranic evidence whose redistribution right is registered.
2. Synthetic examples generated directly from typed ADG contracts.
3. Controlled mutations generated from approved positive records.
4. Correction and round-trip outputs that pass deterministic re-verification.

Raw QAC rows remain external evidence unless their license explicitly allows the
intended training and distribution use.

## Leakage controls

- Group a canonical record with all of its mutations and corrections.
- Group identical normalized skeletons and morphology signatures.
- Keep each Quranic verse group in one split.
- Freeze holdout membership before model tuning.
- Hash the split manifest and reject duplicate record IDs or cross-split groups.

The current research-only grouping artifact is
`adg-cns-quranic-corpus-split-manifest-v1`. It groups all 184 records into 51
provenance/rule groups, keeps every mutation with its positive rule state, and
reports zero cross-split leakage. All current records remain in `research`.
A fixed zero seed reserves future normative buckets without authorizing them:
113 records map to train, 45 to development, and 26 to holdout. The JSONL
SHA-256 is
`9517ad6525da57acddfeadff4142354a7bc072b35df22ecdc850d9bd7ddb1251`
and the split Merkle root is
`c39aeda6789bdf5a021550c9ab0e978f183d5cffa2b6c621a75fa5f114e3f14e`.
Two independent generations are byte-identical.

## Quality gates

1. Every normative record references at least one `Approved` rule.
2. Every research record is explicitly `normative=false` and excluded from
   train, development, and holdout.
3. Every target is reproduced by the parser version bound in the manifest.
4. Negative records fail for the intended diagnostic and no unrelated failure.
5. Correction records reparse to the expected graph.
6. Corpus generation replays byte-identically.
7. Train/development/holdout leakage count is zero.
8. License and attribution coverage is 100 percent.
9. Corpus and parser contract roots are Merkle-bound.

## Version boundary

The future normative corpus receives its own version and manifest:

```text
corpora\quranic-grammar\v1\
  CORPUS-MANIFEST.json
  SPLIT-MANIFEST.json
  LICENSE-REGISTER.json
  records\
    train.jsonl
    development.jsonl
    holdout.jsonl
  MERKLE-MANIFEST.json
```

Generated corpus files remain private until licensing, privacy, and publication
gates explicitly permit distribution.
