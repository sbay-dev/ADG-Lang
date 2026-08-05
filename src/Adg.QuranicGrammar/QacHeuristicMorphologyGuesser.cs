using Adg.QuranicCore;
using Adg.QuranicCorpus;
using static Adg.QuranicGrammar.QacMorphologySelectionScorePolicy;

namespace Adg.QuranicGrammar;

public interface IQacUnknownMorphologyProvider
{
    IReadOnlyList<QacLexicalCandidate> Guess(
        string surface,
        string normalizedSurface);
}

public sealed class QacHeuristicMorphologyGuesser : IQacUnknownMorphologyProvider
{
    public const string RuleSetId = "adg-natural-arabic-rules-v1";

    private static readonly HashSet<string> KnownPerfectVerbs =
        new(StringComparer.Ordinal)
        {
            "اكد",
            "اضاف",
            "اعلن",
            "اشار",
            "اوضح",
            "اعرب",
            "اعتبر",
            "انتقد",
            "ارتفع",
            "بدا",
            "بلغ",
            "تابع",
            "تم",
            "توقع",
            "دعا",
            "ذكر",
            "شدد",
            "حقق",
            "رفض",
            "سمح",
            "طالب",
            "طلب",
            "قرر",
            "قال",
            "نفى",
            "وقع",
            "وصل",
        };

    private static readonly HashSet<string> CommonAdjectives =
        new(StringComparer.Ordinal)
        {
            "اخر",
            "اخيرة",
            "اوسط",
            "افضل",
            "اول",
            "ثاني",
            "ثالث",
            "جديد",
            "جديدة",
            "حالي",
            "حالية",
            "خاص",
            "خاصة",
            "رئيسي",
            "سابق",
            "سابقة",
            "سنوي",
            "صغير",
            "صغيرة",
            "عام",
            "عامة",
            "عديد",
            "كبير",
            "كبيرة",
            "مباشر",
            "مباشرة",
            "مختلف",
            "مختلفة",
            "مشترك",
            "مشتركة",
            "مقبل",
            "مقبلة",
            "متحد",
            "متحدة",
            "ممكن",
            "واسع",
            "واسعة",
            "واضح",
            "واضحة",
        };

    private static readonly IReadOnlyDictionary<string, ClosedWord> ClosedWords =
        CreateClosedWords();

    public IReadOnlyList<QacLexicalCandidate> Guess(
        string surface,
        string normalizedSurface)
    {
        if (normalizedSurface.Length == 0)
        {
            return [];
        }

        if (ClosedWords.TryGetValue(normalizedSurface, out var closed))
        {
            return
            [
                CreateCandidate(
                    surface,
                    normalizedSurface,
                    closed.Tag,
                    ["STEM", $"POS:{closed.Tag}"],
                    closed.SelectionScore,
                    aspect: closed.Aspect,
                    mood: closed.Mood,
                    voice: closed.Voice,
                    verbForm: closed.VerbForm,
                    specialClass: closed.SpecialClass),
            ];
        }

        var candidates = new List<QacLexicalCandidate>();
        var definite = normalizedSurface.StartsWith("ال", StringComparison.Ordinal);
        var likelyAdjective = LooksLikeAdjective(normalizedSurface);
        AddNominal(
            candidates,
            surface,
            normalizedSurface,
            "N",
            definite,
            selectionScore: HeuristicNominalNounScore);
        AddNominal(
            candidates,
            surface,
            normalizedSurface,
            "ADJ",
            definite,
            selectionScore: likelyAdjective
                ? HeuristicLikelyAdjectiveScore
                : HeuristicFallbackAdjectiveScore);
        AddNominal(
            candidates,
            surface,
            normalizedSurface,
            "PN",
            definite: true,
            selectionScore: HeuristicProperNounScore);

        if (LooksLikeImperfect(normalizedSurface))
        {
            candidates.Add(
                CreateCandidate(
                    surface,
                    normalizedSurface,
                    "V",
                    ["STEM", "POS:V", "IMPF"],
                    ImperfectSelectionScore(normalizedSurface),
                    aspect: "IMPF",
                    mood: "IND",
                    voice: "ACT",
                    verbForm: "I"));
        }

        if (LooksLikePerfect(normalizedSurface))
        {
            candidates.Add(
                CreateCandidate(
                    surface,
                    normalizedSurface,
                    "V",
                    ["STEM", "POS:V", "PERF"],
                    HeuristicPerfectVerbScore,
                    aspect: "PERF",
                    voice: "ACT",
                    verbForm: "I"));
        }

        AddCliticVerbCandidate(candidates, surface, normalizedSurface);
        AddCliticNominalCandidates(candidates, surface, normalizedSurface);

        return candidates
            .OrderByDescending(candidate => candidate.SelectionScore)
            .ThenBy(candidate => candidate.MorphologySignature, StringComparer.Ordinal)
            .ToArray();
    }

