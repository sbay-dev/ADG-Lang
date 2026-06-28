# ADG-Lang Verification Model

The verification model is intentionally gate-based.

## Positive Path

```text
Valid AST
  -> parse
  -> resolve token kinds
  -> enforce I'rab contracts
  -> resolve relations/operators
  -> VerifiedAdgProgram
```

## Negative Path

```text
Invalid AST
  -> diagnostic
  -> no VerifiedAdgProgram
  -> no backend output
```

## Diagnostic Family

| Code | Meaning |
| --- | --- |
| ADG1001 | Invalid Fa'il case. |
| ADG1002 | Invalid Maf'ul case. |
| ADG1003 | Invalid Jarr operand. |
| ADG1004 | Missing conditional consequence. |
| ADG1005 | Explanation case mismatch. |
| ADG1006 | Missing interrogative target. |
| ADG1007 | Missing negation target. |
| ADG1008 | Invalid operator arity. |
| ADG1009 | Unresolved hidden reference. |
| ADG1010 | Invalid semantic frame. |
