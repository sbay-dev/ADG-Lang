# Quranic Core ADG Integration Map

The final Quranic parser extends the existing ADG functional pipeline. It does
not replace it with the QAC graph oracle.

## Existing executable path

```text
TextNormalizer
  -> Tokenizer
  -> CaseDetector
  -> GrammarRefinementEngine
  -> GrammarDiagnostic
  -> SuggestionEngine
  -> RewriteValidator
  -> SemanticConservationGate
  -> verified correction
```

The native compiler remains the downstream type and execution gate:

```text
ADG surface or JSON
  -> parser
  -> typed ADG nodes
  -> AdgVerifier
  -> VerifiedAdgProgram
  -> optional function / LLVM emission
```

## Integration seam

Add Quranic knowledge at the diagnostic layer:

```text
surface-preserving Quranic token
  + normalized skeleton
  + QAC-derived morphology candidate
  + approved Quranic rule contracts
  -> QuranicRuleEngine
  -> GrammarDiagnostic
```

This preserves the current suggestion, semantic-conservation, and rewrite
verification gates.

## Required implementation order

1. Add an exact observed-surface field and an analysis-skeleton field.
2. Add a shared typed Quranic rule-contract model.
3. Add a `QuranicRuleEngine` that emits normal ADG diagnostics.
4. Extend correction to internal and final diacritic operations.
5. Extend `RewriteValidator` with typed Quranic structures.
6. Re-analyze every accepted correction.
7. Expose approved contracts through the CNS runtime interface.

## Initial vertical slice

| Quranic relation | ADG role | Expected feature |
| --- | --- | --- |
| `subj` | `Fa'il` | dependent is nominal and Raf/NOM |
| `obj` | `Maf'ul` | dependent is nominal and Nasb/ACC |
| `gen` | prepositional Jarr | dependent is Jarr/GEN and head is a preposition |
| `poss` | Idafa dependent | dependent is Jarr/GEN |

The slice must use dependency evidence, not fixed token positions.

## Existing risks to remove

- Quranic normalization currently discards marks needed for validation.
- The LanguageEditor recognizes only final case marks.
- Some diagnostics assume fixed token positions.
- The current rewrite bridge has bounded sentence templates.
- No canonical Quranic diacritization and graph-equivalence gate exists.

These are tracked as open Kanban cards and block research approval.
