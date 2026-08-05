# ADG-Lang Quranic Parser v2

ADG-Lang v2 is an ordinary deterministic-software development release for the Quranic morphology and syntax parser. It binds the Quranic text pipeline, QAC morphology importer, deterministic grammar parser, evaluation CLI, and release-manifest tooling at the same `v2` module version.

## Verified release gates

| Gate | Result |
| --- | ---: |
| Release solution build | 0 warnings, 0 errors |
| Generated property and mutation tests | 160 / 160 |
| Quran-wide verses | 6,236 |
| Quran-wide invalid verses | 0 |
| Quran-wide graph errors | 0 |
| Official comparable exact edge F1 | 0.904897904 |
| Official comparable unlabeled edge F1 | 0.909133298 |
| Official comparable phrase F1 | 0.651096452 |
| Conditional phrase precision / recall / F1 | 1.000000000 / 0.229508197 / 0.373333333 |
| Nominal phrase precision / recall / F1 | 0.600393701 / 0.259574468 / 0.362448010 |
| PADT development POS accuracy | 0.745579113 |
| PADT development mapped dependency F1 | 0.408917501 |

The Quran-wide run contains 5,872 `Valid` and 364 `Unverified` verses. `Unverified` is an explicit evidence boundary, not a correctness claim. The generated suite now includes positive and near-miss controls for scoped pronoun, conjoined lexical, comparative interrogative, inverted peace, direct woe, temporal demonstrative, chained relative-complement, divine-subject, clitic-pronoun, guarded universal, and night-of-decree predicates.

## Reproduction

Open `ADG-Lang.Native.slnx` in Visual Studio or build from a developer shell:

```powershell
dotnet restore .\ADG-Lang.Native.slnx
dotnet build .\ADG-Lang.Native.slnx -c Release --no-restore
```

The evaluation CLI is:

```powershell
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release -- <command>
```

QAC and UD corpus files are external licensed inputs and are not redistributed by this release. Their pinned commits, input hashes, report hashes, metrics, and Merkle roots are recorded in `evidence/quranic-grammar-v2-evidence.json`.

Regenerate the release manifest with:

```powershell
.\scripts\quranic-corpus\Write-QuranicGrammarV2Merkle.ps1
```

## Claim boundary

This release is not a CNS Model, Genius, or CGN release. It uses no Transformer or distillation path. It establishes a deterministic Quranic development baseline, but it is not ready for unrestricted natural-Arabic correctness claims: PADT remains development data, Arabic-PUD was not rerun, conditional coverage is deliberately bounded, and broader sentence spans require further work.
