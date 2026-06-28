# ADG-Lang v0.1.0 Release

ADG-Lang v0.1.0 is the first public, testable reference release.

## Included

- Public reference compiler in `src\Adg.Compiler`.
- Unified ADG-Duali rule table.
- Academic Reading Key and Mermaid rule maps.
- Valid and invalid AST examples.
- Verification model and diagnostics.
- Release verification script.
- Minimal application project model under `examples\apps\hello-adg`.

## Excluded

- IDE state.
- Build outputs.
- Generated native binaries.
- Local artifacts.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1
```

If LLVM `clang` is not available:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1 -SkipNative
```

## Minimal App

The release includes a minimal application project:

```text
examples\apps\hello-adg
```

It can be verified and built with:

```powershell
powershell -ExecutionPolicy Bypass -File examples\apps\hello-adg\scripts\verify.ps1
powershell -ExecutionPolicy Bypass -File examples\apps\hello-adg\scripts\build.ps1 -SkipNative
```

## Expected Result

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