    private static void AddNominal(
        ICollection<QacLexicalCandidate> candidates,
        string surface,
        string normalizedSurface,
        string tag,
        bool definite,
        int selectionScore)
    {
        var features = new List<string> { "STEM", $"POS:{tag}" };
        if (definite)
        {
            features.Add("DEF");
        }

        candidates.Add(
            CreateCandidate(
                surface,
                normalizedSurface,
                tag,
                features,
                selectionScore,
                state: definite ? "DEF" : null));
    }

    private static QacLexicalCandidate CreateCandidate(
        string surface,
        string normalizedSurface,
        string tag,
        IReadOnlyList<string> features,
        int selectionScore,
        string? aspect = null,
        string? mood = null,
        string? voice = null,
        string? verbForm = null,
        string? state = null,
        string? specialClass = null)
    {
        var morphology = new QacNormalizedMorphologyRecord(
            "natural:heuristic",
            string.Empty,
            tag,
            "Stem",
            features,
            normalizedSurface,
            null,
            specialClass,
            null,
            null,
            aspect,
            mood,
            voice,
            verbForm,
            null,
            null,
            state);
        return new QacLexicalCandidate(
            surface,
            normalizedSurface,
            $"HEURISTIC:{tag}:{string.Join(',', features.Skip(2))}",
            QacMorphologyCandidateSource.Heuristic,
            0,
            "natural:heuristic",
            [morphology],
            selectionScore);
    }

    private static bool LooksLikeImperfect(string value) =>
        value.Length >= 4
        && !value.StartsWith("ال", StringComparison.Ordinal)
        && (!value.EndsWith("و", StringComparison.Ordinal)
            || value.EndsWith("وا", StringComparison.Ordinal))
        && value[0] is 'أ' or 'ا' or 'ن' or 'ي' or 'ت';

    private static bool LooksLikePerfect(string value) =>
        KnownPerfectVerbs.Contains(value)
        || value.Length >= 4
        && !value.StartsWith("ال", StringComparison.Ordinal)
        && (!value.EndsWith("ات", StringComparison.Ordinal)
            && !value.EndsWith("يات", StringComparison.Ordinal))
        && (value.EndsWith("ت", StringComparison.Ordinal)
            || value.EndsWith("وا", StringComparison.Ordinal)
            || value.EndsWith("نا", StringComparison.Ordinal));

    private static bool LooksLikeAdjective(string value)
    {
        var stem = value.StartsWith("ال", StringComparison.Ordinal)
            ? value[2..]
            : value;
        return CommonAdjectives.Contains(stem)
            || stem.Length >= 3
            && (stem.EndsWith("ي", StringComparison.Ordinal)
                || stem.EndsWith("ية", StringComparison.Ordinal)
                || stem.EndsWith("يون", StringComparison.Ordinal)
                || stem.EndsWith("يين", StringComparison.Ordinal));
    }

    private static int ImperfectSelectionScore(string value) =>
        value[0] switch
        {
            'ي' => HeuristicImperfectYaScore,
            'ت' => HeuristicImperfectTaScore,
            'ن' => HeuristicImperfectNunScore,
            _ => HeuristicImperfectOtherScore,
        };

