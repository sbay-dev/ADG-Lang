namespace Adg.Compiler;

internal sealed class VerifiedAdgProgram(
    AdgProgram program,
    IReadOnlyList<ResolvedRelation> relations,
    IReadOnlyList<ResolvedOperator> operators,
    IReadOnlyList<SemanticFrame> semanticFrames)
{
    public AdgProgram Program { get; } = program;

    public IReadOnlyList<ResolvedRelation> Relations { get; } = relations;

    public IReadOnlyList<ResolvedOperator> Operators { get; } = operators;

    public IReadOnlyList<SemanticFrame> SemanticFrames { get; } = semanticFrames;

    public string RenderText() => Program.RenderText();
}

internal sealed record ResolvedRelation(string Kind, string Head, string Dependent);

internal sealed record ResolvedOperator(string Kind, string Surface, string Target);

internal sealed record SemanticFrame(string Kind, string Anchor, IReadOnlyList<string> Slots);

