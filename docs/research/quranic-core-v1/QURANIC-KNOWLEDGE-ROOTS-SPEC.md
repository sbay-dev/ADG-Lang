# Quranic Knowledge-Root Projection Specification

## Purpose

This artifact prepares audited Quranic grammar knowledge for later CNS
embedding, indexing, routing, and evaluation. It does not create neural
embeddings, train a CNS Model, instantiate a CGN, or promote deterministic
logic to a Genius.

The artifact ID is `adg-cns-quranic-knowledge-roots-v2`.

## Definition

A knowledge root is an auditable retrieval anchor, not a universal semantic or
theological claim. The current catalog has three anchor classes:

1. `rule`: one anchor for every dependency or phrase contract;
2. `morphology-root`: a QAC root associated with a relation and its dependent
   or head role; and
3. `rule-counterexample`: a controlled invalid state derived from an executable
   contract mutation.

Every record binds:

- the rule-inventory Merkle root;
- the contract-set Merkle root;
- the grammar-corpus Merkle root;
- the syntax-treebank graph root;
- stable rule IDs and relation codes;
- morphology roots, lemmas, tags, and features when applicable;
- a polarity and validation status;
- exact diagnostic codes for controlled negative states;
- deterministic projection text and SHA-256;
- a stable index key and one of 256 distribution shards; and
- `split=research`, `normative=false`.

No Quranic verse surface is embedded in the committed software or in the
projection schema.

## Polarity contract

| Polarity | Meaning | CNS policy |
| --- | --- | --- |
| `Positive` | Executable canonical-validator contract, or an observed root/rule association whose exact source edge passes that contract | Research projection only until the rule is approved and normative |
| `Negative` | Controlled counterexample with expected parser diagnostics | May train rejection only after leakage, license, and Model audit gates pass |
| `Unverified` | Observed source evidence that fails or cannot satisfy its executable contract | Metadata and retrieval only; never an accepted generation target |

Absence of a relation, phrase, or root association is not a negative example.
Only a controlled mutation with a deterministic invalid target is negative.

## Projection and embedding boundary

Each record contains `projectionText`, `projectionSha256`, `indexKey`, and
`shard`. The projection is a stable textual feature document suitable for a
future embedding model. The current builder emits:

```text
embeddingPolicy=ProjectionOnlyNoVector
embeddingVectorCount=0
```

An embedding vector may be added only in a separate CNS Model version with:

1. portable training and inference source;
2. a declared zero seed and data split;
3. retrieval and polarity evaluation;
4. leakage and license evidence;
5. same-version Model -> CGN -> Genius -> Tool binding; and
6. an audited claim-boundary review.

## Index and distribution contract

`projectionSha256` is the content identity. The first hash byte selects a stable
shard in `[0, 255]`:

```text
qkr-v2/<two-digit-shard>/<projection-sha256>
```

This is deterministic data distribution, not learned semantic routing. A future
CGN may consume these keys only after its routing behavior is independently
implemented, measured, and version-bound.

## Current deterministic evidence

| Measure | Result |
| --- | ---: |
| Records | 8,001 |
| Rule assertions | 51 |
| Morphology/rule associations | 7,817 |
| Distinct morphology roots | 1,235 |
| Controlled negative records | 133 |
| Positive records | 7,791 |
| Negative records | 133 |
| Unverified records | 77 |
| Normative records | 0 |
| Embedding vectors | 0 |
| Distribution shards | 256 / 256 |
| Artifact bytes | 13,961,526 |
| Artifact SHA-256 | `cae05754f0a35ee67fb84d10df2463a34aa9089f15e4dc7dc19cfcd5af017344` |
| Knowledge Merkle root | `59fb1088af1c72f993885a1c9704a9c37ad591c6a46c032f9856ff498b7e6dbf` |
| Replay | Byte-identical |

## Remaining approval work

This artifact closes the deterministic projection and index preparation step
for the current executable contract catalog. It does not close Quranic Core
research approval. Approval still requires resolution or reviewed preservation
of the 64 deferred source edges, official QAC hash comparison, leakage-safe
normative splits, independent per-rule authority, a durable signed research
archive, and independent evaluator reproduction. The runtime, internal
clean-clone, and two-phase council procedures are complete but did not grant
research approval.
