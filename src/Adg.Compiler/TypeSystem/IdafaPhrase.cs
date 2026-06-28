namespace Adg.Compiler;

internal sealed class IdafaPhrase : IAdgNode
{
    public IdafaPhrase(Word mudaf, Word mudafIlayh)
    {
        TypeContracts.RequireKind(mudaf, TokenKind.Ism, "Mudaf");
        TypeContracts.RequireIsmCase(mudafIlayh, AdgCase.Jarr, "MudafIlayh");

        Mudaf = mudaf;
        MudafIlayh = mudafIlayh;
    }

    public Word Mudaf { get; }

    public Word MudafIlayh { get; }

    public NodeShape Shapes => NodeShape.Phrase | NodeShape.Object;

    public IReadOnlyList<Word> RenderWords() => [Mudaf, MudafIlayh];
}