    private static void AddCliticVerbCandidate(
        ICollection<QacLexicalCandidate> candidates,
        string surface,
        string normalizedSurface)
    {
        var remainder = normalizedSurface;
        var prefixes = new List<string>();
        if (remainder.Length > 4 && remainder[0] is 'و' or 'ف')
        {
            prefixes.Add("CONJ");
            remainder = remainder[1..];
        }

        if (remainder.Length > 4
            && remainder[0] == 'س'
            && LooksLikeImperfect(remainder[1..]))
        {
            prefixes.Add("FUT");
            remainder = remainder[1..];
        }
        else if (remainder.Length > 4
                 && remainder[0] == 'ل'
                 && LooksLikeImperfect(remainder[1..]))
        {
            prefixes.Add("P");
            remainder = remainder[1..];
        }

        if (prefixes.Count == 0)
        {
            return;
        }

        var perfect = KnownPerfectVerbs.Contains(remainder)
            || LooksLikePerfect(remainder);
        var imperfect = !perfect && LooksLikeImperfect(remainder);
        if (!perfect && !imperfect)
        {
            return;
        }

        var segments = prefixes
            .Select(tag => CreateMorphology(
                tag,
                nameof(QacSegmentKind.Prefix),
                ["PREFIX", $"POS:{tag}"],
                null,
                null,
                null,
                null))
            .ToList();
        segments.Add(
            CreateMorphology(
                "V",
                nameof(QacSegmentKind.Stem),
                ["STEM", "POS:V", perfect ? "PERF" : "IMPF"],
                perfect ? "PERF" : "IMPF",
                perfect ? null : "IND",
                "ACT",
                "I"));
        candidates.Add(
            new QacLexicalCandidate(
                surface,
                normalizedSurface,
                $"HEURISTIC:{string.Join('+', prefixes)}+V:"
                + (perfect ? "PERF" : "IMPF"),
                QacMorphologyCandidateSource.Heuristic,
                0,
                "natural:heuristic",
                segments,
                HeuristicCliticVerbScore));
    }

    private static void AddCliticNominalCandidates(
        ICollection<QacLexicalCandidate> candidates,
        string surface,
        string normalizedSurface)
    {
        var remainder = normalizedSurface;
        var prefixes = new List<string>();
        if (remainder.Length > 4
            && remainder[0] is 'و' or 'ف'
            && (remainder[1..].StartsWith("ال", StringComparison.Ordinal)
                || remainder[1..].StartsWith("بال", StringComparison.Ordinal)
                || remainder[1..].StartsWith("كال", StringComparison.Ordinal)
                || remainder[1..].StartsWith("لل", StringComparison.Ordinal)))
        {
            prefixes.Add("CONJ");
            remainder = remainder[1..];
        }

        if (remainder.StartsWith("بال", StringComparison.Ordinal)
            || remainder.StartsWith("كال", StringComparison.Ordinal))
        {
            prefixes.Add("P");
            prefixes.Add("DET");
            remainder = remainder[3..];
        }
        else if (remainder.StartsWith("لل", StringComparison.Ordinal))
        {
            prefixes.Add("P");
            prefixes.Add("DET");
            remainder = remainder[2..];
        }
        else if (remainder.StartsWith("ال", StringComparison.Ordinal)
                 && prefixes.Count > 0)
        {
            prefixes.Add("DET");
            remainder = remainder[2..];
        }

        if (prefixes.Count == 0 || remainder.Length < 2)
        {
            return;
        }

        var hasPreposition = prefixes.Contains("P", StringComparer.Ordinal);
        AddCliticNominalCandidate(
            candidates,
            surface,
            normalizedSurface,
            remainder,
            prefixes,
            "N",
            hasPreposition
                ? HeuristicPrepositionalCliticNounScore
                : HeuristicCliticNounScore);
        AddCliticNominalCandidate(
            candidates,
            surface,
            normalizedSurface,
            remainder,
            prefixes,
            "ADJ",
            LooksLikeAdjective(remainder)
                ? hasPreposition
                    ? HeuristicLikelyPrepositionalCliticAdjectiveScore
                    : HeuristicLikelyCliticAdjectiveScore
                : hasPreposition
                    ? HeuristicFallbackPrepositionalCliticAdjectiveScore
                    : HeuristicFallbackCliticAdjectiveScore);
    }

