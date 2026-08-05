namespace Adg.NativeCompiler;

internal static class AdgRefinerParser
{
    public static AdgRefinerProgram ParseFile(string path) => ParseLines(File.ReadAllLines(path));

    public static AdgRefinerProgram ParseLines(IReadOnlyList<string> lines)
    {
        var refiners = new List<RefinerDefinition>();
        string? runTarget = null;
        var runCount = 0;
        var directionHeaderValidated = false;
        RefinerBuilder? current = null;

        foreach (var rawLine in lines)
        {
            var line = StripComment(rawLine).Trim();
            if (line.Length == 0)
            {
                continue;
            }

            if (!directionHeaderValidated)
            {
                TextDirectionHeader.Validate(line);
                directionHeaderValidated = true;
                continue;
            }

            if (line.StartsWith("adg ", StringComparison.OrdinalIgnoreCase) || line.StartsWith("program ", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var tokens = FunctionSyntax.Tokenize(line);
            if (tokens.Count == 0)
            {
                continue;
            }

            var head = tokens[0];
            if (head.IsQuoted)
            {
                throw new AdgParseException($"ADG refiner statement must start with a keyword, not a string: {line}");
            }

            if (FunctionSyntax.IsKeyword(head.Text, RefinerSyntax.RefinerKeyword))
            {
                FlushRefiner(refiners, ref current);
                current = ParseRefinerHeader(tokens, line);
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, RefinerSyntax.RunKeyword))
            {
                FlushRefiner(refiners, ref current);
                runCount++;
                if (runCount > 1)
                {
                    throw new AdgParseException(
                        DiagnosticCode.MultipleRefinerApplications,
                        $"A refiner program may declare only one '{RefinerSyntax.RunKeyword}' statement.");
                }

                runTarget = ParseRun(tokens, line);
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, RefinerSyntax.LexiconKeyword))
            {
                RequireCurrent(current, RefinerSyntax.LexiconKeyword).Lexicon.Add(ParseLexicon(tokens, line));
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, RefinerSyntax.NormalizationKeyword))
            {
                RequireCurrent(current, RefinerSyntax.NormalizationKeyword).AddFlag(ParseFlag(tokens, line));
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, RefinerSyntax.GuaranteeKeyword))
            {
                RequireCurrent(current, RefinerSyntax.GuaranteeKeyword).EnableGate(ParseGuarantee(tokens, line));
                continue;
            }

            throw new AdgParseException($"Unsupported ADG refiner statement: {line}");
        }

        FlushRefiner(refiners, ref current);

        if (!directionHeaderValidated)
        {
            throw new AdgParseException(
                DiagnosticCode.MissingTextDirectionHeader,
                $"Missing mandatory text direction header. First non-empty line must be '{TextDirectionHeader.Canonical}'.");
        }

        return new AdgRefinerProgram(refiners, runTarget ?? string.Empty);
    }

    private static RefinerBuilder ParseRefinerHeader(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException(
                $"Refiner definition must be '{RefinerSyntax.RefinerKeyword} \"<name>\"': {line}");
        }

        return new RefinerBuilder(tokens[1].Text);
    }

    private static LexiconEntry ParseLexicon(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 4
            || !tokens[1].IsQuoted
            || tokens[2].IsQuoted
            || !tokens[3].IsQuoted)
        {
            throw new AdgParseException(
                $"Lexicon statement must be '{RefinerSyntax.LexiconKeyword} \"<bare>\" {RefinerSyntax.VowelizationKeyword} \"<voweled>\"': {line}");
        }

        if (!FunctionSyntax.IsKeyword(tokens[2].Text, RefinerSyntax.VowelizationKeyword))
        {
            throw new AdgParseException(
                $"Lexicon vowelization must be introduced by '{RefinerSyntax.VowelizationKeyword}': {line}");
        }

        var bare = tokens[1].Text;
        var voweled = tokens[3].Text;
        return new LexiconEntry(ArabicText.Skeletonize(bare), voweled, bare);
    }

    private static NormalizationFlag ParseFlag(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException(
                $"Normalization statement must be '{RefinerSyntax.NormalizationKeyword} \"<rule>\"': {line}");
        }

        if (!RefinerSyntax.TryParseFlag(tokens[1].Text, out var flag))
        {
            throw new AdgParseException(
                DiagnosticCode.InvalidNormalizationRule,
                $"Unknown normalization rule '{tokens[1].Text}'. Expected one of " +
                $"'{RefinerSyntax.CollapseSpacesFlag}', '{RefinerSyntax.RemoveTatweelFlag}', '{RefinerSyntax.StripTashkeelFlag}'.");
        }

        return flag;
    }

    private static bool ParseGuarantee(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || tokens[1].IsQuoted || !FunctionSyntax.IsKeyword(tokens[1].Text, RefinerSyntax.VocalicLabel))
        {
            throw new AdgParseException(
                $"Conservation guarantee must be '{RefinerSyntax.GuaranteeKeyword} {RefinerSyntax.VocalicLabel}': {line}");
        }

        return true;
    }

    private static string ParseRun(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException(
                $"Run statement must be '{RefinerSyntax.RunKeyword} \"<refiner-name>\"': {line}");
        }

        return tokens[1].Text;
    }

    private static RefinerBuilder RequireCurrent(RefinerBuilder? current, string keyword)
    {
        return current ?? throw new AdgParseException(
            $"'{keyword}' statement requires a preceding '{RefinerSyntax.RefinerKeyword}' definition.");
    }

    private static void FlushRefiner(List<RefinerDefinition> refiners, ref RefinerBuilder? current)
    {
        if (current is not null)
        {
            refiners.Add(current.Build());
            current = null;
        }
    }

    private static string StripComment(string line)
    {
        var index = line.IndexOf('#', StringComparison.Ordinal);
        return index < 0 ? line : line[..index];
    }

    private sealed class RefinerBuilder(string name)
    {
        private readonly HashSet<NormalizationFlag> _flags = [];
        private bool _conservationGate;

        public string Name { get; } = name;

        public List<LexiconEntry> Lexicon { get; } = [];

        public void AddFlag(NormalizationFlag flag) => _flags.Add(flag);

        public void EnableGate(bool enabled)
        {
            if (enabled)
            {
                _conservationGate = true;
            }
        }

        public RefinerDefinition Build() => new(Name, Lexicon, _flags, _conservationGate);
    }
}
