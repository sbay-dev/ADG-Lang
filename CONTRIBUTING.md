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

## Quranic Research Reviews

Quranic parser reviews must begin with
`docs\research\quranic-core-v1\INDEPENDENT-RESEARCHER-HANDOFF.md` and use
`INDEPENDENT-REVIEW-CHECKLIST.md`. A review must preserve `Valid`,
`Invalid`, and `Unverified` as distinct states and must not convert complete
inventory coverage into a claim of complete or approved Quranic grammar.

Do not attach raw QAC or UD files, generated verse-level reports, private
review transcripts, local paths, credentials, or model/runtime identifiers to
issues or pull requests.
