namespace Adg.Compiler;

internal static class TypeContracts
{
    public static void RequireKind(Word word, TokenKind kind, string contract)
    {
        if (word.Kind != kind)
        {
            throw new AdgTypeException($"{contract} expected {kind}, but received {word}.");
        }
    }

    public static void RequireIsmCase(Word word, AdgCase marker, string contract)
    {
        if (word.Kind != TokenKind.Ism || word.Case != marker)
        {
            throw new AdgTypeException(DiagnosticFor(contract), $"{contract} expected Ism[{marker}], but received {word}.");
        }
    }

    public static bool NodeAcceptsCase(IAdgNode node, AdgCase marker) => node switch
    {
        Word { Kind: TokenKind.Ism } word => word.Case == marker,
        Word { Kind: TokenKind.Fil } word => word.Case == marker && marker == AdgCase.Jazm,
        IdafaPhrase phrase when marker == AdgCase.Jarr => phrase.Mudaf.Case == AdgCase.Jarr && phrase.MudafIlayh.Case == AdgCase.Jarr,
        _ => false
    };

    public static void RequireExplanationCaseAgreement(IAdgNode left, IAdgNode right, string connectorSurface)
    {
        if (!TryGetSingleIsm(left, out var leftIsm) || !TryGetSingleIsm(right, out var rightIsm))
        {
            return;
        }

        if (leftIsm.Case == AdgCase.None || rightIsm.Case == AdgCase.None || leftIsm.Case == rightIsm.Case)
        {
            return;
        }

        throw new AdgTypeException(DiagnosticCode.ExplanationCaseMismatch, $"ExplanatoryConnector \"{connectorSurface}\" requires case agreement. Expected {leftIsm.Case}, received {rightIsm.Case}. Left {leftIsm}; right {rightIsm}.");
    }

    public static string Describe(IAdgNode node) => node switch
    {
        Word word => word.ToString(),
        VerbalSentence => "VerbalSentence",
        IdafaPhrase phrase => $"IdafaPhrase({phrase.Mudaf}, {phrase.MudafIlayh})",
        HarfGovernance governance => $"HarfGovernance({governance.Operator.Surface})",
        ConnectedSentence connected => $"ConnectedSentence({connected.Connector.Surface})",
        OperatorApplication application => $"OperatorApplication({application.Operator.Surface})",
        Clause => "Clause",
        _ => node.GetType().Name
    };

    private static bool TryGetSingleIsm(IAdgNode node, out Word word)
    {
        if (node is Word { Kind: TokenKind.Ism } ism)
        {
            word = ism;
            return true;
        }

        word = null!;
        return false;
    }

    private static DiagnosticCode DiagnosticFor(string contract) => contract switch
    {
        "Fa'il" => DiagnosticCode.InvalidFaelCase,
        "Maf'ul" => DiagnosticCode.InvalidMafulCase,
        "MudafIlayh" => DiagnosticCode.InvalidJarrOperand,
        _ => DiagnosticCode.Unknown
    };
}

