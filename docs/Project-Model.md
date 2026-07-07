# ADG-Lang Project Model

ADG-Lang v0.1.x can be used to build small applications. The canonical source surface is
Arabic-inflected `.adg` (grammatical statements and executable functions). Every program is
lowered to an equivalent typed AST that can also be written or inspected as `.adg.json`.

## File Extensions

| Extension / file | Status | Purpose |
| --- | --- | --- |
| `.adg` | Canonical in v0.1.x | Arabic-inflected source with the mandatory RTL header and i'rab-typed keywords (grammatical statements such as `جملةٌ فعليةٌ ... مرفوعٌ ... منصوبٌ`, and executable functions such as `دالةٌ` / `استدعاءٌ`). This is the language you author. |
| `.adg.json` | Supported low-level form | Equivalent typed ADG AST that the compiler builds from `.adg` source. Useful for tooling that emits or inspects the AST directly; not intended for hand-authoring. |
| `adg.project.json` | Stable project manifest | Declares project name, language version, source kind, entrypoint, and output name. |
| `.ll` | Generated artifact | LLVM IR emitted by the compiler. Do not commit as application source unless documenting a proof. |
| `.exe` / native binary | Generated artifact | Host-native output for a specific OS/architecture. Do not commit. |

## Minimal Project

```text
my-adg-app
  adg.project.json
  src
    main.adg
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
src\main.adg
  -> Surface Parser (Arabic i'rab-typed source)
  -> Type System
  -> Contract Validator
  -> VerifiedAdgProgram
  -> LLVM IR
  -> native executable
```

## Can I build an app with ADG-Lang?

Yes. Applications are authored as Arabic-inflected `.adg` source. The compiler parses the
Arabic grammatical statements, enforces the i'rab contracts (e.g. `فاعل` must be `مرفوع`,
`مفعول` must be `منصوب`), emits LLVM IR, and optionally produces a native executable through
LLVM clang. Every `.adg` program must start with `اتجاهُ النصِّ: RTL` and use canonical
keyword i'rab; it must pass verification before any LLVM IR is emitted. The equivalent
`.adg.json` typed AST is also accepted for AST-level tooling.
