# ADG Quranic Core Research Kanban

This is the canonical board for `adg-quranic-core-research-v1`.

## Board policy

| Rule | Requirement |
| --- | --- |
| One state | A card appears in exactly one column. |
| Evidence before Done | Every Done card records a path, command, hash, or Merkle root. |
| No evidence inflation | QAC observations are not labeled functional ADG rules. |
| Artifact separation | Parser Tool, derived corpus Data, and future CNS Model remain separately versioned and audited. |
| Fail closed | Unsupported work remains Open, Blocked, Deferred, or Unverified. |
| Reopen on drift | A source or evidence change reopens every affected card. |

## Backlog

| Card | Owner | Acceptance criteria |
| --- | --- | --- |
| QRC-023: Publish Quranic i'rab contracts | Grammar engineer | Each supported relation states whether i'rab is observed, inferred, or independently verified. |
| QRC-026: Register corpus licenses | Research governance | Every non-synthetic record maps to an allowed source and license entry. |
| QRC-028: Audit CNS training lane | CNS model lead | Separate Model training and evaluation pass the CNS audited documentation cycle. |
| QRC-037: Train and evaluate Quranic CNS embeddings | CNS model lead | Portable non-Transformer Model consumes only approved splits and passes retrieval, polarity, leakage, and ablation gates. |
| QRC-038: Bind Quranic CGN and Genius roles | CGN architect | Same-version routing is measurable, parser-constrained, and cannot consume Unverified or non-normative records as accepted knowledge. |
| QRC-044: Archive a signed research snapshot | Release engineer | A signed tag, signed source archive, or third-party deposit reproduces release root `5c4a24c8...c026` without trusting the local dirty worktree. |
| QRC-045: Obtain independent evaluator attestation | Research lead | An external evaluator reproduces the build, 325 property tests, 24 mutations, gold metrics, and claim boundaries from the archived snapshot. |

## Ready

| Card | Owner | Acceptance criteria |
| --- | --- | --- |
No cards.

## In Progress

| Card | Owner | Acceptance criteria | Current evidence |
| --- | --- | --- | --- |
| QRC-006: Define typed Quranic rule contracts | Grammar engineer | Stable schema covers evidence, roles, features, diagnostic, correction, fixtures, and status. | Contract set v3 has 51 executable records and root `2cf54347...971f5`; per-rule independent citations and approved non-`None` correction policies remain. |
| QRC-025: Complete deterministic corpus generator | Data engineer | Extend the contract corpus with approved correction, diacritization, graph, and leakage-safe split records. | Corpus v3 has 184 records and replays byte-identically at root `da8eea61...df14`; surface tasks and leakage-safe splits remain. |
| QRC-027: Create leakage-safe splits | Evaluation engineer | Verse/skeleton/morphology/mutation groups never cross train, development, and holdout. | Research grouping v1 covers 184 records in 51 groups with zero leakage and stable reserved buckets; normative materialization and verse/skeleton grouping remain. |

## Review

| Card | Owner | Acceptance criteria | Evidence |
| --- | --- | --- | --- |
| QRC-046: Publish sanitized researcher handoff | Release engineer | A public pull request contains buildable source, immutable v4 evidence, claim boundaries, reproduction commands, reviewer forms, and automated disclosure checks without raw corpora or private review artifacts. | `docs\research\quranic-core-v1\INDEPENDENT-RESEARCHER-HANDOFF.md`; public CI and pull-request review pending. |

## Blocked

| Card | Blocker | Exit condition |
| --- | --- | --- |
| QRC-018: Verify official QAC v0.4 acquisition | Official source is email-gated and unavailable locally. | Obtain the official file and hash-compare it with the audited mirror. |

## Done

