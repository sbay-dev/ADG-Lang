# Independent Reproduction Guide

## Preconditions

- A clean clone of the exact commit under review.
- .NET SDK 10.x.
- PowerShell 7.x for release and disclosure scripts.
- No raw QAC or UD file inside the Git working tree.

Record `git rev-parse HEAD`, `dotnet --info`, operating system, and PowerShell
version before testing.

## Tier A: public package only

These checks require no external corpus:

```powershell
dotnet restore .\ADG-Lang.Native.slnx
dotnet build .\ADG-Lang.Native.slnx -c Release --no-restore --nologo

dotnet restore .\ADG-Lang.Quranic.slnx
dotnet build .\ADG-Lang.Quranic.slnx -c Release --no-restore --nologo

dotnet run --project .\src\Adg.QuranicCore.Cli\Adg.QuranicCore.Cli.csproj `
  -c Release --no-build -- verify-corpus `
  .\tests\quranic-core-v1\causal-gold.json

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj `
  -c Release --no-build -- self-test

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj `
  -c Release --no-build -- syntax-self-test

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj `
  -c Release --no-build -- syntax-property-test

dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj `
  -c Release --no-build -- quranic-score-policy

.\scripts\quranic-corpus\Write-QuranicGrammarV4Merkle.ps1
git diff --exit-code -- .\versions\v4\MERKLE-MANIFEST.json

.\scripts\quranic-corpus\Test-PublicResearchHandoff.ps1
git status --short
```

Expected release checks:

| Check | Expected |
| --- | --- |
| Both solution builds | 0 warnings; 0 errors |
| Causal corpus | 16 / 16 |
| Syntax property suite | 325 / 325 |
| Score policy | `adg-quranic-morphology-score-policy-v1`; 63 factors |
| v4 artifact count | 61 |
| v4 Merkle root | `5c4a24c81c9e5154f435c72f47e5dca7f8ebf60341b96105e5b3bec38b60c026` |
| Merkle manifest diff | Empty |
| Public disclosure audit | PASS |
| Tracked-tree diff after checks | Empty |

Generated `bin` and `obj` directories are ignored and are not evidence.

## Tier B: licensed external QAC inputs

Do not copy external inputs into the repository.

1. Acquire the official QAC morphology v0.4 file through the upstream
   email-gated download.
2. Register it into an external evaluation directory:

   ```powershell
   .\scripts\quranic-corpus\Register-QacMorphologyV04.ps1 `
     -SourceFile <official-download.txt> `
     -DestinationDirectory <directory-outside-this-repository>
   ```

   The helper rejects any destination inside the Git repository.
3. Check the official file against the audited mirror. A mismatch is a
   fail-closed provenance failure.
4. Acquire `syntax.txt` and compact `morphology.txt` from
   `kaisdukes/quranic-corpus-api` commit
   `17a9062416eccc332111ef3e84f74072d709e187`.
5. Verify:

| Resource | Expected SHA-256 |
| --- | --- |
| `syntax.txt` | `9a9037b23c2d8309838171af1b1d4d99528a4f07f8298e97a9d7fa04ce952491` |
| compact `morphology.txt` | `f1d3417be9aac22d54fff9ddc34db0818d7f490d836471a0d9163b3a2c11c065` |

The official morphology hash is deliberately not asserted until the official
download is obtained and compared. The previously audited local mirror hash
is recorded for comparison in the evidence register, not as proof of official
acquisition.

Run the full commands in the “Reproduce the evidence inventory” section of
`README.md` in this directory. Write reports outside the repository.

Expected source coverage:

- 128,219 morphology segments
- 77,429 words
- 6,236 verses
- 114 chapters
- 7,373 syntax graphs
- 70,967 syntax nodes
- 45,087 syntax edges
- 45 relation labels
- 6 phrase tags

## Tier C: evaluator interpretation

Compare generated results with `EVIDENCE-REGISTER.json` and
`versions\v4\evidence\quranic-grammar-v4-evidence.json`.

Do not treat a hash match as research approval. Confirm separately:

1. fail-closed state semantics;
2. all 64 deferred source edges remain visible;
3. every contract remains non-normative;
4. no external raw file entered Git history;
5. no generated report containing verse-level material was published;
6. claim wording follows `CLAIM-BOUNDARIES.md`; and
7. open gates remain open unless independently satisfied.

Complete `INDEPENDENT-REVIEW-CHECKLIST.md` and attach only sanitized results.
