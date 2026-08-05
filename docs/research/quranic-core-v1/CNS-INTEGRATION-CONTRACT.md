# CNS Training and Runtime Grammar Contract

## Purpose

Future CNS models may train on the separately generated Quranic grammar corpus
and use Quranic Core during generation. Parser code, source evidence, derived
training records, model weights, and runtime verification remain distinct
versioned artifacts.

## Training interaction

```text
approved rule contracts
  + licensed Quranic evidence or reviewed synthetic fixtures
  + deterministic mutations and corrections
  -> corpus builder
  -> leakage-safe train / development / holdout splits
  -> CNS model training
  -> separate CNS model audit
```

## Allowed interaction

```text
CNS generation state
  -> request applicable grammatical constraints
  -> produce a candidate token or span
  -> Quranic Core validates the candidate
  -> accept, reject, or return a bounded correction
  -> re-validate the completed structure
```

The policy gate is:

| Parser status | CNS action |
| --- | --- |
| `Valid` | Accept only when every consumed rule is approved and normative. |
| `Unverified` | Reject from direct generation or route to a correction/research queue. Never silently accept. |
| `Invalid` | Reject and return diagnostics. |

Failure to detect a phrase is not proof of ungrammaticality. It means the
requested phrase claim is unsupported by the current rule coverage.

## Implemented runtime validation API

`src\Adg.QuranicGrammar\QuranicGrammarRuntime.cs` exposes a typed
version-bound validator independent of corpus materialization. It accepts an
actual dependency/phrase graph, verifies the contract-set ID and Merkle root,
derives the applicable rule IDs, runs the canonical graph contracts, and
returns exactly `Valid`, `Invalid`, or `Unverified`.

### Runtime request

```json
{
  "contractSetId": "adg-quranic-grammar-contracts-v3",
  "contractSetRoot": "2cf54347...971f5",
  "graph": "typed QacDependencyGraph",
  "ruleIds": ["QUR-QAC-REL-SUBJ"],
  "mode": "NormativeCns | ResearchValidation"
}
```

### Runtime result

```json
{
  "status": "Valid | Invalid | Unverified",
  "contractSetId": "adg-quranic-grammar-contracts-v3",
  "contractSetRoot": "2cf54347...971f5",
  "graphId": "stable caller graph ID",
  "mode": "NormativeCns | ResearchValidation",
  "ruleIds": ["QUR-QAC-REL-SUBJ"],
  "consumptionPolicies": ["ResearchMetadataOnly"],
  "normativeForCns": false,
  "diagnostics": []
}
```

Contract identity mismatch, unknown rules, absent claims, unverified edges, or
non-normative contracts in `NormativeCns` mode return `Unverified`. A
well-formed but contract-violating graph returns `Invalid`. Because every
current contract is non-normative, `NormativeCns` mode cannot currently return
`Valid`; `ResearchValidation` may return `Valid` for measured Tool behavior.

`DiscoverConstraints` accepts the same contract ID/root plus either graph
claims or rule IDs and returns the typed non-corpus contract records. Identity
mismatch, unknown claims, declaration/graph mismatch, and non-normative
consumption fail closed with the same tri-state status.

`RequestCorrection` first runs full validation, then exposes only correction
directives declared by the effective contracts. It never mutates the input
graph and every directive requires re-validation. All current contract
policies are `None`, so invalid or unverified requests return no automatic
directive and preserve the original graph.

## Prohibited interaction

- Exporting raw QAC rows without a redistribution right.
- Creating training records without rule, provenance, split, and contract roots.
- Updating CNS weights inside the parser Tool release.
- Treating parser confidence as a language-model probability.
- Accepting a generated candidate when the parser returns `Unverified`.
- Calling deterministic rule execution a Genius.
- Consuming a contract whose `isNormativeForCns` field is `false`.

## Knowledge preparation

The parser is cognitively prepared for CNS when each approved rule exposes:

1. a stable identifier;
2. typed preconditions;
3. allowed and forbidden transitions;
4. expected case, mood, voice, and agreement;
5. a diagnostic and explanation;
6. a bounded correction policy;
7. evidence references and replay root; and
8. deterministic serialization.

The same knowledge is serialized twice:

1. executable contracts for the parser Tool; and
2. auditable supervised records for the CNS grammar corpus.

The corpus is derived from the contracts; it is not an undocumented copy of the
evidence source.

The research lane also emits a third, non-normative representation:

3. deterministic knowledge-root projections for retrieval, indexing, and
   future embedding.

The projection catalog uses positive, controlled negative, and unverified
states. It emits stable SHA-256 identities and 256 deterministic shards, but no
embedding vectors. See `QURANIC-KNOWLEDGE-ROOTS-SPEC.md`.

## Acceptance boundary

CNS binding remains blocked even though the parser now independently preserves
observed diacritics, diagnoses the 24 controlled mutations, rejects unsupported
structures, reconstructs a bounded slice, reparses accepted output to the same
fingerprints, and replays byte-identically. Those executable gates establish a
Tool capability; they do not authorize CNS training.

The research corpus now has a deterministic grouping manifest that keeps every
positive state with all mutations sharing its provenance source and reserves a
stable 80/10/10 future bucket. All 184 current records remain in `research`;
the reserved buckets do not authorize movement into train, development, or
holdout. The model-training lane remains blocked until approved normative
records exist and the license register, final split materialization, leakage
checks, and separate CNS Model audit pass. The knowledge-root projection and
index keys likewise do not prove a CNS embedding, CGN, or Genius.
