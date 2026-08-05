namespace Adg.NativeCompiler;

/// <summary>
/// Deterministic, declared text-refinement model. A refiner only ever applies
/// transformations that are written explicitly in the source: it is not an AI
/// diacritizer. Every lexicon entry and normalization flag is verifiable.
/// </summary>
internal enum NormalizationFlag
{
    CollapseSpaces,
    RemoveTatweel,
    StripTashkeel
}

/// <summary>
/// One vowelization rule. <see cref="BareSkeleton"/> is the lookup key (the
/// consonantal skeleton of <see cref="OriginalBare"/>); <see cref="Voweled"/> is
/// the declared output form.
/// </summary>
internal sealed record LexiconEntry(string BareSkeleton, string Voweled, string OriginalBare);

internal sealed record RefinerDefinition(
    string Name,
    IReadOnlyList<LexiconEntry> Lexicon,
    IReadOnlySet<NormalizationFlag> Flags,
    bool ConservationGate);

internal sealed record AdgRefinerProgram(
    IReadOnlyList<RefinerDefinition> Refiners,
    string RunTarget)
{
    public RefinerDefinition? FindRefiner(string name)
    {
        foreach (var refiner in Refiners)
        {
            if (string.Equals(refiner.Name, name, StringComparison.Ordinal))
            {
                return refiner;
            }
        }

        return null;
    }
}
