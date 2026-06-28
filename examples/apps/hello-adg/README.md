# hello-adg

`hello-adg` is a minimal ADG-Lang application project.

It demonstrates the current public source format:

```text
src\main.adg.json
```

The current stable extension for executable ADG source is `.adg.json` because ADG-Lang v0.1.x accepts typed JSON AST input. The `.adg` extension is reserved for a future human-readable surface syntax.

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
