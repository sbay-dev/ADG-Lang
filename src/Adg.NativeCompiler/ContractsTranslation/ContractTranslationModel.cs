namespace Adg.NativeCompiler;

internal enum ContractClauseKind
{
    Obligation,
    Prohibition,
    TerminationRight,
    Payment
}

internal sealed record ContractClauseCandidate(
    ContractClauseKind Kind,
    string PrimaryParty,
    string Action,
    long Amount,
    string SecondaryParty,
    string DueText,
    string SourceText,
    IReadOnlyList<string> Evidence)
{
    public string Obligor => PrimaryParty;

    public string Obligation => Action;

    public long PenaltyAmount => Amount;
}

internal sealed record ContractTranslationDocument(IReadOnlyList<ContractClauseCandidate> Clauses);
