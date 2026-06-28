namespace Adg.Compiler;

internal sealed class Clause(IReadOnlyList<IAdgNode> parts) : IAdgNode
{
    public IReadOnlyList<IAdgNode> Parts { get; } = parts.Count == 0
        ? throw new AdgTypeException("Clause requires at least one syntactic part.")
        : parts;

    public NodeShape Shapes => NodeShape.Clause;

    public IReadOnlyList<Word> RenderWords() => Parts.SelectMany(part => part.RenderWords()).ToArray();
}

