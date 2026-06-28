# Portability and Targets

ADG-Lang is compiled, but a compiled language does not automatically produce one binary that runs in every environment.

## Precise Rule

```text
Portable source
  => per-target compilation
  => target-specific executable
```

The portable layer is the ADG source and verified program model:

```text
.adg.json
  -> VerifiedAdgProgram
  -> backend target
```

The native executable is target-specific:

```text
Windows x64 executable != Linux x64 executable != macOS arm64 executable != WebAssembly module
```

## Current v0.1.x Target

The public compiler supports:

1. Host verification.
2. LLVM IR emission.
3. Host-native executable generation through local LLVM `clang`.

This means it can compile and run on a machine that has .NET and LLVM clang available.

## Cross-Environment Stack Roadmap

To work across many environments, ADG-Lang should add target profiles:

| Target profile | Purpose |
| --- | --- |
| `native-win-x64` | Windows desktop/server executable. |
| `native-linux-x64` | Linux desktop/server executable. |
| `native-osx-arm64` | Apple Silicon executable. |
| `wasm32-wasi` | WASI-compatible WebAssembly module. |
| `wasm32-browser` | Browser-facing WebAssembly backend with JS host bindings. |
| `llvm-ir` | Portable intermediate artifact for downstream toolchains. |

## Important Boundary

ADG-Lang can be designed to target many environments, but it should not claim that one native binary works everywhere. Browser execution requires a WebAssembly backend, not a normal native executable.
