# ADG-Lang Quranic Core v1

## Classification

This is an ordinary deterministic software Tool release. It is not a CNS
Model, CGN, or Genius and contains no neural weights, training pipeline,
Transformer, attention, or distillation component.

## Purpose

Quranic Core v1 establishes a lossless entry layer for sourced Quranic and
natural-Arabic causal rules:

- original Uthmani text and UTF-16 source spans remain unchanged;
- an analysis-only normalized form is produced separately;
- attached `ف`, `و`, and bounded `ب` candidates are segmented conservatively;
- فاء السببية enforces Nasb before a directed causal edge is emitted;
- فاء النتيجة, فاء الاستئناف, باء السببية, and باء الآلة have distinct outputs;
- invalid mood produces an undirected candidate, diagnostic `ADG-QC1001`, and
  a non-zero CLI exit code;
- the verifier records token, segment, marker, cause, and effect span integrity.

## Bounded evidence

The v1 fixture contains 16 sourced positive, negative, holdout, natural-Arabic,
invalid-mood, lexical-root, and clause-boundary cases. The current report is:

```text
Passed: 16/16
Corpus Merkle root: e2cc6276fac0067cb6ef4244f87703bfb8e8a947110ee9d1e319fc51e959be56
```

This result proves only the declared fixture and rule families. It does not
establish complete Quranic syntax, unrestricted Arabic parsing, semantic truth,
or production readiness.

## Runnable solution

Open `ADG-Lang.Native.slnx` in Visual Studio or run:

```powershell
dotnet restore ADG-Lang.Native.slnx
dotnet build ADG-Lang.Native.slnx -c Release
dotnet src\Adg.QuranicCore.Cli\bin\Release\net10.0\Adg.QuranicCore.Cli.dll verify-corpus tests\quranic-core-v1\causal-gold.json --report versions\v1\evidence\quranic-core-v1-report.json
```

Analyze one text:

```powershell
dotnet src\Adg.QuranicCore.Cli\bin\Release\net10.0\Adg.QuranicCore.Cli.dll analyze-text "لَا تُهْمِلْ فَتَنْدَمَ"
```

## Next bounded increment

The next version must add a morphological lattice rather than broadening the
seed lexicons blindly: passive voice, hidden and attached pronouns, nominal and
relative clauses, accepted alternative i'rab analyses, and wider holdout
coverage.