| Card | Evidence |
| --- | --- |
| QRC-001: Fix classification and claim boundary | `docs\research\quranic-core-v1\RESEARCH-CHARTER.md`; `DECISION-LOG.md`. |
| QRC-002: Freeze Candidate198 as evidence oracle | `versions\v2\RELEASE.md`; release root `a314cea8...03c2e`. |
| QRC-003: Map the ADG functional integration seam | `docs\research\quranic-core-v1\ADG-INTEGRATION-MAP.md`. |
| QRC-004: Inventory all QAC rule families | 45/45 relations, 6/6 phrases; inventory v2 root `238add25...31b6`; report SHA-256 `c25f2485...3722`. |
| QRC-005: Establish research documentation and Kanban | This board, research charter, lifecycle, CNS contract, approval gates, and evidence register. |
| QRC-007: Preserve exact orthography and diacritics | Exact surfaces coexist with normalized skeletons; ordered mark multiplicity and order are preserved, and reconstruction is additive-only. |
| QRC-008: Implement first functional ADG case slice | 18,808 checked edges; 11,969 verified; 6,839 Unverified; 0 Invalid; root `86b6b00c...03a1`. |
| QRC-009: Add Quranic diacritic mutations | 24/24 add/remove/replace mutations detected only at the mutated relation/range; functionally skipped edges are excluded as baselines; root `1287a33c...3678`. |
| QRC-010: Add diacritization round trip | 69 verses and 77 units accepted; 77/77 exact restorations and graph-equivalent replays; 0 unsafe acceptances; root `09243741...fed0`. |
| QRC-012: Complete dependency contracts | 45/45 dependency relations have executable non-normative contracts; source audit accepts 45,023/45,087 edges and explicitly defers 64; root `0c77bd35...b4d6`. |
| QRC-013: Complete phrase contracts | 6/6 phrase families have executable non-normative contracts; full audit accepts 11,574/11,574 phrase nodes; root `7b4619db...8473`. |
| QRC-014: Quran-wide unified-parser replay | Candidate205 structural, gold, property, relation audit, phrase audit, functional, mutation, contract, corpus, knowledge-root, and diacritization artifacts replay byte-identically. |
| QRC-019: Export non-normative machine-readable contracts | Contract set v3 has 51 canonical JSONL records; root `2cf54347...971f5`; all `isNormativeForCns=false`. |
| QRC-024: Implement corpus record schema | `Adg.QuranicTraining` binds rule IDs, tasks, targets, provenance, mutations, split, and roots. |
| QRC-030: Build research corpus foundation | Corpus v3 has 184 non-normative records; SHA-256 `a5490c63...2187`; root `da8eea61...df14`; byte-identical replay. |
| QRC-031: Enforce case/surface-compatible morphology | Candidate200 introduced the strict compatibility rules retained by Candidate205, rejects false passive-subject ambiguity, and emits `ADG-QC2004` for source contradictions. |
| QRC-032: Model non-simple Quranic case realization | Dual, sound-plural, sound-feminine-plural, maqsur, defective, diptote, indeclinable, and possessive-yā cases fail closed when a simple final-mark mapping is unsafe; dual-oblique source contradictions use a morphological rule rather than a lexical exception. |
| QRC-033: Bind skipped verses into round-trip evidence | All 6,236 verses contribute either an evaluated or skipped leaf; corpus root `2cbd80e1...9650`. |
| QRC-034: Extract Quranic knowledge roots | 1,235 morphology roots are bound to rule IDs, roles, lemmas, tags, features, evidence validity, and counts without verse surfaces. |
| QRC-035: Build rule polarity partitions | 8,001 records: 7,791 Positive, 133 controlled Negative, and 77 source-evidence Unverified; absence is not labeled negative. |
| QRC-036: Build deterministic CNS projection index | Artifact SHA-256 `cae05754...7344`; Merkle root `59fb1088...6dbf`; all 256 shards populated; byte-identical replay; 0 vectors and 0 normative records. |
| QRC-039: Audit every source relation edge | 45,087/45,087 edges received a contract verdict; 45,023 accepted and all 64 deferred edges are individually identified by graph, endpoints, relation, and 68 stable diagnostics in `relation-a.json#issueSamples`; root `0c77bd35...b4d6`. |
| QRC-040: Audit every source phrase node | 11,574/11,574 phrase nodes across 7,373 graphs passed executable boundary, role, and laminarity contracts; root `7b4619db...8473`. |
| QRC-041: Bind knowledge polarity to evidence validity | Lexical associations become Positive only when their source edge passes its contract; 77 aggregated Unverified projections preserve the 64 deferred source edges. |
| QRC-042: Add fail-closed runtime validation surface | `QuranicGrammarRuntime` binds contract ID/root, derives rule claims, validates graphs, and prevents non-normative contracts from returning `Valid` in `NormativeCns` mode. |
| QRC-043: Add deterministic research grouping manifest | Split artifact v1 groups 184 records into 51 provenance/rule groups; SHA-256 `9517ad65...1251`, root `c39aeda6...f14e`, zero leakage, byte-identical replay. |
| QRC-011: Implement CNS runtime interface | Version/root-bound validation, typed constraint discovery, and correction requests share the 51 rule IDs and contract root; normative mode and absent correction policies fail closed, and correction never mutates the input graph. |
| QRC-017: Package research release | `versions\v4` binds six same-version modules and 61 artifacts at root `5c4a24c8...c026`; an isolated clone reproduced the 0-warning build, 325/325 tests, manifest hash `e06c67fa...c74d`, the same root, and a clean post-run tree. |
| QRC-015: Run Expert Council Phase 1 | Three independent theses were completed; blockers and vote-ready assertions are bound in private evidence root `d03b1563...b103`. |
| QRC-016: Expert Council Phase 2 vote | All three members voted AGREE on A1-A12: 36/36 AGREE, no dissent or abstention. Final verdict: Tool/Data PASS; Quranic research NOT APPROVED; CNS Model/CGN/Genius NO CLAIM AUTHORIZED. |
| QRC-020: Audit lexeme allowlists | Audit v1 covers 19 named collections and all 352 entries: 179 Quranic evidence-only entries have 4,101 exact source-treebank matches with 0 zero-match entries; explicit opt-in execution of 173 natural entries has 0 verified Quranic acceptances; 0 normative and 0 unregistered; SHA-256 `bf8678e1...1f74`, root `a92ac454...a680`. |
| QRC-021: Replace or version parser scores | `adg-quranic-morphology-score-policy-v1` binds all 63 Quranic and opt-in natural factors, beam size 32, and stable score/signature tie-breakers; SHA-256 `4a6dfc65...7f7e`, root `3edb9636...ba75`. |
| QRC-022: Isolate natural-Arabic heuristics | Natural fallback is off by default, CLI opt-in is explicit, and any heuristic-bearing parse remains `Unverified`; regression replay passes within 325/325 tests. |

## Definition of Done for the lane

The lane is complete only when:

1. every mandatory gate in `APPROVAL-GATES.md` is PASS;
2. all 45 relations and six phrase families are approved or explicitly deferred;
3. wrong diacritics are detected by controlled Quranic mutations;
4. the approved scope can be diacritized and deterministically reparsed;
5. CNS training records and runtime validation share typed contract IDs and roots;
6. the derived CNS corpus passes provenance, leakage, and replay gates;
7. Phase-2 council consensus has no adopted blocker; and
8. the parser, corpus, and any trained CNS Model each reproduce with separate verified Merkle roots.
