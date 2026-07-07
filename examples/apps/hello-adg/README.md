# hello-adg

`hello-adg` is a minimal ADG-Lang application project.

It demonstrates the stable public typed-AST source format:

```text
src\main.adg.json
```

The app also includes an experimental executable-function demo:

```text
src\abu-al-aswad-wikipedia-intro.adg
```

That function prints a shaped Arabic introduction based on the Arabic Wikipedia lead for Abu al-Aswad al-Du'ali, with explicit CC BY-SA attribution.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

## Build LLVM IR

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -SkipNative
```

## Build Native and Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
powershell -ExecutionPolicy Bypass -File scripts\run.ps1
```

## Verify the Wikipedia Function Demo

```powershell
dotnet run --project ..\..\..\src\Adg.Compiler -- verify src\abu-al-aswad-wikipedia-intro.adg
dotnet run --project ..\..\..\src\Adg.Compiler -- compile src\abu-al-aswad-wikipedia-intro.adg --emit-llvm artifacts\abu-al-aswad-wikipedia-intro.ll --native artifacts\abu-al-aswad-wikipedia-intro.exe
.\artifacts\abu-al-aswad-wikipedia-intro.exe
```
