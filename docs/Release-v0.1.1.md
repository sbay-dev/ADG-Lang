# ADG-Lang v0.1.1 Release

ADG-Lang v0.1.1 adds a minimal application project model to the public language repository.

## Highlights

- Establishes the Arabic-inflected `.adg` surface as the canonical way to author ADG-Lang programs (grammatical statements and `دالةٌ`/`استدعاءٌ` functions).
- Keeps `.adg.json` as the equivalent low-level typed AST that the compiler builds from `.adg` source.
- Adds `adg.project.json` as the project manifest.
- Adds `examples\apps\hello-adg`.
- Documents portability boundaries and target roadmap.
- Extends release verification to build the sample application project.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1
```

If LLVM `clang` is unavailable:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1 -SkipNative
```

## Application Example

```powershell
powershell -ExecutionPolicy Bypass -File examples\apps\hello-adg\scripts\verify.ps1
powershell -ExecutionPolicy Bypass -File examples\apps\hello-adg\scripts\build.ps1
powershell -ExecutionPolicy Bypass -File examples\apps\hello-adg\scripts\run.ps1
```
