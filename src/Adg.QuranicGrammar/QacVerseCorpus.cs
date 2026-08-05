using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QacVerseWord(
    int Word,
    string Location,
    string Surface,
    string MorphologySignature,
    SourceRange Range);

public sealed record QacVerseText(
    int Chapter,
    int Verse,
    string Location,
    string Text,
    IReadOnlyList<QacVerseWord> Words);

public sealed class QacVerseCorpus
{
    private QacVerseCorpus(
        IReadOnlyList<QacVerseText> verses,
        string merkleRoot)
    {
        Verses = verses;
        MerkleRoot = merkleRoot;
    }

    public IReadOnlyList<QacVerseText> Verses { get; }

    public string MerkleRoot { get; }

    public static QacVerseCorpus Build(IReadOnlyList<QacWordAnalysis> words)
    {
        ArgumentNullException.ThrowIfNull(words);
        var verses = new List<QacVerseText>();
        var leaves = new List<byte[]>();
        foreach (var group in words.GroupBy(word => (word.Chapter, word.Verse)))
        {
            var builder = new StringBuilder();
            var verseWords = new List<QacVerseWord>();
            foreach (var word in group.OrderBy(word => word.Word))
            {
                if (builder.Length > 0)
                {
                    builder.Append(' ');
                }

                var start = builder.Length;
                builder.Append(word.ArabicSurface);
                verseWords.Add(
                    new QacVerseWord(
                        word.Word,
                        word.Location,
                        word.ArabicSurface,
                        word.MorphologySignature,
                        new SourceRange(start, word.ArabicSurface.Length)));
            }

            var location = FormattableString.Invariant(
                $"({group.Key.Chapter}:{group.Key.Verse})");
            var text = builder.ToString();
            verses.Add(
                new QacVerseText(
                    group.Key.Chapter,
                    group.Key.Verse,
                    location,
                    text,
                    verseWords));
            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(location, "\t", text))));
        }

        return new QacVerseCorpus(
            verses,
            QacMerkle.ComputeRoot(leaves));
    }
}
