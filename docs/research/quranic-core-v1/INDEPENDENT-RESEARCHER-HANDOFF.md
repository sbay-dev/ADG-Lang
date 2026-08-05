# Independent Researcher Handoff: ADG-Lang Quranic Parser v4

## Binding verdict

The published v4 snapshot is a reproducible **ordinary deterministic software
Tool** plus separately generated **non-normative Data** artifacts.

It is **not** an approved complete grammar of the Quran, an approved normative
training corpus, a CNS Model, a CGN, or a Genius. The research lane remains
`NOT APPROVED`.

This distinction is the primary interpretation rule for every number and file
in this handoff.

## What “complete” means here

Three different claims must not be merged:

| Statement | Status | Meaning |
| --- | --- | --- |
| Observed QAC inventory coverage | Complete | All 45 dependency labels and all six phrase tags observed in the pinned source were catalogued. |
| Executable contract coverage | Complete but non-normative | Every observed label/tag has a deterministic contract, test path, and fail-closed result. |
| Complete and independently approved Quranic grammar | Not established | Independent rule authority, official morphology comparison, normative splits, archival, and evaluator gates remain open. |

Inventory completeness means “no observed schema family was silently omitted.”
It does not mean “all possible Quranic grammar has been discovered” or “every
source annotation is correct.”

## What counts as a parser

The system is a parser because it performs a deterministic, typed,
inspectable transformation:

```text
exact Quranic surface and source spans
  -> normalized analysis forms and clitic candidates
  -> morphology candidates
  -> dependency and phrase candidates
  -> executable rule-contract checks
  -> Valid, Invalid, or Unverified graph state
  -> diagnostics, constraint discovery, or bounded diacritization
```

It is not a free-form statistical guesser. Unsupported states do not become
accepted grammar. Natural-Arabic heuristics are disabled by default, require
explicit opt-in, and cannot produce a verified Quranic state.

The implementation is nevertheless only a bounded research parser. It does
not yet justify unrestricted parsing of every Quranic construction or arbitrary
Arabic text.

## State semantics

| State | Meaning | What it does not mean |
| --- | --- | --- |
| `Valid` | The declared graph claims satisfy the currently bound executable contracts. | Independent scholarly approval or normative CNS authorization. |
| `Invalid` | A checked claim contradicts a bound contract and receives a diagnostic. | That every possible error outside the checked scope was detected. |
| `Unverified` | Evidence, coverage, or policy is insufficient for acceptance or rejection. | “Probably valid,” “safe to train on,” or permission to silently coerce. |

The Quran-wide result has zero `Invalid` verses because unsupported material is
preserved as `Unverified`; it must not be reported as 100% grammatical
correctness.

## Architecture and repository map

| Path | Responsibility |
| --- | --- |
| `src\Adg.QuranicCore` | Uthmani-span preservation, normalization, token/clitic candidates, and bounded causal analysis. |
| `src\Adg.QuranicCorpus` | QAC morphology parsing, catalog validation, provenance checks, and deterministic import. |
| `src\Adg.QuranicGrammar` | Deterministic parser, 45 relation contracts, six phrase contracts, scoring policy, lexeme audit, runtime API, and diacritic gates. |
| `src\Adg.QuranicTraining` | Non-normative corpus records, leakage grouping, and knowledge-root projection. |
| `src\Adg.QuranicCorpus.Cli` | Reproduction, evaluation, audit, contract, corpus, and knowledge-root commands. |
| `src\Adg.QuranicCore.Cli` | Bounded causal corpus verification. |
| `ADG-Lang.Native.slnx` | Original v4 release solution. |
| `ADG-Lang.Quranic.slnx` | Standalone evaluator solution for Quranic projects only. |
| `versions\v4` | Immutable release dossiers, sanitized evidence, and the 61-artifact Merkle manifest. |
| `docs\research\quranic-core-v1` | Charter, decisions, lifecycle, approval gates, CNS boundary, and evidence register. |
| `docs\kanban\ADG-QURANIC-CORE-KANBAN.md` | Canonical evidence-backed research board. |

## Current measured snapshot

| Measure | Result |
| --- | ---: |
| Release artifacts | 61 |
| Release Merkle root | `5c4a24c81c9e5154f435c72f47e5dca7f8ebf60341b96105e5b3bec38b60c026` |
| Release manifest SHA-256 | `e06c67fa1a63ac087d3c7862f552f18151a181de6ab250e938359a864576c74d` |
| Property and mutation tests | 325 / 325 |
| Dependency relation contracts | 45 / 45 |
| Phrase contracts | 6 / 6 |
| Accepted source relation edges | 45,023 / 45,087 |
| Explicitly deferred source relation edges | 64 |
| Accepted source phrase nodes | 11,574 / 11,574 |
| Quran-wide structural states | 5,708 Valid; 528 Unverified; 0 Invalid |
| Generated dependency edges | 63,877 |
| Generated Unverified edges | 187 |
| Exact edge F1 on comparable official subset | `0.9043870391` |
| Phrase F1 on comparable official subset | `0.6615022198` |
| Functional diacritic states | 1,634 Valid; 4,602 Unverified; 0 Invalid |
| Controlled diacritic mutations | 24 / 24 detected |
| Bounded round-trip slice | 69 verses; 77 units; 0 unsafe acceptances |
| Lexeme collections | 19 fields; 352 entries; 0 unregistered |
| Quranic lexeme evidence | 179 entries; 4,101 source matches; 0 zero-match |
| Natural heuristic entries | 173 opt-in entries; 0 verified Quranic acceptances |
| Morphology score policy | 63 justified factors; deterministic score/signature ordering |
| Machine-readable contracts | 51; all `isNormativeForCns=false` |
| Research corpus | 184 records: 51 Positive; 133 Negative; 0 normative |
| Leakage grouping | 51 groups; zero observed cross-split leakage; normative materialization blocked |
| Knowledge-root projection | 8,001 records: 7,791 Positive; 133 Negative; 77 Unverified |
| Neural vectors | 0 |

