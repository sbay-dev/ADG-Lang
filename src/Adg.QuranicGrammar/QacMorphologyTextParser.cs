using Adg.QuranicCore;

namespace Adg.QuranicGrammar;

public sealed record QacParserDiagnostic(
    string Code,
    string Message,
    SourceRange Range);

public sealed record QacParsedMorphologyUnit(
    int Index,
    IReadOnlyList<int> TokenIndexes,
    string Surface,
    string NormalizedSurface,
    SourceRange Range,
    QacLexiconMatchKind MatchKind,
    IReadOnlyList<QacLexicalCandidate> Candidates);

public sealed record QacMorphologyParse(
    string OriginalText,
    IReadOnlyList<QuranicToken> Tokens,
    IReadOnlyList<QacParsedMorphologyUnit> Units,
    IReadOnlyList<QacParserDiagnostic> Diagnostics);

public sealed class QacMorphologyTextParser
{
    private readonly QacMorphologyLexicon lexicon;
    private readonly IQacUnknownMorphologyProvider? unknownProvider;
    private readonly QuranicTokenizer tokenizer = new();

    public QacMorphologyTextParser(
        QacMorphologyLexicon lexicon,
        IQacUnknownMorphologyProvider? unknownProvider = null)
    {
        this.lexicon = lexicon ?? throw new ArgumentNullException(nameof(lexicon));
        this.unknownProvider = unknownProvider;
    }

    public QacMorphologyParse Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var tokens = tokenizer.Tokenize(text);
        var wordTokens = tokens
            .Where(token => token.Kind == QuranicTokenKind.Word)
            .ToArray();
        var units = new List<QacParsedMorphologyUnit>();
        var diagnostics = new List<QacParserDiagnostic>();

        for (var index = 0; index < wordTokens.Length;)
        {
            var selectedLength = 1;
            var selectedSurface = wordTokens[index].Surface;
            var selectedResult = lexicon.Parse(selectedSurface);

            for (var length = Math.Min(lexicon.MaxSurfaceWordCount, wordTokens.Length - index);
                 length >= 2;
                 length--)
            {
                if (!HasWhitespaceOnlyGaps(text, wordTokens, index, length))
                {
                    continue;
                }

                var combined = string.Join(
                    " ",
                    wordTokens.Skip(index).Take(length).Select(token => token.Surface));
                var combinedResult = lexicon.Parse(combined);
                if (combinedResult.MatchKind == QacLexiconMatchKind.Unknown
                    || combinedResult.Candidates.All(candidate =>
                        !candidate.ArabicSurface.Contains(' ', StringComparison.Ordinal)))
                {
                    continue;
                }

                selectedLength = length;
                selectedSurface = combined;
                selectedResult = combinedResult;
                break;
            }

            var selectedTokens = wordTokens.Skip(index).Take(selectedLength).ToArray();
            var start = selectedTokens[0].Range.Start;
            var end = selectedTokens[^1].Range.End;
            var range = new SourceRange(start, end - start);
            if (selectedResult.MatchKind == QacLexiconMatchKind.Unknown
                && unknownProvider is not null)
            {
                var heuristicCandidates = unknownProvider.Guess(
                    selectedSurface,
                    selectedResult.NormalizedInput);
                if (heuristicCandidates.Count > 0)
                {
                    selectedResult = new QacLexiconParseResult(
                        selectedSurface,
                        selectedResult.NormalizedInput,
                        QacLexiconMatchKind.Heuristic,
                        heuristicCandidates);
                }
            }

            var unit = new QacParsedMorphologyUnit(
                units.Count,
                selectedTokens.Select(token => token.Index).ToArray(),
                selectedSurface,
                selectedResult.NormalizedInput,
                range,
                selectedResult.MatchKind,
                selectedResult.Candidates);
            units.Add(unit);

            if (selectedResult.MatchKind == QacLexiconMatchKind.Unknown)
            {
                diagnostics.Add(
                    new QacParserDiagnostic(
                        "ADG-QC2001",
                        $"No Quranic morphology analysis was found for '{selectedSurface}'.",
                        range));
            }
            else if (selectedResult.MatchKind == QacLexiconMatchKind.Heuristic)
            {
                diagnostics.Add(
                    new QacParserDiagnostic(
                        "ADG-QC2003",
                        $"'{selectedSurface}' was analyzed heuristically and requires lexical verification.",
                        range));
            }
            else if (selectedResult.Candidates.Count > 1)
            {
                diagnostics.Add(
                    new QacParserDiagnostic(
                        "ADG-QC2002",
                        $"The surface '{selectedSurface}' has {selectedResult.Candidates.Count} valid morphology analyses.",
                        range));
            }

            index += selectedLength;
        }

        return new QacMorphologyParse(text, tokens, units, diagnostics);
    }

    private static bool HasWhitespaceOnlyGaps(
        string text,
        IReadOnlyList<QuranicToken> tokens,
        int start,
        int length)
    {
        for (var index = start; index < start + length - 1; index++)
        {
            var gapStart = tokens[index].Range.End;
            var gapLength = tokens[index + 1].Range.Start - gapStart;
            if (gapLength < 1)
            {
                return false;
            }

            foreach (var character in text.AsSpan(gapStart, gapLength))
            {
                if (!char.IsWhiteSpace(character))
                {
                    return false;
                }
            }
        }

        return true;
    }
}
