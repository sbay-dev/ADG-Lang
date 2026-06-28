# ADG-Lang Project Model

ADG-Lang v0.1.x can be used to build small applications through typed AST source files.

## File Extensions

| Extension / file | Status | Purpose |
| --- | --- | --- |
| `.adg.json` | Stable in v0.1.x | Executable typed ADG AST source. This is the correct extension for current applications. |
| `.adg` | Reserved | Future human-readable surface syntax. Not implemented in v0.1.x. |
| `adg.project.json` | Stable project manifest | Declares project name, language version, source kind, entrypoint, and output name. |
| `.ll` | Generated artifact | LLVM IR emitted by the compiler. Do not commit as application source unless documenting a proof. |
| `.exe` / native binary | Generated artifact | Host-native output for a specific OS/architecture. Do not commit. |

## Minimal Project

```text
my-adg-app
  adg.project.json
  src
    main.adg.json
  scripts
    verify.ps1
    build.ps1
    run.ps1
```

See:

```text
examples\apps\hello-adg
```

## Current Compile Flow

```text
src\main.adg.json
  -> Parser
  -> Type System
  -> Contract Validator
  -> VerifiedAdgProgram
  -> LLVM IR
  -> native executable
```

## Can I build an app with ADG-Lang?

Yes, with the current v0.1.x constraint: applications are authored as typed ADG AST files (`.adg.json`). The compiler can verify the AST, emit LLVM IR, and optionally produce a native executable through LLVM clang.

The next language step is a human-readable `.adg` syntax that compiles to the same typed AST model.
