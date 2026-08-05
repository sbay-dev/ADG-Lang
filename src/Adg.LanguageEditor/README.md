# ADG Language Editor IDE App

Open the repository solution:

```text
ADG-Lang.Native.slnx
```

Then set `Adg.LanguageEditor` as the startup project.

## IDE Profiles

The project includes `Properties\launchSettings.json` with profiles:

- `Trace correction`
- `Correct sentence`
- `Explain interpretation`
- `Rewrite unvoweled`

## Useful Breakpoints

Set breakpoints in:

| File | Method | What to inspect |
| --- | --- | --- |
| `GrammarRefinementEngine.cs` | `Trace` | Full pipeline stages. |
| `GrammarRefinementEngine.cs` | `BuildAnalysis` | Normalization, tokenization, diagnostics. |
| `SuggestionEngine.cs` | `Generate` | Repair candidates and ADG re-verification. |
| `RewriteValidator.cs` | `Verify` | Candidate-to-ADG verification gate. |
| `AdgVerifierClient.cs` | `VerifyFile` | Calls into `Adg.NativeCompiler`. |

## CLI Trace

```powershell
dotnet run --project src\Adg.LanguageEditor -- trace --text "كتبَ الطالبَ الدرسُ"
```

The trace output is JSON and contains every stage from raw input to final approved correction.
