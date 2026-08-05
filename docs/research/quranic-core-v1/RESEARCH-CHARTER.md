# Quranic Core v1 Research Charter

## Research question

Can the grammatical structures evidenced in the Quran be represented as
deterministic, typed ADG contracts that can:

1. analyze the observed Arabic surface without destroying its diacritics;
2. detect and explain grammatical violations;
3. reject unsupported or malformed structures;
4. propose bounded corrections without changing the consonantal skeleton;
5. reconstruct required diacritics and re-verify the result; and
6. produce an auditable derived corpus for CNS training; and
7. constrain and validate CNS generation at runtime?

## Hypotheses

| ID | Hypothesis | Required falsification test |
| --- | --- | --- |
| H1 | Quranic grammatical relations can be represented as typed ADG contracts. | A relation cannot be expressed without lexical memorization or an unbounded heuristic. |
| H2 | Exact observed diacritics and a normalized analysis skeleton can coexist. | A normalization step irreversibly removes evidence required by a rule. |
| H3 | A correction can be accepted only after semantic conservation and deterministic re-verification. | A proposed correction changes the skeleton, meaning-bearing tokens, or verified graph. |
| H4 | Approved parser contracts can generate an auditable CNS grammar corpus. | A training record cannot be traced to an approved rule, source boundary, mutation, and deterministic target. |
| H5 | CNS can use the same contracts at runtime after training. | Training and runtime verification disagree on rule identity or accepted output. |
| H6 | Quranic rule and morphology evidence can be projected into a deterministic positive/negative/unverified knowledge index. | A record cannot reproduce its polarity, rule binding, projection hash, shard, or Merkle membership. |

## Artifact classification

The parser lane is ordinary deterministic software under development. Under the
CNS audit taxonomy it may become a **Tool**. The generated corpus is a separate
Data artifact. A CNS model trained on that corpus belongs to a separate Model
lane and requires its own audited training, evaluation, and same-version binding.

## Evidence hierarchy

1. The exact Quranic surface and its observed orthographic marks.
2. Sourced Arabic grammatical definitions and analyses.
3. Pinned QAC morphology and syntax annotations as an evidence/gold oracle.
4. Candidate198 as a frozen deterministic comparison oracle.
5. Explicit ADG contracts with positive, near-miss, reversal, and mutation tests.
6. Quran-wide deterministic replay and Merkle-bound reports.

QAC annotations are observations to audit. A QAC relation name is not
automatically a universal grammatical law.

The current Quranic syntax oracle inherits case, mood, and voice features from
QAC morphology. It does not yet independently derive complete i'rab from the
observed Uthmani diacritics. This limitation remains binding until the
surface-preserving functional parser passes the diacritic gates.

## Scope

The initial research scope is Quranic Arabic. Natural-Arabic generalization is
not a release gate for this lane and must not be claimed from Quran-only
evidence. The first functional slice covers:

- `Fa'il` / subject with expected Raf;
- `Maf'ul` / object with expected Nasb;
- prepositional Jarr;
- Idafa / possessive-genitive relations;
- exact observation and mutation of final case marks.

Expansion proceeds relation by relation until all 45 dependency relations and
six phrase families have either:

1. an approved typed contract; or
2. a documented fail-closed boundary explaining why no contract was promoted.

## Parser/corpus separation boundary

The parser source must not be confused with its derived corpus. The corpus
builder must not:

- export raw QAC rows or Quranic text without a documented license boundary;
- create a record without a stable rule ID and provenance;
- place unapproved or `EvidenceOnly` rules in the normative training split;
- mix train, development, and holdout groups through verse or mutation leakage;
- use statistical success as a substitute for a typed grammatical rule;
- treat lexical co-occurrence as proof of a grammatical contract.

The derived corpus may contain licensed or synthetic positive examples,
controlled negative mutations, corrections, diacritization targets, dependency
graphs, rule IDs, diagnostics, and hashes. Its schema is defined in
`CNS-TRAINING-CORPUS-SPEC.md`.

Lexeme allowlists and parser scoring constants are not exempt from this rule.
Each must be replaced by a cited grammatical contract or published as an
explicit evidence-derived heuristic with provenance, scope, and measured effect.

## Research method

Every rule follows `RULE-LIFECYCLE.md`. Every implementation step has one
Kanban card. Every Done card records a reproducible command or immutable
evidence hash. Any mismatch between documentation and executable behavior
reopens the card.

## Approval authority

Research approval requires:

1. all mandatory technical gates in `APPROVAL-GATES.md`;
2. an independent Expert Council Phase-1 review;
3. remediation of every adopted blocker;
4. Phase-2 votes over a fixed assertion slate;
5. a verified council evidence root; and
6. an isolated research release manifest and Merkle manifest.
