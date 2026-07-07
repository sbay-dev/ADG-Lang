# ADG-Lang Examples

The examples show ADG-Lang programs for language investigation. Each grammatical example is
provided in the canonical Arabic-inflected `.adg` source form and, where noted, in the
equivalent low-level `.adg.json` typed AST that the compiler builds from it.

## Valid Examples

| File | Purpose |
| --- | --- |
| `valid\proof-10-words.adg` | Canonical Arabic source: a verified ten-word verbal/Idafa sequence. |
| `valid\causal-10-words.adg` | Canonical Arabic source: a verified connected causal sentence. |
| `valid\proof-10-words.adg.json` | Equivalent low-level typed AST for `proof-10-words.adg`. |
| `valid\causal-10-words.adg.json` | Equivalent low-level typed AST for `causal-10-words.adg`. |

Both forms of each example render the same Arabic text and emit the same LLVM IR.

## Application Projects

| Path | Purpose |
| --- | --- |
| `apps\hello-adg` | Minimal ADG-Lang application project with an Arabic-inflected `.adg` entrypoint, manifest, and scripts. |

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
