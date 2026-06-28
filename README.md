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

This public repository is the official community-facing language repository for:

1. The ADG-Lang rule model.
2. Public AST examples.
3. The public reference compiler release.
4. Parser and compiler design notes.
5. Community verification and research tasks.

## Start Here

| Document | Purpose |
| --- | --- |
| `docs\ADG-Duali-Rules.md` | The single cleaned rule table that anchors the parser. |
| `docs\Academic-Reading-Key.md` | Color/evidence key for academic review of the rule table. |
| `docs\Mermaid-Rule-Maps.md` | Mermaid diagrams that apply the academic reading key visually. |
| `docs\Compiler-Components.md` | Components of the public reference compiler. |
| `docs\Project-Model.md` | File extensions and ADG application project layout. |
| `docs\Portability-and-Targets.md` | What "compiled" means across operating systems, native targets, and WebAssembly. |
| `docs\Release-Testing.md` | How to verify and test the public release. |
| `docs\Release-v0.1.0.md` | Release notes for the first public testable version. |
| `docs\Repository-Policy.md` | What public releases include and exclude. |
| `docs\Language-Overview.md` | Public overview of ADG-Lang as a programming-language interface. |
| `docs\Verification-Model.md` | How ADG moves from AST to verification and native-proof gates. |
| `docs\Community-Roadmap.md` | Open development tracks for contributors. |
| `examples\README.md` | Valid and invalid AST examples for investigation. |
| `CONTRIBUTING.md` | How to propose rules, examples, diagnostics, and implementations. |

## Public Reference Compiler

The public release includes a testable reference compiler:

```text
src\Adg.Compiler
```

Run:

```powershell
dotnet run --project src\Adg.Compiler -- --self-test
dotnet run --project src\Adg.Compiler -- test-matrix
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1
```

If LLVM `clang` is unavailable:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1 -SkipNative
```

## Application File Extension

Use `.adg.json` for current ADG-Lang applications. It is the stable v0.1.x executable typed AST format.

The `.adg` extension is reserved for a future human-readable source syntax.

Minimal app project:

```text
examples\apps\hello-adg
  adg.project.json
  src\main.adg.json
  scripts\verify.ps1
  scripts\build.ps1
  scripts\run.ps1
```

## Current Rule Layers

ADG-Lang separates historical attribution from modern compiler design:

1. **Textual core:** transmitted definitions such as `Ism`, `Fi'l`, and `Harf`.
2. **Attributed chapters:** Fa'il, Maf'ul, Idafa, case/operator chapters, and exclamation.
3. **Notation layer:** early dot/diacritic metadata.
4. **Operational inference:** parser-safe rules derived from the attributed core.
5. **Historical guardrails:** what must not be back-projected into Abu al-Aswad's work.

## Development Status

ADG-Lang Native Proof v0.1 passed the release verification audit:

```text
Total checks: 59
Passed: 59
Failed: 0
Result: PASS
```

The public repository is now prepared for community review of the rule table, examples, diagnostics, and future implementation tracks.
