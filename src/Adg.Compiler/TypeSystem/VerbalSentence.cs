namespace Adg.Compiler;

internal sealed class VerbalSentence : IAdgNode
{
    public VerbalSentence(Word verb, Word fail, Word? maful = null, IReadOnlyList<IAdgNode>? adjuncts = null)
    {
        TypeContracts.RequireKind(verb, TokenKind.Fil, "VerbalSentence verb");
        TypeContracts.RequireIsmCase(fail, AdgCase.Raf, "Fa'il");

        if (maful is not null)
        {
            TypeContracts.RequireIsmCase(maful, AdgCase.Nasb, "Maf'ul");
        }

        Verb = verb;
        Fail = fail;
        Maful = maful;
        Adjuncts = adjuncts ?? [];
    }

    public Word Verb { get; }

    public Word Fail { get; }

    public Word? Maful { get; }

    public IReadOnlyList<IAdgNode> Adjuncts { get; }

    public NodeShape Shapes => NodeShape.Sentence | NodeShape.Clause | NodeShape.Event;

    public IReadOnlyList<Word> RenderWords()
    {
        var words = new List<Word> { Verb, Fail };

        if (Maful is not null)
        {
            words.Add(Maful);
        }

        foreach (var adjunct in Adjuncts)
        {
            words.AddRange(adjunct.RenderWords());
        }

        return words;
    }
}

