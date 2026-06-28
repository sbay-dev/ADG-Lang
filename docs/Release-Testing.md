# Release Testing

The public release is testable with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1
```

If LLVM `clang` is unavailable, run verification and LLVM-only emission:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Verify-AdgRelease.ps1 -SkipNative
```

## Manual Commands

```powershell
dotnet run --project src\Adg.Compiler -- --self-test
dotnet run --project src\Adg.Compiler -- test-matrix
dotnet run --project src\Adg.Compiler -- verify examples\valid\proof-10-words.adg.json
dotnet run --project src\Adg.Compiler -- compile examples\valid\proof-10-words.adg.json --emit-llvm artifacts\proof-10-words.ll
```

## Expected Result

Valid examples must verify and emit LLVM IR. Invalid examples must fail verification with ADG diagnostics before backend output.