The machine-readable source of the detailed hashes and report identities is
`EVIDENCE-REGISTER.json`. The release-level sanitized summary is
`versions\v4\evidence\quranic-grammar-v4-evidence.json`.

## Diacritic capability and limitation

The parser can detect wrong diacritics only where a typed relation, source
span, morphology candidate, and functional contract jointly establish an
expected mark. Controlled add/remove/replace mutations passed `24/24`.

The system must return `Unverified` outside that scope. The 4,602
functionally-Unverified verses are therefore a visible limitation, not hidden
successes. The diacritizer is additive-only and accepts a reconstruction only
when one canonical surface survives ambiguity and parse/graph fingerprints
remain equivalent.

## Evidence provenance

| Source | Public commitment | Boundary |
| --- | --- | --- |
| QAC morphology v0.4 | Expected 128,219 segments, 77,429 words, 6,236 verses, 114 chapters | Official file is email-gated; the official hash has not yet been compared with the audited mirror. Raw file is excluded. |
| Quranic Corpus API syntax | Commit `17a9062416eccc332111ef3e84f74072d709e187`; syntax SHA-256 `9a9037b23c2d8309838171af1b1d4d99528a4f07f8298e97a9d7fa04ce952491` | Upstream repository declares no repository license; raw syntax and compact morphology are excluded. |
| Arabic-PADT | Commit and license recorded under `THIRD_PARTY\ud-arabic-padt` | Development data, not an untouched final holdout. Raw CoNLL-U is excluded. |
| Arabic-PUD | Commit `b5dbaa1fe386ae38d9b3c5f1de1b047d3cb31e0f` | Previously consumed final holdout; not reusable as a new untouched readiness test. The frozen v4 source still contains its earlier `untouched-final-holdout` label; the binding current classification is in `THIRD_PARTY\ud-arabic-padt\CURRENT-EVALUATION-BOUNDARY.md`. Raw CoNLL-U is excluded. |

QAC annotations are evidence and an evaluation oracle. They are not silently
converted into independently established ADG grammatical authority.

## Corpus and CNS boundary

The 184-record corpus and 8,001-record knowledge-root projection contain
contract-derived metadata and controlled counterexamples, not neural
embeddings. Every current contract is non-normative. `NormativeCns` runtime
validation therefore fails closed.

No training, production promotion, CNS Model, CGN, or Genius claim is
authorized by this release. Such work requires a separate same-version audited
Model lane after the grammar and licensing gates pass.

## Independent review evidence

Three independent reviews and a fixed 12-assertion vote produced:

- `36 AGREE`
- `0 DISAGREE`
- `0 ABSTAIN`
- Tool/Data release: `PASS`
- Quranic research lane: `NOT APPROVED`
- CNS Model/CGN/Genius: `NO CLAIM AUTHORIZED`

The public commitment to the private review package is:

- evidence Merkle root:
  `d03b1563d7823e198c21cc693f4e4e0b56295fa392a96e5fe848ffd70286b103`
- manifest SHA-256:
  `4080881ea0ad13c4f216bda867e6a5bb34b5a253c03794577b4b7f212fdf16f9`

Raw transcripts, runtime/model identifiers, local paths, and internal
verification material are intentionally excluded. The public root is a
commitment, not independently inspectable council evidence.

The immutable v4 root also preserves historical metadata that became stale
after evaluation, most notably the PUD role string. `KNOWN-LIMITATIONS.md`
identifies such cases explicitly. Correcting a Merkle-bound source file
requires a new release root rather than silently rewriting v4.

## Open gates that prevent approval

1. Obtain the official QAC v0.4 file and hash-compare it with the audited mirror.
2. Add independent grammatical references for each rule, not only source-treebank observations.
3. Materialize and verify normative leakage-safe train/development/holdout splits.
4. Select and publish an explicit repository license and verify every derived-data right.
5. Create a signed/tagged archival snapshot or third-party deposit.
6. Obtain an external evaluator attestation from the public snapshot.
7. Run any future CNS Model, CGN, or Genius work in separate audited lanes.

## Required independent evaluator output

An evaluator should:

1. identify the exact commit and environment;
2. execute `REPRODUCTION-GUIDE.md`;
3. report every mismatch without substituting a success-shaped fallback;
4. assess whether the public evidence supports each row in
   `CLAIM-BOUNDARIES.md`;
5. record corpus/license limitations;
6. complete `INDEPENDENT-REVIEW-CHECKLIST.md`; and
7. submit only sanitized results through the Quranic research review issue
   form.

An external reproduction can close the evaluator gate only. It cannot by
itself close source authenticity, scholarly authority, licensing, normative
split, archival, or CNS Model gates.
