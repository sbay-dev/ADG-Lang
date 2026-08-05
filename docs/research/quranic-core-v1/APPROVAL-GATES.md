# Quranic Core v1 Research Approval Gates

**Current verdict: NOT APPROVED.**

| Gate | Requirement | Current evidence | Status |
| --- | --- | --- | --- |
| G01 Classification | Parser Tool, separate derived corpus Data, separate CNS Model lane | Charter and decision log | PASS |
| G02 Oracle isolation | Candidate198 remains evidence-only | `versions\v2` claim boundary | PASS |
| G03 Complete evidence inventory | All 45 relations and six phrases inventoried | Inventory v2 root `238add25...31b6` | PASS |
| G03A Machine-readable contract set | One deterministic contract record per relation and phrase | Contract set v3; 51 canonical contracts; root `2cf54347...971f5`; all non-normative | PASS |
| G04 Typed dependency contracts | 45 / 45 relations have explicit functional contracts or documented fail-closed deferral | 45 / 45 executable contracts; 45,023 / 45,087 source edges accepted; all 64 deferred edges are individually identified by graph, endpoints, relation, and 68 diagnostics in the hashed external audit | PASS |
| G05 Typed phrase contracts | 6 / 6 phrase families have explicit functional contracts or documented deferral | 6 / 6 executable contracts; 11,574 / 11,574 source phrase nodes accepted | PASS |
| G06 Surface preservation | Exact Quranic marks survive analysis beside the skeleton | Exact surface and normalized skeleton coexist in functional validator | PASS |
| G07 Initial ADG slice | Case-bearing relations use dependency evidence and emit diagnostics without unsafe acceptance | 18,809 checked; 11,970 verified; 6,839 Unverified; 0 Invalid; root `6aa8ac18...2aa6` | PASS |
| G08 Wrong-diacritic detection | Controlled mark mutations produce precise target-local diagnostics | 24/24 add/remove/replace mutations detected after relation/range scoping and skipped-baseline exclusion; root `1287a33c...3678` | PASS |
| G09 Diacritization | Stripped canonical input is reconstructed within the approved scope | 69 verses / 77 units accepted; 5,693 candidate units rejected; 0 unsafe acceptances | PASS |
| G10 Round trip | `parse -> diacritize -> parse` graph and Merkle equivalence | 77/77 accepted units restored exactly and preserved graph fingerprints; root `f7e10706...a11` | PASS |
| G11 Deterministic replay | Two independent runs are byte-identical | Structural, gold, property, relation, phrase, lexeme, score-policy, functional, mutation, contract, corpus, knowledge-root, and round-trip pairs match | PASS |
| G12 CNS runtime contract | Typed constraint and validation API shares rule IDs and roots while remaining independent of corpus materialization | Version/root-bound validation, typed constraint discovery, and fail-closed correction requests share contract IDs/roots; no corpus lookup is used; `NormativeCns` remains Unverified and correction leaves the graph unchanged while policies are `None` | PASS |
| G13 Kanban governance | Every step has one evidence-backed card | Dedicated board created; open cards remain | PASS |
| G14 Official QAC provenance | Official email-gated v0.4 hash matches the audited mirror | Official file unavailable | BLOCKED |
| G15 Expert Council Phase 1 | Independent theses stored and blockers adopted | Three independent reviews completed; private evidence commits to root `d03b1563...b103` | PASS |
| G16 Expert Council Phase 2 | Fixed assertion slate reaches required consensus | Three voters agreed on all 12 assertions (36 AGREE, 0 DISAGREE, 0 ABSTAIN): Tool/Data release PASS, research lane NOT APPROVED, no CNS Model/CGN/Genius claim authorized | PASS |
| G17 Research release | Isolated manifest, dossiers, Merkle root, and clean reproduction | `versions/v4` has 61 artifacts and root `5c4a24c8...c026`; an isolated clean clone reproduced a 0-warning build, 325/325 tests, two identical manifests, the same root, and a clean post-run tree | PASS |
| G18 Lexeme provenance | Every lexeme allowlist entry has authority or evidence-only provenance | Audit v1 registers 19 named collections and 352 entries: all 179 Quranic evidence-only entries have measured source matches (4,101 total; 0 zero-match), and explicit opt-in execution of all 173 natural entries yields 0 verified Quranic acceptances; 0 normative and 0 unregistered; root `a92ac454...a680` | PASS |
| G19 Scoring policy | Hard constraints and deterministic tie-breakers, or a versioned justified weight artifact | Score policy v1 binds all 63 Quranic and opt-in natural selection factors, rationales, beam size 32, and `ScoreDescending` then ordinal-signature tie-breaking; root `3edb9636...ba75`; all non-normative | PASS |
| G20 Heuristic isolation | Natural-Arabic heuristic lexicon cannot contaminate Quranic verified paths | Fallback is disabled by default, requires explicit CLI opt-in, and every heuristic-bearing parse remains `Unverified`; property replay passes | PASS |
| G21 Consumer uncertainty semantics | `Unverified` and missing phrase behavior are explicit | Documented; runtime enforcement pending under G12 | PASS |
| G22 Corpus schema | Training records bind rule, task, target, provenance, mutation, split, and roots | Schema v2 in `Adg.QuranicTraining`; 184 research records including typed phrase states | PASS |
| G23 Corpus provenance | Every training record has a registered source/license or synthetic derivation | 184/184 contract-derived records use explicit source/root/license IDs | PASS |
| G24 Leakage-safe split | Verse, skeleton, morphology, mutation, and correction groups cannot cross splits | Research grouping v1: 184 records in 51 groups, zero leakage, stable reserved 80/10/10 buckets; normative split materialization and verse/skeleton groups remain blocked | FAIL |
| G25 Corpus deterministic replay | Two corpus generations are byte-identical and Merkle-equal | Corpus v3 SHA-256 `a5490c63...2187`; root `da8eea61...df14` matched | PASS |
| G26 CNS model audit boundary | Training/evaluation occurs in a separate audited Model lane | No model training authorized yet | BLOCKED |
| G27 Knowledge-root projection | Rules, morphology roots, and controlled counterexamples have deterministic polarity, projection hashes, index keys, and shards | 8,001 records; 1,235 roots; 7,791 Positive, 133 Negative, 77 Unverified; root `59fb1088...6dbf`; byte-identical replay; 0 vectors | PASS |
| G28 CNS embedding evaluation | A portable same-version Model embeds the approved projection and passes retrieval, polarity, leakage, and ablation tests | Projection exists; no neural vectors or Model evaluation | FAIL |
| G29 CGN/Genius binding | Same-version CGN routes measured contexts to independently trained/measurable Genius components under parser constraints | No authorized CGN or Genius implementation | FAIL |
| G30 Durable research archive | A signed tag, signed source archive, or third-party deposit reproduces the release root independently of the dirty worktree | Internal clean-clone evidence passes, but no signed/tagged or third-party-verifiable archive exists | FAIL |
| G31 Independent evaluator attestation | An evaluator outside the implementation lane reproduces the build, property tests, mutations, gold metrics, and claim boundaries | No external reproduction or attestation has been recorded | FAIL |

## Approval rule

`PASS` on documentation alone does not compensate for a failed executable gate.
Approval requires every mandatory gate to pass. A `BLOCKED` provenance gate may
only be deferred by an explicit council assertion that preserves the limitation
and forbids a stronger source-authenticity claim.
