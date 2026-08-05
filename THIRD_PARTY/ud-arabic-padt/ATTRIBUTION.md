# UD Arabic-PADT verification input

ADG-Lang can evaluate deterministic Arabic parsing against two separately
licensed Universal Dependencies Arabic corpora.

## Arabic-PADT development benchmark

- Repository: <https://github.com/UniversalDependencies/UD_Arabic-PADT>
- Pinned commit: `dfb6b4c547f1fe10f1857b39e44de3f86c47a2fe`
- Test resource: `ar_padt-ud-test.conllu`
- Test SHA-256:
  `793c87bf173d491af2092ef7f87b04a2cf6c596490e7347a2065058a053a6389`
- License: CC BY-NC-SA 3.0

PADT metrics were inspected while deterministic natural-Arabic rules were
being improved. It is therefore classified as an external development
benchmark, not as the untouched final holdout.

## Arabic-PUD previously consumed final holdout

- Repository: <https://github.com/UniversalDependencies/UD_Arabic-PUD>
- Pinned commit: `b5dbaa1fe386ae38d9b3c5f1de1b047d3cb31e0f`
- Test resource: `ar_pud-ud-test.conllu`
- Test SHA-256:
  `befc6dd18b5b8803644ae8208e2e5f52c0957a36437627c05110914ec42281a3`
- License: CC BY-SA 3.0

PUD was consumed as the independent final holdout for the historical
evaluation. It is no longer untouched and cannot be reused to support a new
natural-Arabic readiness claim. A new frozen rule set requires a new untouched
holdout.

The v4 source descriptor retains the earlier `untouched-final-holdout` role
string because that file is bound into the immutable v4 Merkle root. The
binding current classification is `previously-consumed-final-holdout`; see
`CURRENT-EVALUATION-BOUNDARY.md`.

Both corpora are optional external verification inputs and are not bundled in
this repository. Keep downloaded CoNLL-U data outside distributable ADG-Lang
artifacts unless each corpus license and attribution requirement is carried
with the distribution.

UD tokenization and dependency labels are not silently equated with Quranic
Arabic Corpus morphology or traditional Arabic i'rab relations. The external
evaluator currently reports parser safety, lexical coverage, and only the
explicit relation pairs documented in its machine-readable output.
