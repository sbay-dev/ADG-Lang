# ADG-Lang Quranic Parser v3

ADG-Lang v3 is an ordinary deterministic-software development release. It
adds strict Quranic case/surface compatibility, fail-closed morphology
selection, functional diacritic validation, controlled mutation testing,
bounded additive diacritization, deterministic round-trip evaluation, and a
separately versioned non-normative grammar corpus.

## Verified release gates

| Gate | Result |
| --- | ---: |
| Release solution build | 0 warnings, 0 errors |
| Generated property and mutation tests | 177 / 177 |
| Quran-wide structural states | 5,863 Valid; 373 Unverified; 0 Invalid |
| Quran-wide graph errors | 0 |
| Quran-wide unverified edges | 13 |
| Functional diacritic states | 1,666 Valid; 4,570 Unverified; 0 Invalid |
| Functionally verified / invalid edges | 11,969 / 0 |
| Controlled diacritic mutations | 24 / 24 detected |
| Bounded round-trip accepted slice | 69 verses; 77 units |
| Exact restored / graph-equivalent units | 77 / 77 |
| Unsafe round-trip acceptances | 0 |
| Official comparable exact edge F1 | 0.904390756 |
| Official comparable phrase F1 | 0.651040506 |
| Contract set | 51 records; root `aca24b5d...2197` |
| Research corpus | 92 records; 0 normative; root `120e9526...1a9f` |
| Knowledge-root projection | 7,859 records; 1,235 roots; root `b0a1c571...ae49` |
| Knowledge vectors / normative records | 0 / 0 |

Candidate198 remains the frozen comparison oracle. Candidate200 is the current
strict functional candidate. Source/case contradictions emit `ADG-QC2004` and
make affected graph evidence unverified instead of allowing a convenient but
surface-incompatible analysis. Mutation evidence is accepted only when the
expected diagnostic belongs to the mutated relation and source range, and
functionally skipped edges cannot serve as mutation baselines.

## Reproduction

Open `ADG-Lang.Native.slnx` in Visual Studio or run:

```powershell
dotnet restore .\ADG-Lang.Native.slnx
dotnet build .\ADG-Lang.Native.slnx -c Release --no-restore
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- syntax-self-test
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- syntax-property-test
```

QAC and UD corpus files are licensed external inputs and are not redistributed.
Their pinned hashes, report hashes, metrics, and Merkle roots are recorded in
`evidence/quranic-grammar-v3-evidence.json`.

Regenerate the release manifest with:

```powershell
.\scripts\quranic-corpus\Write-QuranicGrammarV3Merkle.ps1
```

## Claim boundary

This release is a deterministic Tool plus separately derived Data. It is not a
CNS Model, Genius, or CGN release, contains no model weights, uses no
Transformer or distillation path, and is not approved for normative CNS
training. Its projection hashes and shards prepare later indexing but are not
neural embeddings. Natural-Arabic readiness, full Quranic grammar coverage, official QAC
v0.4 hash comparison, leakage-safe splits, and Expert Council approval remain
open gates.
