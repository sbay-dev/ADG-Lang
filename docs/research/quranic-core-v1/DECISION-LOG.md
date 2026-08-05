# Quranic Core v1 Decision Log

| ID | Decision | Consequence |
| --- | --- | --- |
| QRC-D001 | Quranic Core is a deterministic executable grammar Tool. | Do not classify it as Model, Genius, or CGN. |
| QRC-D002 | Parser and corpus are separate versioned artifacts. | Parser code supplies executable knowledge; a corpus builder emits traceable CNS training records. |
| QRC-D003 | QAC is an evidence and gold oracle, not the research authority or final parser. | Every promoted rule needs an explicit ADG contract and independent tests. |
| QRC-D004 | Candidate198 is frozen as the comparison oracle. | New functional work integrates into the existing ADG parser instead of extending a parallel final parser. |
| QRC-D005 | Quranic scope is the current release boundary. | PADT and unrestricted natural-Arabic readiness are not Quranic Core approval claims. |
| QRC-D006 | Exact surface and normalized skeleton are separate data fields. | Normalization must not destroy diacritic evidence used by verification. |
| QRC-D007 | Fail-closed is mandatory. | Unknown, ambiguous, unsupported, or contradictory structures are Unverified or Invalid, never silently accepted. |
| QRC-D008 | Correction requires re-verification and semantic conservation. | A visually plausible change is not an approved correction by itself. |
| QRC-D009 | All work is documented and Kanban-tracked. | A card cannot enter Done without evidence and cannot exist in two columns. |
| QRC-D010 | CNS uses the grammar in training and at runtime. | Training records and runtime validation share stable rule IDs and contract roots. |
| QRC-D011 | No Transformer or distillation path is authorized. | Any such implementation requires a separate explicit research decision and claim lane. |
| QRC-D012 | Research approval is a gated verdict, not a progress label. | Current status remains Not Approved until every mandatory gate passes. |
| QRC-D013 | Lexeme allowlists require per-entry provenance. | Silent hand-fitting to QAC gold is not accepted as grammatical knowledge. |
| QRC-D014 | Parser scores require a declared deterministic policy. | Replace magic weights with hard constraints and stable tie-breakers, or version and justify every weight. |
| QRC-D015 | Missing phrase detection is absence of evidence. | CNS must not interpret a missing phrase as proof that text is ungrammatical. |
| QRC-D016 | Only approved rules enter normative CNS training. | `EvidenceOnly`, `Proposed`, and `Deferred` rules remain research metadata. |
| QRC-D017 | Corpus splits are leakage-safe and deterministic. | Group related verses, lexical variants, and mutations before assigning train/dev/test. |
| QRC-D018 | Pre-approval contract records use a non-normative `research` split. | Research records may test schemas and replay, but cannot train a CNS Model or enter train/development/holdout. |
| QRC-D019 | Grammatical case is not reduced to the final visible vowel. | Duals, sound plurals, diptotes, maqsur and defective nouns, indeclinables, and attached first-person possessives remain explicitly modeled or `Unverified`. |
| QRC-D020 | A selected QAC analysis whose declared case contradicts its own canonical surface is unverified evidence. | Emit `ADG-QC2004`, mark affected graph edges unverified, and forbid functional or diacritization acceptance. |
| QRC-D021 | Surface-compatible morphology outranks grammatically convenient but surface-contradictory ambiguity. | Candidate199 uses a deterministic case/surface compatibility signal and adds regression controls for false `poss` and `pass` selections. |
| QRC-D022 | Quranic diacritization is bounded, additive, and round-trip verified. | Existing code points cannot be removed or reordered; ambiguity, unverified parser state, functional mismatch, or fingerprint drift rejects the reconstruction. |
| QRC-D023 | Contract and corpus content changes require new artifact identities. | The current non-normative artifacts are inventory v2, contracts v3, corpus v3, and knowledge roots v2; earlier identities remain historical evidence. |
| QRC-D024 | Candidate198 remains frozen while later candidates carry strict case-aware functional work. | Gold comparisons remain traceable to the frozen oracle, and new metrics are published separately without rewriting Candidate198 evidence. |
| QRC-D025 | Mutation detection is local to the mutated relation and source range. | An unrelated diagnostic elsewhere in the verse cannot satisfy a mutation gate, and stored diagnostic codes are target-specific. |
| QRC-D026 | Functionally skipped case edges cannot serve as mutation baselines. | Indeclinable and otherwise unobservable tags are excluded before mutation evidence is selected. |
| QRC-D027 | Dual-oblique source-case contradictions are recognized morphologically, not by lexeme. | Candidate200 introduced the audited `FD`/`MD` plus final `ين` condition retained by Candidate205 while preserving fail-closed `Unverified` behavior. |
| QRC-D028 | A Quranic knowledge root is a deterministic retrieval anchor, not a universal semantic claim. | Rule, morphology-root, and controlled-counterexample anchors must bind evidence roots and remain non-normative. |
| QRC-D029 | Rule polarity is tri-state. | `Positive` requires an executable canonical contract, `Negative` requires a controlled invalid mutation, and incomplete observed evidence remains `Unverified`; absence is never negative. |
| QRC-D030 | Projection is not embedding. | The Tool may emit stable projection text, hashes, index keys, and shards, but vectors require a separately audited CNS Model. |
| QRC-D031 | Executable catalog completeness is not research approval. | All 45 dependency and six phrase families may have validators while source contradictions, parser uncertainty, provenance, authority, split, archival, evaluator, or model-lane gates remain open. |
| QRC-D032 | Source evidence polarity is evaluated per edge. | A morphology-root association is Positive only when the exact source edge passes its contract; contradictory evidence remains Unverified even when the relation family has an executable validator. |
| QRC-D033 | Generated relation claims are contract-gated. | A parser edge that fails its contract is preserved only as Unverified, forces an Unverified parse state, and cannot establish verified core structure. |
| QRC-D034 | Phrase intervals are resolved, unique, and laminar. | Duplicate, crossing, unresolved, unattested-boundary, or role-incompatible phrase nodes are rejected rather than normalized into acceptance. |
| QRC-D035 | Quranic Parser v4 is ordinary software plus derived Data. | The six v4 modules and release Merkle root do not authorize a CNS Model, CGN, Genius, normative corpus, or research-approval claim. |
| QRC-D036 | Runtime validation is version and purpose bound. | Contract ID/root mismatch is Unverified; research validation may be Valid, but `NormativeCns` remains Unverified while any consumed contract is non-normative. |
| QRC-D037 | Research grouping may reserve but not activate normative splits. | The zero-seed manifest keeps mutations with their rule group and reserves stable 80/10/10 buckets, while every current record remains `research` and non-normative. |
| QRC-D038 | Named parser lexeme collections are audited data, not silent rules. | Every entry is classified as Quranic evidence-only or explicit natural-Arabic heuristic data; no current entry is normative for CNS. |
| QRC-D039 | Morphology selection uses a versioned non-normative score policy. | All selection weights, rationales, beam bounds, and tie-breakers are bound by `adg-quranic-morphology-score-policy-v1`; changing them requires a new policy identity and root. |
| QRC-D040 | Natural-Arabic morphology heuristics cannot establish Quranic verification. | Fallback is disabled by default, requires explicit opt-in, and any selected heuristic forces `Unverified` throughout the parser and runtime surfaces. |
| QRC-D041 | Runtime correction is advisory and fail-closed. | Constraint discovery may expose typed contracts, but a correction request never mutates the graph; absent an approved non-`None` policy it returns no directive and requires full re-verification for any future applied correction. |
| QRC-D042 | Council consensus may complete governance while denying research approval. | The unanimous Phase-2 slate passes the Tool/Data release, retains `NOT APPROVED` for the research lane, and authorizes no CNS Model, CGN, or Genius claim while adopted blockers remain. |
| QRC-D043 | Full council theses and votes remain external evidence. | The repository stores only the sanitized roster, tally, verdict, blocker summary, manifest hash, and evidence Merkle root; operational council artifacts are not published. |
