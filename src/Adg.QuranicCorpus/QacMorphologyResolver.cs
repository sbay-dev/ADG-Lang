namespace Adg.QuranicCorpus;

public static class QacMorphologyResolver
{
    public static QacNormalizedMorphologyRecord Resolve(QacMorphologyRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        var features = record.Features;
        var hasVerbalDerivation = record.Tag == "V"
            || features.Contains("PCPL", StringComparer.Ordinal)
            || features.Contains("VN", StringComparer.Ordinal);

        return new QacNormalizedMorphologyRecord(
            record.Location.ToString(),
            record.Form,
            record.Tag,
            record.SegmentKind.ToString(),
            features,
            FeatureValue(features, "LEM:"),
            FeatureValue(features, "ROOT:"),
            FeatureValue(features, "SP:"),
            features.FirstOrDefault(QacMorphologyCatalog.PersonGenderNumberValues.Contains),
            FeatureValue(features, "PRON:"),
            FirstPresent(features, "PERF", "IMPF", "IMPV"),
            ResolveMood(features),
            hasVerbalDerivation
                ? features.Contains("PASS", StringComparer.Ordinal) ? "PASS" : "ACT"
                : null,
            hasVerbalDerivation ? ResolveVerbForm(features) : null,
            ResolveDerivation(features),
            FirstPresent(features, "NOM", "ACC", "GEN"),
            FirstPresent(features, "DEF", "INDEF"));
    }

    private static string? ResolveMood(IReadOnlyCollection<string> features)
    {
        if (!features.Contains("IMPF", StringComparer.Ordinal))
        {
            return null;
        }

        if (features.Contains("MOOD:SUBJ", StringComparer.Ordinal))
        {
            return "SUBJ";
        }

        return features.Contains("MOOD:JUS", StringComparer.Ordinal) ? "JUS" : "IND";
    }

    private static string ResolveVerbForm(IReadOnlyCollection<string> features)
    {
        var form = features.FirstOrDefault(QacMorphologyCatalog.VerbForms.Contains);
        return form is null ? "I" : form[1..^1];
    }

    private static string? ResolveDerivation(IReadOnlyCollection<string> features)
    {
        if (features.Contains("PCPL", StringComparer.Ordinal))
        {
            return features.Contains("PASS", StringComparer.Ordinal)
                ? "PASS_PCPL"
                : "ACT_PCPL";
        }

        return features.Contains("VN", StringComparer.Ordinal) ? "VN" : null;
    }

    private static string? FeatureValue(
        IEnumerable<string> features,
        string prefix)
    {
        foreach (var feature in features)
        {
            if (QacMorphologyCatalog.TryGetFeatureValue(feature, prefix, out var value))
            {
                return value;
            }
        }

        return null;
    }

    private static string? FirstPresent(
        IReadOnlyCollection<string> features,
        params string[] candidates) =>
        candidates.FirstOrDefault(candidate =>
            features.Contains(candidate, StringComparer.Ordinal));
}
