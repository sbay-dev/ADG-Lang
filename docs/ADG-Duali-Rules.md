# ADG-Lang Duali Rule Table

This table is the public, cleaned rule map for ADG-Lang. It consolidates the rule material into one reviewable table and separates historical evidence from modern parser contracts.

## Evidence Levels

| Level | Meaning |
| --- | --- |
| Textual | A phrase or definition is transmitted in the source tradition. |
| Attributed chapter | A grammar chapter is attributed to Abu al-Aswad, without a full preserved technical treatise. |
| Notation | A rule belongs to the early dot/diacritic notation layer. |
| Operational inference | A compiler/parser rule directly derived from the textual or attributed layer. |
| Guardrail | A boundary that prevents over-attribution of later grammar. |

## Academic Reading Key

| Color | Evidence level | What it means | Common sources |
| --- | --- | --- | --- |
| Green | Textual | Transmitted wording or close wording, such as the speech partition, definitions of `Ism`/`Fi'l`/`Harf`, and the visible/hidden reference division. | shamela.ws, read.shamela.ws |
| Blue | Attributed chapter | Chapters attributed to Abu al-Aswad, such as Fa'il, Maf'ul, Idafa, Raf, Nasb, Jarr, and Jazm. | islamweb.net, shamela.ws |
| Orange | Notation | Dotting and diacritic notation: dot above for Fatha, in front for Damma, below for Kasra, and two dots for nasalization/Tanwin. | islamweb.net, dar-alifta.org |
| Purple | Operational inference | Useful computational-parser inferences derived from the core, but not direct transmitted wording from Abu al-Aswad. | Derived in ADG-Lang from the sourced core. |
| Gray | Guardrail | Limits of attribution: details that should not be assigned to Abu al-Aswad because the sources describe him as establishing early outlines later expanded by others. | islamweb.net |

For stricter research usage, each rule also carries a proof degree: `Transmitted text`, `Attributed chapter`, `Direct inference`, `Notation`, `Modern ADG`, or `Not attributed / guardrail`.

See `docs\Academic-Reading-Key.md` and `docs\Mermaid-Rule-Maps.md` for the visual Mermaid maps that make this color key inspectable.

## Unified Rule Table

