# Current UD Arabic Evaluation Boundary

| Corpus | Current role |
| --- | --- |
| Arabic-PADT | External development benchmark; metrics influenced rule development. |
| Arabic-PUD | Previously consumed final holdout; unavailable as a new untouched holdout. |

The immutable v4 source file `src\Adg.QuranicGrammar\UdArabicPadt.cs` retains
the earlier `untouched-final-holdout` PUD label. That historical string is not
the current research classification. It is preserved only so the published v4
source hash and release Merkle root remain reproducible.

Any later natural-Arabic readiness evaluation must freeze a new rule set,
select a genuinely untouched holdout, record its provenance before evaluation,
and publish the result in a new release.
