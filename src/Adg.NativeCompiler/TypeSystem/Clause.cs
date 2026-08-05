namespace Adg.NativeCompiler;

internal sealed class Clause(IReadOnlyList<IAdgNode> parts) : IAdgNode
{
    public IReadOnlyList<IAdgNode> Parts { get; } = parts.Count == 0
        ? throw new AdgTypeException(DiagnosticCode.InvalidSemanticFrame, "Clause requires at least one syntactic part to form a semantic frame.")
        : parts;

    public NodeShape Shapes => NodeShape.Clause;

    public IReadOnlyList<Word> RenderWords() => Parts.SelectMany(part => part.RenderWords()).ToArray();
}
