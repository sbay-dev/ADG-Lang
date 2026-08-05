# Quranic Arabic Corpus attribution

The optional morphology input consumed by ADG-Lang is sourced from the
[Quranic Arabic Corpus](https://corpus.quran.com), version 0.4, by Kais Dukes.
Its Quran text is based on the verified Uthmani text from
[Tanzil](https://tanzil.net).

The optional syntax input is the `syntax.txt` resource published in the
author-maintained
[`kaisdukes/quranic-corpus-api`](https://github.com/kaisdukes/quranic-corpus-api)
repository. ADG-Lang pins the source commit and verifies both the syntax and
matching compact-morphology SHA-256 values. The API repository does not declare
a repository license, so these raw files are local verification inputs and are
not redistributed by ADG-Lang.

ADG-Lang does not modify or redistribute either raw corpus by default. Any
distribution containing the v0.4 morphology file or a substantial derived
artifact must retain `LICENSE-DATA.txt`, identify both QAC and Tanzil, and link
to their update pages. Redistribution of the API repository resources requires
separate license confirmation from the upstream project.

The ADG importer is independently authored software. Imported annotations are
reference evidence and are not represented as independently authored ADG
grammar rules.