    private static void AddCliticNominalCandidate(
        ICollection<QacLexicalCandidate> candidates,
        string surface,
        string normalizedSurface,
        string stem,
        IReadOnlyList<string> prefixes,
        string tag,
        int selectionScore)
    {
        var segments = prefixes
            .Select(prefix => CreateMorphology(
                prefix,
                nameof(QacSegmentKind.Prefix),
                ["PREFIX", $"POS:{prefix}"],
                null,
                null,
                null,
                null))
            .ToList();
        segments.Add(
            new QacNormalizedMorphologyRecord(
                "natural:heuristic",
                string.Empty,
                tag,
                nameof(QacSegmentKind.Stem),
                ["STEM", $"POS:{tag}", "DEF"],
                stem,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                "DEF"));
        candidates.Add(
            new QacLexicalCandidate(
                surface,
                normalizedSurface,
                $"HEURISTIC:{string.Join('+', prefixes)}+{tag}",
                QacMorphologyCandidateSource.Heuristic,
                0,
                "natural:heuristic",
                segments,
                selectionScore));
    }

    private static QacNormalizedMorphologyRecord CreateMorphology(
        string tag,
        string segmentKind,
        IReadOnlyList<string> features,
        string? aspect,
        string? mood,
        string? voice,
        string? verbForm) =>
        new(
            "natural:heuristic",
            string.Empty,
            tag,
            segmentKind,
            features,
            null,
            null,
            null,
            null,
            null,
            aspect,
            mood,
            voice,
            verbForm,
            null,
            null,
            null);

    private static IReadOnlyDictionary<string, ClosedWord> CreateClosedWords()
    {
        var words = new Dictionary<string, ClosedWord>(StringComparer.Ordinal);

        Add(words, "P", HeuristicClosedFunctionWordScore,
            "في", "من", "الى", "إلى", "عن", "على", "ب", "ك", "ل",
            "خلال", "منذ", "مذ", "ضد", "دون", "عبر", "حول", "بين",
            "امام", "أمام", "خلف", "تحت", "فوق", "لدى", "عند", "مع",
            "نحو", "مقابل", "رغم");
        Add(words, "CONJ", HeuristicClosedFunctionWordScore,
            "و", "ف", "ثم", "او", "أو", "ام", "أم", "بل", "لكن");
        Add(
            words,
            "NEG",
            HeuristicClosedFunctionWordScore,
            "لا",
            "لم",
            "لن",
            "ما",
            "ليس");
        Add(words, "INTG", HeuristicClosedFunctionWordScore, "هل");
        Add(words, "VOC", HeuristicClosedFunctionWordScore, "يا");
        Add(words, "FUT", HeuristicClosedFunctionWordScore, "سوف");
        Add(words, "SUB", HeuristicClosedFunctionWordScore,
            "اذا", "إذا", "اذ", "إذ", "لو", "لولا", "كي", "لكي",
            "حيث", "حينما", "بينما");
        Add(words, "PRON", HeuristicClosedFunctionWordScore,
            "انا", "أنا", "نحن", "انت", "أنت", "انتم", "أنتم",
            "هو", "هي", "هما", "هم", "هن");
        Add(words, "DEM", HeuristicClosedFunctionWordScore,
            "هذا", "هذه", "هذان", "هاتان", "هؤلاء", "ذلك", "تلك",
            "اولئك", "أولئك");
        Add(words, "REL", HeuristicClosedFunctionWordScore,
            "الذي", "التي", "اللذان", "اللتان", "الذين", "اللاتي",
            "اللواتي");
        Add(words, "T", HeuristicClosedTemporalWordScore,
            "امس", "أمس", "اليوم", "غدا", "غداً", "الان", "الآن",
            "هناك", "هنا");

        foreach (var verb in KnownPerfectVerbs)
        {
            words[verb] = new ClosedWord(
                "V",
                HeuristicRegisteredPerfectVerbScore,
                "PERF",
                null,
                "ACT",
                "I",
                null);
        }

        return words;
    }

    private static void Add(
        IDictionary<string, ClosedWord> words,
        string tag,
        int score,
        params string[] forms)
    {
        foreach (var form in forms)
        {
            words[QuranicTextNormalizer.NormalizeForAnalysis(form)] =
                new ClosedWord(tag, score, null, null, null, null, null);
        }
    }

    private sealed record ClosedWord(
        string Tag,
        int SelectionScore,
        string? Aspect,
        string? Mood,
        string? Voice,
        string? VerbForm,
        string? SpecialClass);
}
