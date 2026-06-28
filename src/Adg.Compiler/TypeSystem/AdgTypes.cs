namespace Adg.Compiler;

internal interface IAdgNode
{
    NodeShape Shapes { get; }

    IReadOnlyList<Word> RenderWords();
}

[Flags]
internal enum NodeShape
{
    None = 0,
    Token = 1,
    Phrase = 2,
    Sentence = 4,
    Clause = 8,
    Event = 16,
    Object = 32
}

internal enum TokenKind
{
    Ism,
    Fil,
    Harf
}

internal enum AdgCase
{
    None,
    Raf,
    Nasb,
    Jarr,
    Jazm,
    Tanwin
}

internal enum HarfRole
{
    None,
    NasbOperator,
    JarrOperator,
    JazmOperator,
    RafOperator,
    SequenceConnector,
    CoordinationConnector,
    ImmediateConnector,
    ContrastConnector,
    CausalConnector,
    ConditionalConnector,
    ExplanatoryConnector,
    NegationOperator,
    InterrogativeOperator
}

internal static class HarfRoleExtensions
{
    public static bool IsCaseOperator(this HarfRole role) => role is
        HarfRole.NasbOperator or
        HarfRole.JarrOperator or
        HarfRole.JazmOperator or
        HarfRole.RafOperator;

    public static bool IsConnector(this HarfRole role) => role is
        HarfRole.SequenceConnector or
        HarfRole.CoordinationConnector or
        HarfRole.ImmediateConnector or
        HarfRole.ContrastConnector or
        HarfRole.CausalConnector or
        HarfRole.ConditionalConnector or
        HarfRole.ExplanatoryConnector;
}

