namespace Adg.NativeCompiler;

internal sealed class HiddenReference : IAdgNode
{
    public HiddenReference(string surface, IAdgNode? target, bool inferred, string certainty)
    {
        if (target is null)
        {
            throw new AdgTypeException(DiagnosticCode.UnresolvedHiddenReference, $"HiddenReference \"{surface}\" requires a resolved target node.");
        }

        if (string.IsNullOrWhiteSpace(certainty))
        {
            throw new AdgTypeException(DiagnosticCode.UnresolvedHiddenReference, $"HiddenReference \"{surface}\" requires certainty metadata.");
        }

        Surface = string.IsNullOrWhiteSpace(surface) ? "HiddenReference" : surface;
        Target = target;
        Inferred = inferred;
        Certainty = certainty;
    }

    public string Surface { get; }

    public IAdgNode Target { get; }

    public bool Inferred { get; }

    public string Certainty { get; }

    public NodeShape Shapes => Target.Shapes;

    public IReadOnlyList<Word> RenderWords() => Target.RenderWords();
}
