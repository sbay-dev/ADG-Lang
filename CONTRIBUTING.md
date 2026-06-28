# Contributing to ADG-Lang

ADG-Lang contributions should keep the project verifiable.

## Good Contributions

1. A rule-table improvement with evidence level and parser contract.
2. A valid AST example that demonstrates a rule.
3. An invalid AST example that proves a diagnostic.
4. A documentation clarification that separates historical attribution from modern compiler design.
5. A backend proposal that accepts only verified programs.

## Rule Proposal Checklist

For every proposed rule, include:

```text
Rule ID:
Layer:
Rule statement:
Historical basis:
Parser/compiler contract:
Positive example:
Negative example, if applicable:
```

## Guardrail

Do not attribute later detailed grammar to Abu al-Aswad unless the evidence level is clearly documented. Modern ADG compiler rules must be marked as operational inference or modern ADG design.
