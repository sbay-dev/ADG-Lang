# Known Limitations and Frozen Historical Metadata

## KL-001: Arabic-PUD role label

`src\Adg.QuranicGrammar\UdArabicPadt.cs` is included in the immutable v4
Merkle root and still labels Arabic-PUD as `untouched-final-holdout`. That
label described its role before the historical evaluation was executed.

PUD has since been consumed. The binding current classification is
`previously-consumed-final-holdout`, recorded in
`THIRD_PARTY\ud-arabic-padt\CURRENT-EVALUATION-BOUNDARY.md` and its provenance
template. It cannot support a new natural-Arabic readiness claim.

The source label is disclosed rather than silently changed because changing a
Merkle-bound v4 artifact would invalidate the published root. The next
ordinary-software release must correct the executable descriptor and publish a
new root.

## KL-002: Quranic coverage

All observed QAC relation and phrase families have contracts, but 64 source
edges, 528 structural verses, and 4,602 functional-diacritic verses remain
`Unverified`. The release does not establish unrestricted Quranic or
natural-Arabic correctness.

## KL-003: Source authority

QAC annotations are external evidence and a comparison oracle. Independent
traditional/linguistic references have not yet been bound to every executable
contract.

## KL-004: Official morphology provenance

The audited mirror passed structural checks, but the official email-gated QAC
v0.4 file has not yet been acquired and hash-compared.

## KL-005: Corpus and model use

All 51 contracts and all 184 corpus records are non-normative. The knowledge
projection contains zero neural vectors. No CNS Model, CGN, Genius, production,
or training authorization follows from v4.

## KL-006: License boundary

The repository has no root software license. External corpora retain separate
upstream terms, and raw corpora are excluded. See
`RESEARCH-EVALUATION-NOTICE.md`.

## KL-007: v4 release-note timing

The immutable `versions\v4\RELEASE.md` was written before the subsequent
independent review concluded and therefore lists council approval as open.
The later binding result is Tool/Data `PASS`, research `NOT APPROVED`, and no
CNS Model/CGN/Genius claim authorized. The original release note is preserved
to retain its Merkle hash.

## KL-008: Historical manifests

`versions\v1`, `versions\v2`, and `versions\v3` are historical release
records. Do not regenerate their manifests against the current v4 source and
interpret a changed root as corruption; use the source snapshot associated
with each historical release. The current reproducibility gate is v4.
