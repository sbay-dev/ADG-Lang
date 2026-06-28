# ADG-Lang Language Overview

ADG-Lang models Arabic grammar as typed structures rather than free text.

## Core Objects

```text
Token ::= Ism | Fi'l | Harf

Ism  -> Entity / Reference
Fi'l -> Event / Motion
Harf -> Operator / Connector
```

## Core Relations

```text
Fa'il  ::= Ism[Raf]
Maf'ul ::= Ism[Nasb]
Idafa  ::= Ism + Ism[Jarr]
```

## Native-Proof Direction

ADG-Lang treats grammatical correctness as a compile-time property:

```text
Raw ADG AST
  -> Parser
  -> Type System
  -> Contract Validator
  -> VerifiedAdgProgram
  -> Backend
```

The public repository documents the language interface, examples, and reference compiler. Implementation evolves through public proposals, tests, and release verification.
