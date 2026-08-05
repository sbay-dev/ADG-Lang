using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QacLexiconArtifactResult(
    string WordsPath,
    string SurfaceIndexPath,
    string ReportPath,
    string LicensePath,
    QacLexiconMetrics Metrics);

public static class QacLexiconArtifactWriter
{
    private static readonly JsonSerializerOptions CompactJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly JsonSerializerOptions IndentedJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static QacLexiconArtifactResult Build(
        string inputPath,
        string outputDirectory,
        string sourceKind,
        bool requireFullV04Coverage)
    {
        var verification = QacMorphologyVerifier.VerifyFile(
            inputPath,
            new QacVerificationOptions
            {
                RequireOfficialNotices = true,
                RequireQacV04Coverage = requireFullV04Coverage,
            });
        if (!verification.IsValid)
        {
            throw new InvalidDataException(
                $"QAC source failed verification with {verification.ErrorCount} error(s).");
        }

        var lexicon = QacMorphologyLexicon.Build(
            QacMorphologyImporter.ReadRecords(inputPath));
        var output = Path.GetFullPath(outputDirectory);
        Directory.CreateDirectory(output);
        var wordsPath = Path.Combine(output, "qac-word-analyses-v0.4.jsonl");
        var surfaceIndexPath = Path.Combine(output, "qac-surface-index-v0.4.jsonl");
        var reportPath = Path.Combine(output, "qac-lexicon-v0.4.report.json");
        var licensePath = Path.Combine(output, "LICENSE-DATA.txt");

        WriteJsonLines(
            wordsPath,
            new
            {
                recordType = "metadata",
                catalogId = QacMorphologyCatalog.CatalogId,
                sourceKind,
                verification.InputSha256,
                verification.RecordMerkleRoot,
                lexicon.Metrics.WordMerkleRoot,
                licenseFile = Path.GetFileName(licensePath),
            },
            lexicon.Words);

        WriteJsonLines(
            surfaceIndexPath,
            new
            {
                recordType = "metadata",
                catalogId = QacMorphologyCatalog.CatalogId,
                sourceKind,
                lexicon.Metrics.SurfaceIndexMerkleRoot,
                licenseFile = Path.GetFileName(licensePath),
            },
            lexicon.EnumerateNormalizedIndex().Select(pair => new
            {
                normalizedSurface = pair.Key,
                candidates = pair.Value,
            }));

        File.WriteAllText(
            reportPath,
            JsonSerializer.Serialize(
                new
                {
                    catalogId = QacMorphologyCatalog.CatalogId,
                    sourceKind,
                    sourceSha256 = verification.InputSha256,
                    sourceRecordMerkleRoot = verification.RecordMerkleRoot,
                    lexicon.Metrics,
                },
                IndentedJson) + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.WriteAllText(
            licensePath,
            QacAttribution.ReadRequiredNotice(),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        return new QacLexiconArtifactResult(
            wordsPath,
            surfaceIndexPath,
            reportPath,
            licensePath,
            lexicon.Metrics);
    }

    private static void WriteJsonLines<T>(
        string path,
        object metadata,
        IEnumerable<T> records)
    {
        var temporaryPath = path + ".tmp";
        try
        {
            {
                using var stream = new FileStream(
                    temporaryPath,
                    FileMode.Create,
                    FileAccess.Write,
                    FileShare.None);
                using var writer = new StreamWriter(
                    stream,
                    new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                writer.WriteLine(JsonSerializer.Serialize(metadata, CompactJson));
                foreach (var record in records)
                {
                    writer.WriteLine(JsonSerializer.Serialize(record, CompactJson));
                }
            }

            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }
}
