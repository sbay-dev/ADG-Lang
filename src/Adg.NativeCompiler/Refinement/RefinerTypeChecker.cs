namespace Adg.NativeCompiler;

internal static class RefinerTypeChecker
{
    public static void Check(AdgRefinerProgram program)
    {
        if (program.Refiners.Count == 0 || string.IsNullOrEmpty(program.RunTarget))
        {
            throw new AdgTypeException(
                DiagnosticCode.EmptyRefinerProgram,
                $"An ADG refiner program must declare at least one '{RefinerSyntax.RefinerKeyword}' and one " +
                $"'{RefinerSyntax.RunKeyword}' so the native module has an entry point.");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var refiner in program.Refiners)
        {
            if (!seen.Add(refiner.Name))
            {
                throw new AdgTypeException(
                    DiagnosticCode.DuplicateFunctionName,
                    $"Refiner '{refiner.Name}' is defined more than once.");
            }

            CheckRefiner(refiner);
        }

        if (program.FindRefiner(program.RunTarget) is null)
        {
            throw new AdgTypeException(
                DiagnosticCode.UndefinedRefinerApplication,
                $"'{RefinerSyntax.RunKeyword}' references undefined refiner '{program.RunTarget}'.");
        }
    }

    private static void CheckRefiner(RefinerDefinition refiner)
    {
        if (refiner.Lexicon.Count == 0 && refiner.Flags.Count == 0)
        {
            throw new AdgTypeException(
                DiagnosticCode.EmptyRefiner,
                $"Refiner '{refiner.Name}' has no lexicon entries and no normalization rules; it would do nothing.");
        }

        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in refiner.Lexicon)
        {
            if (!keys.Add(entry.BareSkeleton))
            {
                throw new AdgTypeException(
                    DiagnosticCode.DuplicateLexiconEntry,
                    $"Refiner '{refiner.Name}' maps the word '{entry.OriginalBare}' more than once.");
            }

            if (refiner.ConservationGate)
            {
                var voweledSkeleton = ArabicText.Skeletonize(entry.Voweled);
                if (!string.Equals(voweledSkeleton, entry.BareSkeleton, StringComparison.Ordinal))
                {
                    throw new AdgTypeException(
                        DiagnosticCode.SkeletonConservationViolation,
                        $"Vowelization of '{entry.OriginalBare}' to '{entry.Voweled}' changes the consonantal skeleton " +
                        $"('{entry.BareSkeleton}' vs '{voweledSkeleton}'), violating the '{RefinerSyntax.GuaranteeKeyword} {RefinerSyntax.VocalicLabel}' guarantee.");
                }
            }
        }
    }
}
