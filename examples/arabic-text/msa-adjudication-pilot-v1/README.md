# MSA adjudication pilot v1

This authored nine-sentence fixture evaluates the annotation/adjudication
workflow before inviting human Arabic linguists.

- It is developer-visible and synthetic.
- It is not derived from PADT or Arabic-PUD.
- It contains no parser predictions.
- It covers ten supported traditional i'rab categories.
- Annotation B intentionally introduces bounded disagreements.
- The adjudication file resolves every disagreement with a written reason.

Because all reviewer identities are synthetic and the packet is pilot-only,
the resulting report must set `eligibleForFinalReadinessEvidence` to `false`.

Run:

```powershell
dotnet run --project src\Adg.LanguageEditor -c Release -- `
  evaluate-msa-adjudication `
  --packet examples\arabic-text\msa-adjudication-pilot-v1\packet.json `
  --annotation-a examples\arabic-text\msa-adjudication-pilot-v1\annotation-a.synthetic.json `
  --annotation-b examples\arabic-text\msa-adjudication-pilot-v1\annotation-b.synthetic.json `
  --adjudication examples\arabic-text\msa-adjudication-pilot-v1\adjudication.synthetic.json `
  --report build\msa-adjudication-pilot-v1\evaluation.json `
  --human-report build\msa-adjudication-pilot-v1\human-adjudication.json `
  --conllu build\msa-adjudication-pilot-v1\adjudicated-gold.conllu
```
