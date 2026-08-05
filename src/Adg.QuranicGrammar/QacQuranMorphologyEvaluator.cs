using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QacEvaluationIssue(
    string Code,
    string Verse,
    string Message);

public sealed class QacQuranMorphologyEvaluation
{
    public long VerseCount { get; init; }

    public long ExpectedWordCount { get; init; }

    public long ParsedUnitCount { get; init; }

    public long ExactMatchCount { get; init; }

    public long SignatureCoveredCount { get; init; }

    public long SpanMatchCount { get; init; }

    public long AmbiguousUnitCount { get; init; }

    public long UnknownUnitCount { get; init; }

    public long ErrorCount { get; init; }

    public required string VerseCorpusMerkleRoot { get; init; }

    public required string EvaluationMerkleRoot { get; init; }

    public IReadOnlyList<QacEvaluationIssue> Errors { get; init; } = [];

    public bool IsValid =>
        ErrorCount == 0
        && ExpectedWordCount == ParsedUnitCount
        && ExpectedWordCount == ExactMatchCount
        && ExpectedWordCount == SignatureCoveredCount
        && ExpectedWordCount == SpanMatchCount
        && UnknownUnitCount == 0;
}

public static class QacQuranMorphologyEvaluator
{
    public static QacQuranMorphologyEvaluation Evaluate(
        QacMorphologyLexicon lexicon,
        QacVerseCorpus corpus,
        int maxReportedErrors = 100)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        ArgumentNullException.ThrowIfNull(corpus);
        if (maxReportedErrors < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxReportedErrors));
        }

        var parser = new QacMorphologyTextParser(lexicon);
        var errors = new List<QacEvaluationIssue>();
        var leaves = new List<byte[]>();
        long errorCount = 0;
        long expectedWordCount = 0;
        long parsedUnitCount = 0;
        long exactMatchCount = 0;
        long signatureCoveredCount = 0;
        long spanMatchCount = 0;
        long ambiguousUnitCount = 0;
        long unknownUnitCount = 0;

        void AddError(string code, string verse, string message)
        {
            errorCount++;
            if (errors.Count < maxReportedErrors)
            {
                errors.Add(new QacEvaluationIssue(code, verse, message));
            }
        }

        foreach (var verse in corpus.Verses)
        {
            var parse = parser.Parse(verse.Text);
            expectedWordCount += verse.Words.Count;
            parsedUnitCount += parse.Units.Count;
            unknownUnitCount += parse.Units.Count(unit =>
                unit.MatchKind == QacLexiconMatchKind.Unknown);
            ambiguousUnitCount += parse.Units.Count(unit => unit.Candidates.Count > 1);

            if (parse.Units.Count != verse.Words.Count)
            {
                AddError(
                    "ADG-QC2101",
                    verse.Location,
                    $"Expected {verse.Words.Count} words but parsed {parse.Units.Count} units.");
            }

            var comparableCount = Math.Min(parse.Units.Count, verse.Words.Count);
            for (var index = 0; index < comparableCount; index++)
            {
                var expected = verse.Words[index];
                var actual = parse.Units[index];
                if (actual.MatchKind == QacLexiconMatchKind.Exact
                    && actual.Surface == expected.Surface)
                {
                    exactMatchCount++;
                }
                else
                {
                    AddError(
                        "ADG-QC2102",
                        verse.Location,
                        $"Surface mismatch at {expected.Location}: '{actual.Surface}' != '{expected.Surface}'.");
                }

                if (actual.Candidates.Any(candidate =>
                    candidate.MorphologySignature == expected.MorphologySignature))
                {
                    signatureCoveredCount++;
                }
                else
                {
                    AddError(
                        "ADG-QC2103",
                        verse.Location,
                        $"Expected morphology signature was not retained at {expected.Location}.");
                }

                if (actual.Range == expected.Range)
                {
                    spanMatchCount++;
                }
                else
                {
                    AddError(
                        "ADG-QC2104",
                        verse.Location,
                        $"Source span mismatch at {expected.Location}.");
                }
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            verse.Location,
                            "\t",
                            string.Join(
                                "\u001E",
                                parse.Units.Select(unit =>
                                    string.Concat(
                                        unit.Surface,
                                        ":",
                                        unit.MatchKind,
                                        ":",
                                        unit.Candidates.Count)))))));
        }

        return new QacQuranMorphologyEvaluation
        {
            VerseCount = corpus.Verses.Count,
            ExpectedWordCount = expectedWordCount,
            ParsedUnitCount = parsedUnitCount,
            ExactMatchCount = exactMatchCount,
            SignatureCoveredCount = signatureCoveredCount,
            SpanMatchCount = spanMatchCount,
            AmbiguousUnitCount = ambiguousUnitCount,
            UnknownUnitCount = unknownUnitCount,
            ErrorCount = errorCount,
            VerseCorpusMerkleRoot = corpus.MerkleRoot,
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
            Errors = errors,
        };
    }
}
