using System.Globalization;

namespace Adg.QuranicCorpus;

public enum QacSegmentKind
{
    Prefix,
    Stem,
    Suffix,
}

public readonly record struct QacLocation(int Chapter, int Verse, int Word, int Segment)
    : IComparable<QacLocation>
{
    public static bool TryParse(string value, out QacLocation location)
    {
        location = default;
        if (value.Length < 9 || value[0] != '(' || value[^1] != ')')
        {
            return false;
        }

        var parts = value[1..^1].Split(':');
        if (parts.Length != 4
            || !int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var chapter)
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var verse)
            || !int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var word)
            || !int.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out var segment)
            || chapter is < 1 or > 114
            || verse < 1
            || word < 1
            || segment < 1)
        {
            return false;
        }

        location = new QacLocation(chapter, verse, word, segment);
        return true;
    }

    public QacWordKey WordKey => new(Chapter, Verse, Word);

    public QacVerseKey VerseKey => new(Chapter, Verse);

    public int CompareTo(QacLocation other)
    {
        var chapter = Chapter.CompareTo(other.Chapter);
        if (chapter != 0)
        {
            return chapter;
        }

        var verse = Verse.CompareTo(other.Verse);
        if (verse != 0)
        {
            return verse;
        }

        var word = Word.CompareTo(other.Word);
        return word != 0 ? word : Segment.CompareTo(other.Segment);
    }

    public override string ToString() =>
        FormattableString.Invariant($"({Chapter}:{Verse}:{Word}:{Segment})");
}

public readonly record struct QacWordKey(int Chapter, int Verse, int Word)
{
    public override string ToString() =>
        FormattableString.Invariant($"({Chapter}:{Verse}:{Word})");
}

public readonly record struct QacVerseKey(int Chapter, int Verse)
{
    public override string ToString() =>
        FormattableString.Invariant($"({Chapter}:{Verse})");
}

public sealed record QacMorphologyRecord(
    QacLocation Location,
    string Form,
    string Tag,
    QacSegmentKind SegmentKind,
    IReadOnlyList<string> Features,
    string RawFeatures,
    int SourceLine)
{
    public string CanonicalLine =>
        string.Concat(Location.ToString(), "\t", Form, "\t", Tag, "\t", RawFeatures);
}

public sealed record QacTagDefinition(
    string Code,
    string Family,
    IReadOnlyList<QacSegmentKind> AllowedSegmentKinds);

public sealed record QacIssue(string Code, int Line, string Message);

public sealed class QacGrammarEvidence
{
    public SortedDictionary<string, long> FaRoleCounts { get; init; } =
        new(StringComparer.Ordinal);

    public long CausalFaCount { get; init; }

    public long CausalFaDirectImperfectCount { get; init; }

    public long CausalFaDirectImperfectSubjunctiveCount { get; init; }

    public long CausalFaOtherContinuationCount { get; init; }
}

public sealed class QacTransliterationEvidence
{
    public long MappedSegmentCount { get; init; }

    public long EmptyElidedFormCount { get; init; }

    public long SpacedFormCount { get; init; }

    public long DistinctFormCount { get; init; }

    public required string ArabicFormMerkleRoot { get; init; }
}

public sealed class QacVerificationReport
{
    public required string CatalogId { get; init; }

    public required string InputSha256 { get; init; }

    public long DataRowCount { get; init; }

    public long ValidSegmentCount { get; init; }

    public long WordCount { get; init; }

    public long VerseCount { get; init; }

    public long ChapterCount { get; init; }

    public required string RecordMerkleRoot { get; init; }

    public bool HeaderFound { get; init; }

    public bool QacNoticeFound { get; init; }

    public bool TanzilNoticeFound { get; init; }

    public SortedDictionary<string, long> TagCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> SegmentKindCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> FeatureCounts { get; init; } =
        new(StringComparer.Ordinal);

    public required QacGrammarEvidence GrammarEvidence { get; init; }

    public required QacTransliterationEvidence TransliterationEvidence { get; init; }

    public long ErrorCount { get; init; }

    public IReadOnlyList<QacIssue> Errors { get; init; } = [];

    public bool IsValid => ErrorCount == 0;
}

public sealed class QacVerificationOptions
{
    public bool RequireOfficialNotices { get; init; } = true;

    public bool RequireQacV04Coverage { get; init; }

    public int MaxReportedErrors { get; init; } = 100;
}

public sealed record QacNormalizedMorphologyRecord(
    string Location,
    string Form,
    string Tag,
    string SegmentKind,
    IReadOnlyList<string> RawFeatures,
    string? Lemma,
    string? Root,
    string? SpecialClass,
    string? PersonGenderNumber,
    string? AttachedPronoun,
    string? Aspect,
    string? Mood,
    string? Voice,
    string? VerbForm,
    string? Derivation,
    string? GrammaticalCase,
    string? State);

public sealed record QacImportResult(
    string RecordsPath,
    string ReportPath,
    string SourcePath,
    string LicensePath,
    QacVerificationReport Report);
