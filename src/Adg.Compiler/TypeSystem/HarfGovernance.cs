namespace Adg.Compiler;

internal sealed class HarfGovernance : IAdgNode
{
    public HarfGovernance(Word @operator, IAdgNode operand)
    {
        TypeContracts.RequireKind(@operator, TokenKind.Harf, "HarfGovernance operator");

        if (!@operator.Role.IsCaseOperator())
        {
            throw new AdgTypeException($"HarfGovernance requires a case operator, but received {@operator}.");
        }

        Operator = @operator;
        Operand = operand;
        ResultingCase = @operator.Role switch
        {
            HarfRole.NasbOperator => AdgCase.Nasb,
            HarfRole.JarrOperator => AdgCase.Jarr,
            HarfRole.JazmOperator => AdgCase.Jazm,
            HarfRole.RafOperator => AdgCase.Raf,
            _ => AdgCase.None
        };

        if (!TypeContracts.NodeAcceptsCase(operand, ResultingCase))
        {
            var code = @operator.Role == HarfRole.JarrOperator ? DiagnosticCode.InvalidJarrOperand : DiagnosticCode.InvalidOperatorArity;
            throw new AdgTypeException(code, $"{@operator.Role} \"{@operator.Surface}\" requires operand with Case={ResultingCase}. Received {TypeContracts.Describe(operand)}.");
        }
    }

    public Word Operator { get; }

    public IAdgNode Operand { get; }

    public AdgCase ResultingCase { get; }

    public NodeShape Shapes => NodeShape.Phrase;

    public IReadOnlyList<Word> RenderWords() => [Operator, .. Operand.RenderWords()];
}

