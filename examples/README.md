# ADG-Lang Examples

The examples are AST fixtures for language investigation.

## Valid Examples

| File | Purpose |
| --- | --- |
| `valid\proof-10-words.adg.json` | Demonstrates a verified ten-word verbal/Idafa sequence. |
| `valid\causal-10-words.adg.json` | Demonstrates a verified connected causal sentence. |

## Application Projects

| Path | Purpose |
| --- | --- |
| `apps\hello-adg` | Minimal ADG-Lang application project with manifest, entrypoint, and scripts. |

## Invalid Examples

| File | Expected diagnostic |
| --- | --- |
| `invalid\invalid-fael-nasb.adg.json` | ADG1001 |
| `invalid\invalid-maful-raf.adg.json` | ADG1002 |
| `invalid\invalid-jarr-raf.adg.json` | ADG1003 |
| `invalid\invalid-condition-missing-answer.adg.json` | ADG1004 |
| `invalid\invalid-explanation-case-mismatch.adg.json` | ADG1005 |
| `invalid\invalid-question-missing-target.adg.json` | ADG1006 |
| `invalid\invalid-negation-no-target.adg.json` | ADG1007 |
