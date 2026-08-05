using System.Collections.Frozen;

namespace Adg.QuranicCorpus;

public static class QacMorphologyCatalog
{
    public const string CatalogId = "qac-morphology-v0.4";

    public static IReadOnlyList<string> Sources { get; } =
    [
        "https://corpus.quran.com/download/",
        "https://corpus.quran.com/documentation/tagset.jsp",
        "https://corpus.quran.com/documentation/morphologicalfeatures.jsp",
        "https://corpus.quran.com/documentation/particlefa.jsp",
        "https://corpus.quran.com/documentation/mood.jsp",
    ];

    public static FrozenDictionary<string, QacTagDefinition> Tags { get; } =
        CreateTags().ToFrozenDictionary(tag => tag.Code, StringComparer.Ordinal);

    public static FrozenSet<string> LiteralFeatures { get; } = new[]
    {
        "+VOC",
        "+n:EMPH",
        "A:EQ+",
        "A:INTG+",
        "ACC",
        "ACT",
        "Al+",
        "DEF",
        "F",
        "FD",
        "FP",
        "FS",
        "GEN",
        "IMPF",
        "IMPV",
        "INDEF",
        "M",
        "MD",
        "MOOD:JUS",
        "MOOD:SUBJ",
        "MP",
        "MS",
        "NOM",
        "P",
        "PASS",
        "PCPL",
        "PERF",
        "VN",
        "bi+",
        "f:CAUS+",
        "f:CONJ+",
        "f:REM+",
        "f:RSLT+",
        "f:SUP+",
        "ha+",
        "ka+",
        "l:EMPH+",
        "l:IMPV+",
        "l:P+",
        "l:PRP+",
        "sa+",
        "ta+",
        "w:CIRC+",
        "w:COM+",
        "w:CONJ+",
        "w:P+",
        "w:REM+",
        "w:SUP+",
        "ya+",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> PersonGenderNumberValues { get; } = new[]
    {
        "1P",
        "1S",
        "2D",
        "2FD",
        "2FP",
        "2FS",
        "2MD",
        "2MP",
        "2MS",
        "3D",
        "3FD",
        "3FP",
        "3FS",
        "3MD",
        "3MP",
        "3MS",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> VerbForms { get; } = new[]
    {
        "(II)",
        "(III)",
        "(IV)",
        "(V)",
        "(VI)",
        "(VII)",
        "(VIII)",
        "(IX)",
        "(X)",
        "(XI)",
        "(XII)",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> SpecialClasses { get; } = new[]
    {
        "<in~",
        "kaAd",
        "kaAn",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenDictionary<string, FrozenSet<string>> PrefixFeaturesByTag { get; } =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["CAUS"] = ["f:CAUS+"],
            ["CIRC"] = ["w:CIRC+"],
            ["COM"] = ["w:COM+"],
            ["CONJ"] = ["f:CONJ+", "w:CONJ+"],
            ["DET"] = ["Al+"],
            ["EMPH"] = ["l:EMPH+"],
            ["EQ"] = ["A:EQ+"],
            ["FUT"] = ["sa+"],
            ["IMPV"] = ["l:IMPV+"],
            ["INTG"] = ["A:INTG+"],
            ["P"] = ["bi+", "ka+", "l:P+", "ta+", "w:P+"],
            ["PRP"] = ["l:PRP+"],
            ["REM"] = ["f:REM+", "w:REM+"],
            ["RSLT"] = ["f:RSLT+"],
            ["SUP"] = ["f:SUP+", "w:SUP+"],
            ["VOC"] = ["ha+", "ya+"],
        }.ToFrozenDictionary(
            pair => pair.Key,
            pair => pair.Value.ToFrozenSet(StringComparer.Ordinal),
            StringComparer.Ordinal);

    public static bool IsKnownFeature(string feature)
    {
        if (LiteralFeatures.Contains(feature)
            || PersonGenderNumberValues.Contains(feature)
            || VerbForms.Contains(feature))
        {
            return true;
        }

        if (TryGetFeatureValue(feature, "POS:", out var pos))
        {
            return Tags.ContainsKey(pos);
        }

        if (TryGetFeatureValue(feature, "LEM:", out var lemma)
            || TryGetFeatureValue(feature, "ROOT:", out lemma))
        {
            return IsSafeDynamicValue(lemma);
        }

        if (TryGetFeatureValue(feature, "SP:", out var special))
        {
            return SpecialClasses.Contains(special);
        }

        return TryGetFeatureValue(feature, "PRON:", out var pronoun)
            && PersonGenderNumberValues.Contains(pronoun);
    }

    public static bool IsAllowedAffixFeature(
        string tag,
        QacSegmentKind segmentKind,
        string feature)
    {
        if (segmentKind == QacSegmentKind.Prefix)
        {
            return PrefixFeaturesByTag.TryGetValue(tag, out var values)
                && values.Contains(feature);
        }

        if (segmentKind != QacSegmentKind.Suffix)
        {
            return false;
        }

        return tag switch
        {
            "EMPH" => feature == "+n:EMPH",
            "P" => feature == "l:P+",
            "PRON" => TryGetFeatureValue(feature, "PRON:", out var pronoun)
                && PersonGenderNumberValues.Contains(pronoun),
            "VOC" => feature == "+VOC",
            _ => false,
        };
    }

    public static bool AllowsEmptyForm(
        string tag,
        QacSegmentKind segmentKind,
        string feature) =>
        tag == "PRON"
        && segmentKind == QacSegmentKind.Suffix
        && feature == "PRON:1S";

    public static bool TryGetFeatureValue(string feature, string prefix, out string value)
    {
        if (feature.StartsWith(prefix, StringComparison.Ordinal)
            && feature.Length > prefix.Length)
        {
            value = feature[prefix.Length..];
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static bool IsSafeDynamicValue(string value) =>
        value.Length > 0
        && value.All(character =>
            character is not '\t'
            and not '\r'
            and not '\n'
            and not '|'
            && !char.IsWhiteSpace(character));

    private static IEnumerable<QacTagDefinition> CreateTags()
    {
        static QacTagDefinition Tag(
            string code,
            string family,
            params QacSegmentKind[] kinds) =>
            new(code, family, kinds);

        yield return Tag("ACC", "particle", QacSegmentKind.Stem);
        yield return Tag("ADJ", "nominal", QacSegmentKind.Stem);
        yield return Tag("AMD", "particle", QacSegmentKind.Stem);
        yield return Tag("ANS", "particle", QacSegmentKind.Stem);
        yield return Tag("AVR", "particle", QacSegmentKind.Stem);
        yield return Tag("CAUS", "particle", QacSegmentKind.Prefix);
        yield return Tag("CERT", "particle", QacSegmentKind.Stem);
        yield return Tag("CIRC", "particle", QacSegmentKind.Prefix);
        yield return Tag("COM", "particle", QacSegmentKind.Prefix);
        yield return Tag("COND", "particle", QacSegmentKind.Stem);
        yield return Tag("CONJ", "particle", QacSegmentKind.Prefix, QacSegmentKind.Stem);
        yield return Tag("DEM", "nominal", QacSegmentKind.Stem);
        yield return Tag("DET", "determiner", QacSegmentKind.Prefix);
        yield return Tag("EMPH", "particle", QacSegmentKind.Prefix, QacSegmentKind.Suffix);
        yield return Tag("EQ", "particle", QacSegmentKind.Prefix);
        yield return Tag("EXH", "particle", QacSegmentKind.Stem);
        yield return Tag("EXL", "particle", QacSegmentKind.Stem);
        yield return Tag("EXP", "particle", QacSegmentKind.Stem);
        yield return Tag("FUT", "particle", QacSegmentKind.Prefix, QacSegmentKind.Stem);
        yield return Tag("IMPN", "nominal", QacSegmentKind.Stem);
        yield return Tag("IMPV", "particle", QacSegmentKind.Prefix);
        yield return Tag("INC", "particle", QacSegmentKind.Stem);
        yield return Tag("INL", "quranic-initial", QacSegmentKind.Stem);
        yield return Tag("INT", "particle", QacSegmentKind.Stem);
        yield return Tag("INTG", "particle", QacSegmentKind.Prefix, QacSegmentKind.Stem);
        yield return Tag("LOC", "nominal", QacSegmentKind.Stem);
        yield return Tag("N", "nominal", QacSegmentKind.Stem);
        yield return Tag("NEG", "particle", QacSegmentKind.Stem);
        yield return Tag("P", "particle", QacSegmentKind.Prefix, QacSegmentKind.Stem, QacSegmentKind.Suffix);
        yield return Tag("PN", "nominal", QacSegmentKind.Stem);
        yield return Tag("PREV", "particle", QacSegmentKind.Stem);
        yield return Tag("PRO", "particle", QacSegmentKind.Stem);
        yield return Tag("PRON", "nominal", QacSegmentKind.Stem, QacSegmentKind.Suffix);
        yield return Tag("PRP", "particle", QacSegmentKind.Prefix);
        yield return Tag("REL", "nominal", QacSegmentKind.Stem);
        yield return Tag("REM", "particle", QacSegmentKind.Prefix);
        yield return Tag("RES", "particle", QacSegmentKind.Stem);
        yield return Tag("RET", "particle", QacSegmentKind.Stem);
        yield return Tag("RSLT", "particle", QacSegmentKind.Prefix);
        yield return Tag("SUB", "particle", QacSegmentKind.Stem);
        yield return Tag("SUP", "particle", QacSegmentKind.Prefix, QacSegmentKind.Stem);
        yield return Tag("SUR", "particle", QacSegmentKind.Stem);
        yield return Tag("T", "nominal", QacSegmentKind.Stem);
        yield return Tag("V", "verb", QacSegmentKind.Stem);
        yield return Tag("VOC", "particle", QacSegmentKind.Prefix, QacSegmentKind.Suffix);
    }
}
