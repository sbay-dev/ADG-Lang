# ADG-Lang v0.1.1 Release

ADG-Lang v0.1.1 adds a minimal application project model to the public language repository.

## Highlights

- Defines `.adg.json` as the current stable executable ADG source extension.
- Reserves `.adg` for future human-readable syntax.
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
