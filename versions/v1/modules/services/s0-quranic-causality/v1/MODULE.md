# Quranic Causality Service — v1

## Purpose

Produce bounded, directed, source-backed causal markers without allowing an
invalid grammatical precondition to become a causal edge.

## Runtime role

Deterministic service.

## Public contract

- `QuranicCausalityAnalyzer.Analyze`
- `QuranicAnalysis`
- `QuranicCausalMarker`
- `QuranicDiagnostic`

Supported v1 marker families are `FaSababiyya`, `FaConsequence`,
`FaResumption`, `BaSababiyya`, `BaInstrument`, and fail-closed candidates.

## Dependencies

- `pipeline.pipe-quranic-text`

## Replaceability

Rule internals may be replaced if direction, mood, diagnostics, evidence rule
IDs, and source ranges remain explicit and deterministic.

## Files

- `src\Adg.QuranicCore\QuranicCausalityAnalyzer.cs`
- `src\Adg.QuranicCore\Models.cs`

## Tests / smoke checks

The corpus gate verifies positive and negative marker distinctions, Nasb,
fail-closed invalid mood, lexical-root controls, and clause-bounded spans.

## Exclusions

No world-causality claim, neural ranking, CNS integration, or generated Quranic
text.

## Upgrade notes

Add typed alternative analyses for accepted i'rab differences and bind causal
edges to a fuller clause AST rather than expanding heuristic windows.
