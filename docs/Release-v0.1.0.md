# ADG-Lang v0.1.0 Release

ADG-Lang v0.1.0 is the first public, testable reference release.

## Included

- Public reference compiler in `src\Adg.Compiler`.
- Unified ADG-Duali rule table.
- Academic Reading Key and Mermaid rule maps.
- Valid and invalid AST examples.
- Verification model and diagnostics.
- Release verification script.

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
