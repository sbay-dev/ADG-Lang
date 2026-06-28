namespace Adg.Compiler;

internal sealed class OperatorApplication : IAdgNode
{
    public OperatorApplication(Word @operator, IAdgNode target)
    {
        TypeContracts.RequireKind(@operator, TokenKind.Harf, "OperatorApplication operator");

        if (@operator.Role is not (HarfRole.NegationOperator or HarfRole.InterrogativeOperator))
        {
            throw new AdgTypeException(DiagnosticCode.InvalidOperatorArity, $"OperatorApplication requires a NegationOperator or InterrogativeOperator. Received {@operator}.");
        }

        Operator = @operator;
        Target = target;
        ValidateTarget();
    }

    public Word Operator { get; }

    public IAdgNode Target { get; }

    public NodeShape Shapes => Target.Shapes;

    public IReadOnlyList<Word> RenderWords() => [Operator, .. Target.RenderWords()];

    private void ValidateTarget()
    {
        switch (Operator.Role)
        {
            case HarfRole.NegationOperator:
                if ((Target.Shapes & (NodeShape.Token | NodeShape.Clause | NodeShape.Sentence)) == NodeShape.None)
                {
                    throw new AdgTypeException(DiagnosticCode.MissingNegationTarget, $"NegationOperator \"{Operator.Surface}\" requires a target Token, Clause, or Sentence.");
                }
                break;
            case HarfRole.InterrogativeOperator:
                if ((Target.Shapes & NodeShape.Sentence) == NodeShape.None)
                {
                    throw new AdgTypeException(DiagnosticCode.MissingInterrogativeTarget, $"InterrogativeOperator \"{Operator.Surface}\" requires a complete target Sentence or typed UnknownSlot.");
                }
                break;
        }
    }
}

