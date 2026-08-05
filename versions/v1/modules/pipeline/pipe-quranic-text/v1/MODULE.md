# Quranic Text Pipeline — v1

## Purpose

Preserve original Quranic/Arabic text while producing deterministic token,
normalization, clitic-candidate, and source-span records.

## Runtime role

Pipeline.

## Public contract

- `QuranicTextNormalizer.NormalizeForAnalysis`
- `QuranicTokenizer.Tokenize`
- `QuranicToken`, `QuranicSegment`, and `SourceRange`

Original surfaces are never replaced by normalized values.

## Dependencies

Only the .NET 10 base class library.

## Replaceability

The tokenizer may be replaced by a fuller morphological lattice if the public
token/segment/span contracts and lossless source mapping remain compatible.

## Files

- `src\Adg.QuranicCore\QuranicTextNormalizer.cs`
- `src\Adg.QuranicCore\QuranicTokenizer.cs`
- `src\Adg.QuranicCore\Models.cs`

## Tests / smoke checks

```powershell
dotnet build ADG-Lang.Native.slnx -c Release
dotnet src\Adg.QuranicCore.Cli\bin\Release\net10.0\Adg.QuranicCore.Cli.dll verify-corpus tests\quranic-core-v1\causal-gold.json
```

## Exclusions

No generated binaries, caches, model weights, or copied Quran corpora.

## Upgrade notes

Replace bounded clitic seeds with a cited morphological lattice and preserve
multiple valid segmentations when deterministic selection is not justified.
