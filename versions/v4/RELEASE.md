# ADG-Lang Quranic Parser v4

ADG-Lang v4 is an ordinary deterministic-software development release. It
completes the executable catalog for all 45 observed QAC dependency relations
and all six phrase families, audits each source edge and phrase, preserves
fail-closed parser behavior, and refreshes the separately versioned
non-normative corpus and knowledge-root Data artifacts.

## Verified release gates

| Gate | Result |
| --- | ---: |
| Release solution build | 0 warnings, 0 errors |
| Isolated clean-clone reproduction | Build, self-test, property replay, and release Merkle replay pass |
| Generated property and mutation tests | 325 / 325 |
| Executable dependency contracts | 45 / 45 |
| Executable phrase contracts | 6 / 6 |
| Lexeme allowlist audit | 19 fields; 352 entries; 0 unregistered |
| Quranic evidence-only lexeme effects | 179 entries; 4,101 exact source matches; 0 zero-match |
| Natural heuristic effects | 173 opt-in entries; 0 verified Quranic acceptances |
| Morphology score policy | v1; 63 justified factors; 2 stable tie-breakers |
| Source relation evidence accepted | 45,023 / 45,087 |
| Explicitly deferred source edges | 64 |
| Source phrase audit | 11,574 / 11,574 |
| Quran-wide structural states | 5,708 Valid; 528 Unverified; 0 Invalid |
| Quran-wide graph errors | 0 |
| Generated unverified edges | 187 |
| Functional diacritic states | 1,634 Valid; 4,602 Unverified; 0 Invalid |
| Functionally verified / invalid edges | 11,970 / 0 |
| Controlled diacritic mutations | 24 / 24 detected |
| Bounded round-trip accepted slice | 69 verses; 77 units |
| Exact restored / graph-equivalent units | 77 / 77 |
| Unsafe round-trip acceptances | 0 |
| Official comparable exact edge F1 | 0.904387039 |
| Official comparable phrase F1 | 0.661502220 |
| Contract set | 51 canonical records; root `2cf54347...971f5` |
| Research corpus | 184 records; 0 normative; root `da8eea61...df14` |
| Research leakage grouping | 51 groups; 0 leakage; root `c39aeda6...f14e` |
| Runtime API | Bound validation, constraint discovery, and fail-closed correction requests |
| Knowledge-root projection | 8,001 records; 1,235 roots; root `59fb1088...6dbf` |
| Knowledge vectors / normative records | 0 / 0 |

Candidate198 remains the frozen comparison oracle. Candidate205 is the v4
functional candidate. A generated edge that fails its relation contract is
retained only as `Unverified`, and only verified core relations can establish
structural acceptance. Source-treebank evidence is also classified per edge:
contract-compatible evidence is `Positive`; the 64 contradictory or
unsupported edges remain explicit `Unverified` evidence.
The runtime API also fails closed in `NormativeCns` mode because every current
contract remains non-normative. The split manifest reserves future deterministic
buckets but leaves all 184 records in the `research` split.
Constraint discovery can return the typed contract set for declared graph
claims without consulting corpus materialization. Correction requests preserve
the original graph and return no automatic directive because all current
contract correction policies are `None`.
All named parser lexeme collections are now machine-audited. Quranic entries
remain evidence-only and bind the source treebank root; natural-Arabic entries
are isolated behind explicit opt-in and cannot produce a verified Quranic
state. Morphology selection uses the versioned
`adg-quranic-morphology-score-policy-v1`; its weights, rationales, beam bound,
and stable score/signature ordering are Merkle-bound and non-normative.

## Reproduction

Open `ADG-Lang.Native.slnx` in Visual Studio or run:

```powershell
dotnet restore .\ADG-Lang.Native.slnx
dotnet build .\ADG-Lang.Native.slnx -c Release --no-restore --nologo
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- syntax-self-test
dotnet run --project .\src\Adg.QuranicCorpus.Cli\Adg.QuranicCorpus.Cli.csproj -c Release --no-build -- syntax-property-test
```

QAC and UD corpus files are licensed external inputs and are not redistributed.
Their pinned hashes, report hashes, metrics, and Merkle roots are recorded in
`evidence/quranic-grammar-v4-evidence.json`.

Regenerate the release manifest with:

```powershell
.\scripts\quranic-corpus\Write-QuranicGrammarV4Merkle.ps1
```

## Claim boundary

This release is a deterministic Tool plus separately derived Data. It is not a
CNS Model, Genius, or CGN release, contains no model weights, uses no
Transformer or distillation path, and is not approved for normative CNS
training. The projection hashes and shards are not neural embeddings.
Research approval, official QAC v0.4 hash comparison, leakage-safe normative
splits, approved correction policies, and Expert Council approval remain open
gates.
