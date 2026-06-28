# ADG-Lang

ADG-Lang is a type-safe Arabic grammatical language inspired by the early grammar core attributed to Abu al-Aswad al-Du'ali.

The project goal is to make Arabic grammatical logic inspectable, testable, and eventually executable:

```text
Arabic grammatical rule
  => typed ADG AST
  => grammatical contract
  => verifier
  => compiler/backend
```

## Native Proof Principle

```text
Valid ADG AST
  => VerifiedAdgProgram
  => LLVM IR
  => Native Executable

Invalid ADG AST
  => ADG Diagnostic
  => No LLVM IR
  => No Native Executable
```

## Repository Purpose

This public repository is the community-facing home for:

1. The ADG-Lang rule model.
2. Public AST examples.
3. Parser and compiler design notes.
4. Community verification and research tasks.

Active native-proof implementation work is maintained separately in the private development repository:

```text
sbay-dev/ADG-Lang-dev
```

## Start Here

| Document | Purpose |
| --- | --- |
| `docs\ADG-Duali-Rules.md` | The single cleaned rule table that anchors the parser. |
| `docs\Academic-Reading-Key.md` | Color/evidence key for academic review of the rule table. |
| `docs\Language-Overview.md` | Public overview of ADG-Lang as a programming-language interface. |
| `docs\Verification-Model.md` | How ADG moves from AST to verification and native-proof gates. |
| `docs\Community-Roadmap.md` | Open development tracks for contributors. |
| `examples\README.md` | Valid and invalid AST examples for investigation. |
| `CONTRIBUTING.md` | How to propose rules, examples, diagnostics, and implementations. |

## Current Rule Layers

ADG-Lang separates historical attribution from modern compiler design:

1. **Textual core:** transmitted definitions such as `Ism`, `Fi'l`, and `Harf`.
2. **Attributed chapters:** Fa'il, Maf'ul, Idafa, case/operator chapters, and exclamation.
3. **Notation layer:** early dot/diacritic metadata.
4. **Operational inference:** parser-safe rules derived from the attributed core.
5. **Historical guardrails:** what must not be back-projected into Abu al-Aswad's work.

## Development Status

ADG-Lang Native Proof v0.1 passed its private engineering audit:

```text
Total checks: 59
Passed: 59
Failed: 0
Result: PASS
```

The public repository is now prepared for community review of the rule table, examples, diagnostics, and future implementation tracks.
