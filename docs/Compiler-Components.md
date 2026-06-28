# ADG-Lang Compiler Components

The public release includes a clean reference compiler in:

```text
src\Adg.Compiler
```

This is the public release implementation. It excludes IDE files, build intermediates, generated binaries, and local machine state.

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| CLI | `src\Adg.Compiler\Cli` | Provides `verify`, `compile`, `test-matrix`, and `--self-test`. |
| Parser | `src\Adg.Compiler\Parser` | Reads ADG JSON AST and builds typed nodes. |
| Type System | `src\Adg.Compiler\TypeSystem` | Defines `Ism`, `Fi'l`, `Harf`, cases, connectors, sentences, and phrases. |
| Contracts | `src\Adg.Compiler\Contracts` | Enforces grammar contracts and produces `VerifiedAdgProgram`. |
| Diagnostics | `src\Adg.Compiler\Diagnostics` | Provides stable ADG diagnostic codes. |
| LLVM Backend | `src\Adg.Compiler\LlvmEmitter` | Emits LLVM IR only from verified programs and optionally links via clang. |
| Tests | `src\Adg.Compiler\Tests` | Contains self-tests and valid/invalid compilation matrix checks. |

## Backend Gate

The backend accepts only:

```text
VerifiedAdgProgram
```

It must not accept raw AST input. This is the central Native Proof rule.
