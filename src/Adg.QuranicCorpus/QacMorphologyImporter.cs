using System.Text;
using System.Text.Json;

namespace Adg.QuranicCorpus;

public static class QacMorphologyImporter
{
    private static readonly JsonSerializerOptions CompactJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly JsonSerializerOptions ReportJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static QacImportResult ImportFile(
        string inputPath,
        string outputDirectory,
        string sourceKind,
        bool requireFullV04Coverage)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(inputPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(outputDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceKind);

        var fullInputPath = Path.GetFullPath(inputPath);
        var fullOutputDirectory = Path.GetFullPath(outputDirectory);
        if (string.Equals(
                fullInputPath.TrimEnd(Path.DirectorySeparatorChar),
                fullOutputDirectory.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "The derived output directory must not overwrite the raw source file.");
        }

        var report = QacMorphologyVerifier.VerifyFile(
            fullInputPath,
            new QacVerificationOptions
            {
                RequireOfficialNotices = true,
                RequireQacV04Coverage = requireFullV04Coverage,
            });
        if (!report.IsValid)
        {
            throw new InvalidDataException(
                $"QAC morphology verification failed with {report.ErrorCount} error(s).");
        }

        Directory.CreateDirectory(fullOutputDirectory);
        var recordsPath = Path.Combine(
            fullOutputDirectory,
            "qac-morphology-v0.4.records.jsonl");
        var reportPath = Path.Combine(
            fullOutputDirectory,
            "qac-morphology-v0.4.report.json");
        var sourcePath = Path.Combine(fullOutputDirectory, "SOURCE.json");
        var licensePath = Path.Combine(fullOutputDirectory, "LICENSE-DATA.txt");
        var temporaryRecordsPath = recordsPath + ".tmp";

        try
        {
            using (var stream = new FileStream(
                       temporaryRecordsPath,
                       FileMode.Create,
                       FileAccess.Write,
                       FileShare.None))
            using (var writer = new StreamWriter(
                       stream,
                       new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
            {
                var metadata = new
                {
                    recordType = "metadata",
                    catalogId = QacMorphologyCatalog.CatalogId,
                    sourceName = QacAttribution.SourceName,
                    sourceUrl = QacAttribution.SourceUrl,
                    sourceVersion = QacAttribution.Version,
                    sourceKind,
                    report.InputSha256,
                    report.RecordMerkleRoot,
                    licenseFile = Path.GetFileName(licensePath),
                };
                writer.WriteLine(JsonSerializer.Serialize(metadata, CompactJson));

                foreach (var record in ReadRecords(fullInputPath))
                {
                    writer.WriteLine(
                        JsonSerializer.Serialize(
                            QacMorphologyResolver.Resolve(record),
                            CompactJson));
                }
            }

            File.Move(temporaryRecordsPath, recordsPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryRecordsPath))
            {
                File.Delete(temporaryRecordsPath);
            }
        }

        File.WriteAllText(
            reportPath,
            JsonSerializer.Serialize(report, ReportJson) + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.WriteAllText(
            sourcePath,
            JsonSerializer.Serialize(
                new
                {
                    sourceName = QacAttribution.SourceName,
                    sourceUrl = QacAttribution.SourceUrl,
                    sourceVersion = QacAttribution.Version,
                    sourceKind,
                    rawFile = Path.GetFileName(fullInputPath),
                    report.InputSha256,
                    report.RecordMerkleRoot,
                    upstreamChecksumPublished = false,
                },
                ReportJson) + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.WriteAllText(
            licensePath,
            QacAttribution.ReadRequiredNotice(),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        return new QacImportResult(
            recordsPath,
            reportPath,
            sourcePath,
            licensePath,
            report);
    }

    public static IEnumerable<QacMorphologyRecord> ReadRecords(string path)
    {
        using var stream = File.OpenRead(path);
        using var reader = new StreamReader(
            stream,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
            detectEncodingFromByteOrderMarks: true);
        var headerFound = false;
        var lineNumber = 0;
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            lineNumber++;
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            if (line == "LOCATION\tFORM\tTAG\tFEATURES")
            {
                headerFound = true;
                continue;
            }

            if (!headerFound)
            {
                continue;
            }

            if (!QacMorphologyParser.TryParseRecord(
                    line,
                    lineNumber,
                    out var record,
                    out var issue))
            {
                throw new InvalidDataException(
                    $"{issue!.Code} at line {issue.Line}: {issue.Message}");
            }

            yield return record!;
        }
    }
}
