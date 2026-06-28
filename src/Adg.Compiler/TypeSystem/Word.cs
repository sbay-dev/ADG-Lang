namespace Adg.Compiler;

internal sealed class Word : IAdgNode
{
    private Word(string surface, TokenKind kind, AdgCase marker, HarfRole role)
    {
        if (string.IsNullOrWhiteSpace(surface))
        {
            throw new AdgTypeException("Token surface must not be empty.");
        }

        Surface = surface;
        Kind = kind;
        Case = marker;
        Role = role;

        Validate();
    }

    public string Surface { get; }

    public TokenKind Kind { get; }

    public AdgCase Case { get; }

    public HarfRole Role { get; }

    public NodeShape Shapes => Kind switch
    {
        TokenKind.Ism => NodeShape.Token | NodeShape.Object,
        TokenKind.Fil => NodeShape.Token | NodeShape.Event,
        TokenKind.Harf => NodeShape.Token,
        _ => NodeShape.Token
    };

    public IReadOnlyList<Word> RenderWords() => [this];

    public static Word Ism(string surface, AdgCase marker) => new(surface, TokenKind.Ism, marker, HarfRole.None);

    public static Word Fil(string surface, AdgCase marker = AdgCase.None) => new(surface, TokenKind.Fil, marker, HarfRole.None);

    public static Word Harf(string surface, HarfRole role = HarfRole.None) => new(surface, TokenKind.Harf, AdgCase.None, role);

    private void Validate()
    {
        if (Kind == TokenKind.Ism && Case == AdgCase.Jazm)
        {
            throw new AdgTypeException($"Ism cannot receive Jazm: {Surface}");
        }

        if (Kind == TokenKind.Fil && Case is AdgCase.Raf or AdgCase.Nasb or AdgCase.Jarr or AdgCase.Tanwin)
        {
            throw new AdgTypeException($"Fi'l can receive only Jazm or no case: {Surface}");
        }

        if (Kind == TokenKind.Harf && Case != AdgCase.None)
        {
            throw new AdgTypeException($"Harf must not receive an i'rab case: {Surface}");
        }
    }

    public override string ToString() => Kind switch
    {
        TokenKind.Ism => $"Ism[{Case}]: {Surface}",
        TokenKind.Fil => Case == AdgCase.None ? $"Fi'l: {Surface}" : $"Fi'l[{Case}]: {Surface}",
        TokenKind.Harf => Role == HarfRole.None ? $"Harf: {Surface}" : $"Harf[{Role}]: {Surface}",
        _ => Surface
    };
}

