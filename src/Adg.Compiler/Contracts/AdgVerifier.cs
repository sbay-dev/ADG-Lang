namespace Adg.Compiler;

internal static class AdgVerifier
{
    public static VerifiedAdgProgram Verify(AdgProgram program)
    {
        var relations = new List<ResolvedRelation>();
        var operators = new List<ResolvedOperator>();
        var semanticFrames = new List<SemanticFrame>();

        Visit(program.Root, relations, operators, semanticFrames);

        if (semanticFrames.Count == 0)
        {
            throw new AdgTypeException(DiagnosticCode.InvalidSemanticFrame, "VerifiedAdgProgram requires at least one semantic frame.");
        }

        return new VerifiedAdgProgram(program, relations, operators, semanticFrames);
    }

    private static void Visit(
        IAdgNode node,
        List<ResolvedRelation> relations,
        List<ResolvedOperator> operators,
        List<SemanticFrame> semanticFrames)
    {
        switch (node)
        {
            case Word word:
                semanticFrames.Add(new SemanticFrame(word.Kind.ToString(), word.Surface, [word.Case.ToString(), word.Role.ToString()]));
                break;
            case VerbalSentence sentence:
                relations.Add(new ResolvedRelation("Fa'il", sentence.Verb.Surface, sentence.Fail.Surface));
                semanticFrames.Add(new SemanticFrame("Event", sentence.Verb.Surface, ["Agent"]));

                if (sentence.Maful is not null)
                {
                    relations.Add(new ResolvedRelation("Maf'ul", sentence.Verb.Surface, sentence.Maful.Surface));
                    semanticFrames[^1] = semanticFrames[^1] with { Slots = ["Agent", "Patient"] };
                }

                Visit(sentence.Verb, relations, operators, semanticFrames);
                Visit(sentence.Fail, relations, operators, semanticFrames);
                if (sentence.Maful is not null)
                {
                    Visit(sentence.Maful, relations, operators, semanticFrames);
                }

                foreach (var adjunct in sentence.Adjuncts)
                {
                    Visit(adjunct, relations, operators, semanticFrames);
                }
                break;
            case IdafaPhrase phrase:
                relations.Add(new ResolvedRelation("Idafa", phrase.Mudaf.Surface, phrase.MudafIlayh.Surface));
                semanticFrames.Add(new SemanticFrame("PossessionOrSpecification", phrase.Mudaf.Surface, [phrase.MudafIlayh.Surface]));
                Visit(phrase.Mudaf, relations, operators, semanticFrames);
                Visit(phrase.MudafIlayh, relations, operators, semanticFrames);
                break;
            case HarfGovernance governance:
                operators.Add(new ResolvedOperator(governance.Operator.Role.ToString(), governance.Operator.Surface, TypeContracts.Describe(governance.Operand)));
                relations.Add(new ResolvedRelation("HarfGovernance", governance.Operator.Surface, TypeContracts.Describe(governance.Operand)));
                Visit(governance.Operator, relations, operators, semanticFrames);
                Visit(governance.Operand, relations, operators, semanticFrames);
                break;
            case ConnectedSentence connected:
                operators.Add(new ResolvedOperator(connected.Connector.Role.ToString(), connected.Connector.Surface, $"{TypeContracts.Describe(connected.Left)} -> {TypeContracts.Describe(connected.Right)}"));
                relations.Add(new ResolvedRelation("ConnectiveRelation", TypeContracts.Describe(connected.Left), TypeContracts.Describe(connected.Right)));
                Visit(connected.Left, relations, operators, semanticFrames);
                Visit(connected.Connector, relations, operators, semanticFrames);
                Visit(connected.Right, relations, operators, semanticFrames);
                break;
            case OperatorApplication application:
                operators.Add(new ResolvedOperator(application.Operator.Role.ToString(), application.Operator.Surface, TypeContracts.Describe(application.Target)));
                relations.Add(new ResolvedRelation("OperatorApplication", application.Operator.Surface, TypeContracts.Describe(application.Target)));
                Visit(application.Operator, relations, operators, semanticFrames);
                Visit(application.Target, relations, operators, semanticFrames);
                break;
            case Clause clause:
                semanticFrames.Add(new SemanticFrame("Clause", "Clause", clause.Parts.Select(TypeContracts.Describe).ToArray()));
                foreach (var part in clause.Parts)
                {
                    Visit(part, relations, operators, semanticFrames);
                }
                break;
            default:
                throw new AdgTypeException(DiagnosticCode.InvalidSemanticFrame, $"Unknown ADG node in verifier: {node.GetType().Name}.");
        }
    }
}

