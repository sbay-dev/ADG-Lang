namespace Adg.Compiler;

internal sealed class ConnectedSentence : IAdgNode
{
    public ConnectedSentence(IAdgNode left, Word connector, IAdgNode right)
    {
        TypeContracts.RequireKind(connector, TokenKind.Harf, "Connector");

        if (!connector.Role.IsConnector())
        {
            throw new AdgTypeException($"ConnectedSentence requires a connector Harf, but received {connector}.");
        }

        Left = left;
        Connector = connector;
        Right = right;

        ValidateOperands();
    }

    public IAdgNode Left { get; }

    public Word Connector { get; }

    public IAdgNode Right { get; }

    public NodeShape Shapes => NodeShape.Sentence | NodeShape.Clause;

    public IReadOnlyList<Word> RenderWords() => [.. Left.RenderWords(), Connector, .. Right.RenderWords()];

    private void ValidateOperands()
    {
        switch (Connector.Role)
        {
            case HarfRole.SequenceConnector:
                RequireShape(Left, NodeShape.Sentence | NodeShape.Event, "left", "Sentence or Event");
                RequireShape(Right, NodeShape.Sentence | NodeShape.Event, "right", "Sentence or Event");
                break;
            case HarfRole.CoordinationConnector:
                if ((Left.Shapes & Right.Shapes & (NodeShape.Token | NodeShape.Phrase | NodeShape.Sentence | NodeShape.Event | NodeShape.Object)) == NodeShape.None)
                {
                    throw new AdgTypeException($"CoordinationConnector \"{Connector.Surface}\" requires operands of the same syntactic level. Received {TypeContracts.Describe(Left)} and {TypeContracts.Describe(Right)}.");
                }
                break;
            case HarfRole.ImmediateConnector:
                RequireShape(Left, NodeShape.Sentence | NodeShape.Event, "left", "Sentence or Event");
                RequireShape(Right, NodeShape.Sentence | NodeShape.Event, "right", "Sentence or Event");
                break;
            case HarfRole.ContrastConnector:
                RequireShape(Left, NodeShape.Sentence, "left", "Sentence");
                RequireShape(Right, NodeShape.Sentence, "right", "Sentence");
                break;
            case HarfRole.CausalConnector:
                RequireShape(Left, NodeShape.Sentence, "left", "Sentence");
                RequireShape(Right, NodeShape.Clause | NodeShape.Sentence, "right", "Clause or Sentence");
                break;
            case HarfRole.ConditionalConnector:
                RequireShape(Left, NodeShape.Clause | NodeShape.Sentence, "condition", "Clause or Sentence");
                RequireShape(Right, NodeShape.Clause | NodeShape.Sentence, "consequence", "Clause or Sentence");
                break;
            case HarfRole.ExplanatoryConnector:
                if (Right.Shapes == NodeShape.None)
                {
                    throw new AdgTypeException($"ExplanatoryConnector \"{Connector.Surface}\" requires an explanation operand.");
                }

                TypeContracts.RequireExplanationCaseAgreement(Left, Right, Connector.Surface);
                break;
        }
    }

    private void RequireShape(IAdgNode node, NodeShape required, string side, string label)
    {
        if ((node.Shapes & required) == NodeShape.None)
        {
            throw new AdgTypeException($"{Connector.Role} \"{Connector.Surface}\" requires {side} operand of type {label}. Received {TypeContracts.Describe(node)}.");
        }
    }
}

