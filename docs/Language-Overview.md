# ADG-Lang Language Overview

ADG-Lang models Arabic grammar as typed structures rather than free text. Programs are
authored in Arabic-inflected `.adg` source, where each word carries its i'rab (case) and the
compiler enforces the grammatical contracts before code generation.

## Canonical Surface (.adg)

```adg
اتجاهُ النصِّ: RTL
adg 0.1.1
program "proof"

جملةٌ فعليةٌ "كتبَ" فاعلُها "الطالبُ" مرفوعٌ مفعولُها "الدرسَ" منصوبٌ
رابطٌ "ثم" ترتيبٌ
جملةٌ فعليةٌ "قرأَ" فاعلُها "المعلمُ" مرفوعٌ مفعولُها "الكتابَ" منصوبٌ
جارٌّ ومجرورٌ "في" إضافةٌ "بيتِ" مجرورٌ "العلمِ" مجرورٌ
```

Renders: `كتبَ الطالبُ الدرسَ ثم قرأَ المعلمُ الكتابَ في بيتِ العلمِ`.

Keyword i'rab is part of the contract: `فاعلُها` takes `مرفوعٌ`, `مفعولُها` takes `منصوبٌ`,
and the members of an `إضافةٌ` take `مجرورٌ`. A subject marked `منصوب` (or an object marked
`مرفوع`) is rejected as a compile-time diagnostic.

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
Arabic .adg source
  -> Surface Parser
  -> Type System
  -> Contract Validator
  -> VerifiedAdgProgram
  -> Backend
```

The public repository documents the language interface, examples, and reference compiler. Implementation evolves through public proposals, tests, and release verification.
