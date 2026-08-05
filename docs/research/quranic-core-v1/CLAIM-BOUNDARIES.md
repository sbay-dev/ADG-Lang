# Quranic Parser Claim Boundaries

Use this matrix when writing papers, issues, releases, presentations, or model
documentation.

| Claim | Status | Required wording |
| --- | --- | --- |
| All QAC-observed dependency and phrase families were inventoried | Supported | “45/45 observed dependency labels and 6/6 observed phrase tags were inventoried.” |
| All observed families have executable contracts | Supported with boundary | “Every observed family has a deterministic non-normative contract.” |
| v4 is reproducible ordinary software | Supported | Cite the 61-artifact root and clean-clone build/test replay. |
| The parser detects wrong diacritics | Supported only in bounded scope | Cite 24/24 controlled mutations and the 1,634 Valid / 4,602 Unverified functional states. |
| The parser covers the entire Quran perfectly | Prohibited | Zero `Invalid` does not include 528 structural and 4,602 functional `Unverified` states. |
| The extracted catalog is the complete grammar of the Quran | Prohibited | Inventory completeness is not scholarly or ontological completeness. |
| QAC annotations are independently proven ADG rules | Prohibited | They are external evidence/oracle annotations until independently sourced and approved. |
| The 184 records form an approved CNS training corpus | Prohibited | All records and contracts are non-normative; normative split and license gates remain open. |
| Knowledge roots are embeddings | Prohibited | They are deterministic projection/index records; neural vector count is zero. |
| v4 is a CNS Model, Genius, or CGN | Prohibited | The release contains no trained model and authorizes no such claim. |
| Natural-Arabic readiness is established | Prohibited | PADT was development data and PUD is no longer an untouched holdout. The current boundary overrides the frozen historical role string in v4 source metadata. |
| Research approval was granted | Prohibited | The binding verdict is `NOT APPROVED`. |
| Independent review approved the Tool/Data release | Supported with boundary | The vote passed the ordinary Tool/Data release while explicitly withholding research and CNS approval. |

## Mandatory terminology

- Use `Valid`, `Invalid`, and `Unverified` exactly as separate states.
- Use “observed QAC inventory” rather than “all Quranic grammar.”
- Use “non-normative research corpus” rather than “training corpus” unless the
  normative gates pass.
- Use “deterministic projection/index” rather than “embedding.”
- Use “ordinary deterministic Tool/Data release” rather than “CNS release.”

Any stronger wording requires a new version, new evidence, and approval through
the gates in `APPROVAL-GATES.md`.