| ID | Color | Layer | Proof degree | Rule | Historical basis | ADG parser/compiler contract |
| --- | --- | --- | --- | --- | --- | --- |
| ADG-R001 | Green | Textual | Transmitted text | Speech is partitioned into `Ism`, `Fi'l`, and `Harf`. | Transmitted formula: speech is name, action, and particle. | Every token must resolve to exactly one top-level token kind. |
| ADG-R002 | Green | Textual | Transmitted text | `Ism` denotes a named entity or reference. | Definition: the name indicates the named thing. | `Ism` maps to an entity/reference node and may receive Raf, Nasb, or Jarr. |
| ADG-R003 | Green | Textual | Transmitted text | `Fi'l` denotes motion, action, or event. | Definition: the action indicates motion of the named thing. | `Fi'l` opens an event frame and may receive Jazm where governed. |
| ADG-R004 | Green | Textual | Transmitted text | `Harf` denotes relational meaning, not a standalone entity/event. | Definition: the particle indicates a meaning that is neither name nor action. | `Harf` is an operator/connector token and must not receive noun/verb case as its own case. |
| ADG-R005 | Green | Textual | Transmitted text | References may be visible, hidden, or neither clearly visible nor hidden. | Transmitted visible/hidden/third-category distinction. | Parser may represent explicit, implicit, and latent references with declared certainty. |
| ADG-R006 | Purple | Operational inference | Direct inference | Verbal syntax centers on an event. | Derived from `Fi'l` plus the attributed Fa'il/Maf'ul chapters. | A verbal sentence has a verb and must resolve its agent relation when required. |
| ADG-R007 | Blue | Attributed chapter | Attributed chapter | `Fa'il` is the agent relation. | Chapter of Fa'il is attributed to Abu al-Aswad. | `Fa'il` accepts only `Ism[Raf]`; otherwise ADG1001. |
| ADG-R008 | Blue | Attributed chapter | Attributed chapter | `Maf'ul` is the patient/object relation. | Chapter of Maf'ul is attributed to Abu al-Aswad. | `Maf'ul` accepts only `Ism[Nasb]`; otherwise ADG1002. |
| ADG-R009 | Purple | Operational inference | Direct inference | Case distinguishes agent and patient roles. | Derived from Fa'il/Maf'ul plus Raf/Nasb chapters. | A case mismatch is a semantic dependency error, not a rendering preference. |
| ADG-R010 | Blue | Attributed chapter | Attributed chapter | `Idafa` links a noun to a completing/specifying noun. | Chapter of the added/possessed noun relation is attributed. | `IdafaPhrase` forms a noun-phrase dependency. |
| ADG-R011 | Purple | Operational inference | Direct inference | The dependent side of Idafa is governed as Jarr in the ADG model. | Direct operational form of the attributed Idafa chapter. | `MudafIlayh` must be `Ism[Jarr]`; otherwise ADG1003 when governed as Jarr. |
| ADG-R012 | Blue | Attributed chapter | Attributed chapter | Raf is a core case chapter. | Raf is listed among the early attributed case/operator chapters. | Raf marks prominence/agenthood/primary relation candidates. |
| ADG-R013 | Blue | Attributed chapter | Attributed chapter | Nasb is a core case chapter. | Nasb and its particles are listed in the source tradition. | Nasb marks objecthood/affectedness or governed noun state. |
| ADG-R014 | Blue | Attributed chapter | Attributed chapter | Jarr is a core case chapter. | Jarr is listed among the early attributed case/operator chapters. | Jarr marks prepositional, dependency, attachment, or Idafa relations. |
| ADG-R015 | Blue | Attributed chapter | Attributed chapter | Jazm is a core verbal constraint chapter. | Jazm is listed among the early attributed case/operator chapters. | Jazm applies to governed verbs where a Jazm operator is present. |
| ADG-R016 | Green / Blue | Textual / attributed | Transmitted text + attributed chapter | Nasb operators include `إن`, `أن`, `ليت`, `لعل`, `كأن`, and `لكن`. | The list is transmitted with review/completion of `لكن`. | These particles belong to the Nasb operator class and govern compatible operands. |
| ADG-R017 | Purple | Operational inference | Direct inference | Tool lists are reviewable and extensible when evidence supports membership. | `لكن` is added after review in the transmitted account. | Operator dictionaries may be extended only through documented evidence and tests. |
| ADG-R018 | Purple | Operational inference | Direct inference | A particle has an operand. | Derived from Harf as relational meaning plus case-governing chapters. | `HarfGovernance` requires an operator and a valid operand shape; invalid arity is ADG1008. |
| ADG-R019 | Blue | Attributed chapter | Attributed chapter | Exclamation is distinct from interrogation. | Exclamation is attributed through the `ما أحسن...` / `ما أشد...` reports. | Exclamative patterns are parsed by shape and case, not by raw text alone. |
| ADG-R020 | Orange | Notation | Notation | Diacritics are metadata over base text. | Early dot system marks pronunciation without replacing letters. | Diacritic metadata is stored as annotation, not as a new token category. |
| ADG-R021 | Orange | Notation | Notation | Fatha is represented by a dot above. | Instruction: when the mouth opens, place a dot above. | `Fatha -> dot_above`. |
| ADG-R022 | Orange | Notation | Notation | Damma is represented by a dot in front / before the letter. | Instruction: when the mouth rounds, place a dot before the letter. | `Damma -> dot_front`. |
| ADG-R023 | Orange | Notation | Notation | Kasra is represented by a dot below. | Instruction: when the sound is broken/lowered, place a dot below. | `Kasra -> dot_below`. |
| ADG-R024 | Orange | Notation | Notation | Tanwin/nunation duplicates the marker. | Instruction: if nasalization follows, use two dots. | `Tanwin -> duplicate marker`. |
| ADG-R025 | Orange | Notation | Notation | Sukun may be represented by absence of a dot in the first notation layer. | Later descriptions of the early dot method. | `No vowel -> no early dot marker`. |
| ADG-R026 | Purple | Operational inference | Direct inference | Pronunciation precedes annotation. | Dotting instructions depend on observing the reciter's mouth. | Speech/reading observation maps to annotation features. |
| ADG-R027 | Purple | Operational inference | Direct inference | High-risk text receives the first annotation layer. | Reports connect the method to protecting Quranic reading from lahn. | High-integrity corpora require stricter verification gates. |
| ADG-R028 | Purple | Operational inference | Direct inference | A case error can invert meaning. | Reports about wrong case readings motivate grammatical protection. | Wrong case creates wrong dependency and must fail verification when typed contracts are violated. |
| ADG-R029 | Purple | Operational inference | Direct inference | Grammar starts from seed rules and expands by tracking cases. | Reported instruction to follow up and add what appears. | ADG evolution uses versioned rules, examples, diagnostics, and review. |
| ADG-R030 | Purple | Operational inference | Direct inference | Proposed categories require review. | The Nasb list review shows correction by evidence. | Rule proposals must include source basis, parser contract, and tests. |
| ADG-R031 | Gray | Guardrail | Not attributed / guardrail | Abu al-Aswad's work is a foundational skeleton, not the full later grammar. | Reports describe early "drawn outlines" expanded by later grammarians. | ADG must mark modern compiler rules as operational inferences, not direct historical claims. |
| ADG-R032 | Gray | Guardrail | Not attributed / guardrail | Do not back-project later school grammar without evidence. | Later details belong to later grammarians unless independently supported. | Public rules must declare attribution level before entering the parser contract set. |
| ADG-R033 | Purple / Gray | Modern ADG | Modern ADG | LLVM/native output is downstream of grammar verification. | Modern native-proof design, not a historical claim. | `LlvmEmitter` must accept only `VerifiedAdgProgram`; invalid ASTs emit no LLVM IR. |

## Contribution Rule

Every new rule proposal should add or update one row with:

1. A stable rule ID.
2. The evidence level.
3. The grammar claim.
4. The parser/compiler contract.
5. At least one valid or invalid AST example.
