# ADG-Lang Project Model

ADG-Lang v0.1.x can be used to build small applications through typed AST source files and experimental executable-function sources.

## File Extensions

| Extension / file | Status | Purpose |
| --- | --- | --- |
| `.adg.json` | Stable in v0.1.x | Executable typed ADG AST source. This is the correct extension for current applications. |
| `.adg` | Experimental in v0.1.x | Human-readable executable-function syntax using the mandatory RTL header and Arabic keywords such as `دالةٌ` and `استدعاءٌ`. |
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

Yes. Stable applications are authored as typed ADG AST files (`.adg.json`). The compiler can verify the AST, emit LLVM IR, and optionally produce a native executable through LLVM clang.

For executable functions, `.adg` source is available as an experimental human-readable path. Function programs must start with `اتجاهُ النصِّ: RTL`, use canonical keyword i'rab, and pass the function type-checker before LLVM IR is emitted.
