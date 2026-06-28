# ADG-Lang Community Roadmap

## Track 1: Rule Review

- Review `docs\ADG-Duali-Rules.md`.
- Improve attribution labels.
- Add missing evidence notes.
- Split historical claims from modern compiler rules.

## Track 2: AST Corpus

- Add valid AST examples for each rule.
- Add invalid AST examples for each diagnostic.
- Keep every example small and inspectable.

## Track 3: Parser Specification

- Define a public ADG AST schema.
- Define stable diagnostics.
- Define test fixtures for community implementations.

## Track 4: Backends

- Specify backend-neutral verified program semantics.
- Keep backend output downstream of verification.
- Do not allow raw AST emission paths.

## Track 5: Reference Implementation

- Keep public code aligned with the rule table and examples.
- Expand the reference compiler only through documented rules, diagnostics, and tests.
