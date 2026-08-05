namespace Adg.QuranicCorpus;

public static class QacMorphologyParser
{
    private static readonly string[] StructuralFeatures = ["PREFIX", "STEM", "SUFFIX"];

    public static bool TryParseRecord(
        string line,
        int lineNumber,
        out QacMorphologyRecord? record,
        out QacIssue? issue)
    {
        record = null;
        issue = null;

        var columns = line.Split('\t');
        if (columns.Length != 4)
        {
            issue = new QacIssue(
                "QAC-MOR0001",
                lineNumber,
                $"Expected four tab-separated columns but found {columns.Length}.");
            return false;
        }

        if (!QacLocation.TryParse(columns[0], out var location))
        {
            issue = new QacIssue(
                "QAC-MOR0002",
                lineNumber,
                $"Invalid Quranic Corpus location '{columns[0]}'.");
            return false;
        }

        var tag = columns[2];
        if (!QacMorphologyCatalog.Tags.TryGetValue(tag, out var tagDefinition))
        {
            issue = new QacIssue(
                "QAC-MOR0004",
                lineNumber,
                $"Unknown QAC tag '{tag}'.");
            return false;
        }

        var features = columns[3].Split('|');
        if (features.Length < 2 || !TryParseSegmentKind(features[0], out var segmentKind))
        {
            issue = new QacIssue(
                "QAC-MOR0005",
                lineNumber,
                "FEATURES must begin with PREFIX, STEM, or SUFFIX and include at least one annotation.");
            return false;
        }

        if (!tagDefinition.AllowedSegmentKinds.Contains(segmentKind))
        {
            issue = new QacIssue(
                "QAC-MOR0006",
                lineNumber,
                $"Tag '{tag}' is not valid on a {segmentKind} segment in QAC v0.4.");
            return false;
        }

        if (features.Distinct(StringComparer.Ordinal).Count() != features.Length)
        {
            issue = new QacIssue(
                "QAC-MOR0007",
                lineNumber,
                "FEATURES contains a duplicate annotation.");
            return false;
        }

        for (var index = 1; index < features.Length; index++)
        {
            if (!QacMorphologyCatalog.IsKnownFeature(features[index]))
            {
                issue = new QacIssue(
                    "QAC-MOR0008",
                    lineNumber,
                    $"Unknown QAC feature '{features[index]}'.");
                return false;
            }
        }

        if (segmentKind == QacSegmentKind.Stem)
        {
            var posFeatures = features
                .Where(feature => feature.StartsWith("POS:", StringComparison.Ordinal))
                .ToArray();
            if (posFeatures.Length != 1 || posFeatures[0] != $"POS:{tag}")
            {
                issue = new QacIssue(
                    "QAC-MOR0009",
                    lineNumber,
                    $"A STEM tagged '{tag}' must contain exactly 'POS:{tag}'.");
                return false;
            }
        }
        else if (features.Length != 2
            || !QacMorphologyCatalog.IsAllowedAffixFeature(tag, segmentKind, features[1]))
        {
            issue = new QacIssue(
                "QAC-MOR0010",
                lineNumber,
                $"The {segmentKind} mapping '{tag}|{string.Join('|', features.Skip(1))}' is not in the QAC v0.4 catalog.");
            return false;
        }

        if (columns[1].Length == 0
            && !QacMorphologyCatalog.AllowsEmptyForm(tag, segmentKind, features[1]))
        {
            issue = new QacIssue(
                "QAC-MOR0003",
                lineNumber,
                "FORM may be empty only for the elided first-person singular pronoun suffix.");
            return false;
        }

        if (!ValidateMutualExclusion(features, out var conflict))
        {
            issue = new QacIssue("QAC-MOR0011", lineNumber, conflict);
            return false;
        }

        record = new QacMorphologyRecord(
            location,
            columns[1],
            tag,
            segmentKind,
            features,
            columns[3],
            lineNumber);
        return true;
    }

    private static bool TryParseSegmentKind(string value, out QacSegmentKind segmentKind)
    {
        segmentKind = value switch
        {
            "PREFIX" => QacSegmentKind.Prefix,
            "STEM" => QacSegmentKind.Stem,
            "SUFFIX" => QacSegmentKind.Suffix,
            _ => default,
        };
        return StructuralFeatures.Contains(value, StringComparer.Ordinal);
    }

    private static bool ValidateMutualExclusion(
        IReadOnlyCollection<string> features,
        out string error)
    {
        if (!AtMostOne(features, "NOM", "ACC", "GEN"))
        {
            error = "A segment cannot carry more than one grammatical case.";
            return false;
        }

        if (!AtMostOne(features, "DEF", "INDEF"))
        {
            error = "A segment cannot be both definite and indefinite.";
            return false;
        }

        if (!AtMostOne(features, "PERF", "IMPF", "IMPV"))
        {
            error = "A segment cannot carry more than one verbal aspect.";
            return false;
        }

        if (!AtMostOne(features, "ACT", "PASS"))
        {
            error = "A segment cannot be both active and passive.";
            return false;
        }

        if (!AtMostOne(features, "MOOD:JUS", "MOOD:SUBJ"))
        {
            error = "An imperfect verb cannot carry two moods.";
            return false;
        }

        if (features.Any(feature => feature.StartsWith("MOOD:", StringComparison.Ordinal))
            && !features.Contains("IMPF", StringComparer.Ordinal))
        {
            error = "Mood is only applicable to an imperfect verb.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    private static bool AtMostOne(
        IReadOnlyCollection<string> features,
        params string[] alternatives) =>
        alternatives.Count(feature => features.Contains(feature, StringComparer.Ordinal)) <= 1;
}
