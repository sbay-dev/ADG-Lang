# Quranic Core CLI — v1

## Purpose

Expose deterministic text analysis and corpus verification as a small
replaceable command-line host.

## Runtime role

Tool.

## Public contract

```text
analyze-text "<text>"
analyze <input.txt>
verify-corpus <corpus.json> [--report <report.json>]
```

`analyze` and `analyze-text` return a non-zero exit code when diagnostics are
present.

## Dependencies

- `pipeline.pipe-quranic-text`
- `services.s0-quranic-causality`

## Replaceability

Another host may replace this CLI without changing the Quranic Core library.

## Files

- `src\Adg.QuranicCore.Cli\Program.cs`
- `src\Adg.QuranicCore.Cli\QuranicCorpusVerifier.cs`

## Tests / smoke checks

```powershell
dotnet src\Adg.QuranicCore.Cli\bin\Release\net10.0\Adg.QuranicCore.Cli.dll verify-corpus tests\quranic-core-v1\causal-gold.json
```

## Exclusions

No compiler replacement, model runtime, network dependency, or silent repair.

## Upgrade notes

Add stable machine-readable diagnostic severity and an adapter into the legacy
ADG AST only after the Quranic AST contracts are expanded.
