using System.Security.Cryptography;
using System.Text;

namespace Adg.QuranicCorpus;

public static class QacMorphologyVerifier
{
    public const long ExpectedSegmentCountV04 = 128_219;
    public const long ExpectedWordCountV04 = 77_429;
    public const long ExpectedVerseCountV04 = 6_236;
    public const long ExpectedChapterCountV04 = 114;

    public static QacVerificationReport VerifyFile(
        string path,
        QacVerificationOptions? options = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException("QAC morphology file was not found.", fullPath);
        }

        string sha256;
        using (var hashStream = File.OpenRead(fullPath))
        {
            sha256 = Convert.ToHexString(SHA256.HashData(hashStream)).ToLowerInvariant();
        }

        using var stream = File.OpenRead(fullPath);
        using var reader = new StreamReader(
            stream,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
            detectEncodingFromByteOrderMarks: true);
        return Verify(reader, sha256, options);
    }

    public static QacVerificationReport Verify(
        TextReader reader,
        string inputSha256,
        QacVerificationOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(reader);
        options ??= new QacVerificationOptions();
        if (options.MaxReportedErrors < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                "MaxReportedErrors must be positive.");
        }

        var errors = new List<QacIssue>();
        long errorCount = 0;
        var tagCounts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var featureCounts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var segmentKindCounts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var faRoleCounts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var chapters = new HashSet<int>();
        var verses = new HashSet<QacVerseKey>();
        var distinctForms = new HashSet<string>(StringComparer.Ordinal);
        var leaves = new List<byte[]>();
        var arabicFormLeaves = new List<byte[]>();
        var currentWord = new List<QacMorphologyRecord>(5);
        QacWordKey? currentWordKey = null;
        QacLocation? previousLocation = null;
        long dataRowCount = 0;
        long validSegmentCount = 0;
        long wordCount = 0;
        long causalFaCount = 0;
        long causalFaDirectImperfectCount = 0;
        long causalFaDirectImperfectSubjunctiveCount = 0;
        long causalFaOtherContinuationCount = 0;
        long mappedSegmentCount = 0;
        long emptyElidedFormCount = 0;
        long spacedFormCount = 0;
        var headerFound = false;
        var qacNoticeFound = false;
        var tanzilNoticeFound = false;
        var lineNumber = 0;

        void AddIssue(string code, int line, string message)
        {
            errorCount++;
            if (errors.Count < options.MaxReportedErrors)
            {
                errors.Add(new QacIssue(code, line, message));
            }
        }

        void Increment(IDictionary<string, long> counts, string key)
        {
            counts.TryGetValue(key, out var count);
            counts[key] = count + 1;
        }

        void FinalizeWord()
        {
            if (currentWord.Count == 0)
            {
                return;
            }

            wordCount++;
            if (!currentWord.Any(record => record.SegmentKind == QacSegmentKind.Stem))
            {
                AddIssue(
                    "QAC-STR0001",
                    currentWord[0].SourceLine,
                    $"Word {currentWord[0].Location.WordKey} has no STEM segment.");
            }

            var previousRank = -1;
            for (var index = 0; index < currentWord.Count; index++)
            {
                var record = currentWord[index];
                if (record.Location.Segment != index + 1)
                {
                    AddIssue(
                        "QAC-STR0002",
                        record.SourceLine,
                        $"Expected segment {index + 1} in word {record.Location.WordKey}.");
                }

                var rank = record.SegmentKind switch
                {
                    QacSegmentKind.Prefix => 0,
                    QacSegmentKind.Stem => 1,
                    QacSegmentKind.Suffix => 2,
                    _ => throw new InvalidOperationException(),
                };
                if (rank < previousRank)
                {
                    AddIssue(
                        "QAC-STR0003",
                        record.SourceLine,
                        $"Segment order regressed inside word {record.Location.WordKey}.");
                }

                previousRank = rank;

                if (record.Features.Count > 1
                    && record.Features[1].StartsWith("f:", StringComparison.Ordinal))
                {
                    Increment(faRoleCounts, record.Features[1]);
                }

                if (record.Tag != "CAUS")
                {
                    continue;
                }

                causalFaCount++;
                var continuation = index + 1 < currentWord.Count
                    ? currentWord[index + 1]
                    : null;
                if (continuation is not null
                    && continuation.Tag == "V"
                    && continuation.Features.Contains("IMPF", StringComparer.Ordinal))
                {
                    causalFaDirectImperfectCount++;
                    if (continuation.Features.Contains("MOOD:SUBJ", StringComparer.Ordinal))
                    {
                        causalFaDirectImperfectSubjunctiveCount++;
                    }
                    else
                    {
                        AddIssue(
                            "QAC-GR1001",
                            continuation.SourceLine,
                            "An imperfect verb directly following f:CAUS+ must be subjunctive.");
                    }
                }
                else
                {
                    causalFaOtherContinuationCount++;
                }
            }

            currentWord.Clear();
        }

        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            lineNumber++;
            if (line.Contains(
                    "Quranic Arabic Corpus (morphology, version 0.4)",
                    StringComparison.Ordinal))
            {
                qacNoticeFound = true;
            }

            if (line.Contains(
                    "Tanzil Quran Text (Uthmani, version 1.0.2)",
                    StringComparison.Ordinal))
            {
                tanzilNoticeFound = true;
            }

            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            if (line == "LOCATION\tFORM\tTAG\tFEATURES")
            {
                if (headerFound)
                {
                    AddIssue("QAC-FILE0001", lineNumber, "Duplicate morphology header.");
                }

                headerFound = true;
                continue;
            }

            if (!headerFound)
            {
                AddIssue(
                    "QAC-FILE0002",
                    lineNumber,
                    "Data appeared before the LOCATION/FORM/TAG/FEATURES header.");
                continue;
            }

            dataRowCount++;
            if (!QacMorphologyParser.TryParseRecord(
                    line,
                    lineNumber,
                    out var record,
                    out var parseIssue))
            {
                AddIssue(
                    parseIssue!.Code,
                    parseIssue.Line,
                    parseIssue.Message);
                continue;
            }

            var parsedRecord = record!;
            if (previousLocation is not null
                && parsedRecord.Location.CompareTo(previousLocation.Value) <= 0)
            {
                AddIssue(
                    "QAC-STR0004",
                    lineNumber,
                    $"Location {parsedRecord.Location} is not strictly after {previousLocation.Value}.");
            }

            if (currentWordKey is null
                || currentWordKey.Value != parsedRecord.Location.WordKey)
            {
                FinalizeWord();
                currentWordKey = parsedRecord.Location.WordKey;
            }

            currentWord.Add(parsedRecord);
            previousLocation = parsedRecord.Location;
            validSegmentCount++;
            chapters.Add(parsedRecord.Location.Chapter);
            verses.Add(parsedRecord.Location.VerseKey);
            leaves.Add(QacMerkle.HashRecord(parsedRecord));
            Increment(tagCounts, parsedRecord.Tag);
            Increment(segmentKindCounts, parsedRecord.SegmentKind.ToString());
            foreach (var feature in parsedRecord.Features)
            {
                Increment(featureCounts, feature);
            }

            if (parsedRecord.Form.Length == 0)
            {
                emptyElidedFormCount++;
            }
            else
            {
                try
                {
                    var arabic = ExtendedBuckwalter.Decode(parsedRecord.Form);
                    if (ExtendedBuckwalter.Encode(arabic) != parsedRecord.Form)
                    {
                        AddIssue(
                            "QAC-BW0001",
                            parsedRecord.SourceLine,
                            $"Extended Buckwalter round-trip failed for '{parsedRecord.Form}'.");
                    }
                    else
                    {
                        mappedSegmentCount++;
                        arabicFormLeaves.Add(
                            SHA256.HashData(
                                Encoding.UTF8.GetBytes(
                                    string.Concat(
                                        parsedRecord.Location.ToString(),
                                        "\t",
                                        arabic))));
                    }
                }
                catch (FormatException exception)
                {
                    AddIssue("QAC-BW0002", parsedRecord.SourceLine, exception.Message);
                }
            }

            if (parsedRecord.Form.Contains(' ', StringComparison.Ordinal))
            {
                spacedFormCount++;
            }

            distinctForms.Add(parsedRecord.Form);
        }

        FinalizeWord();

        if (!headerFound)
        {
            AddIssue(
                "QAC-FILE0003",
                0,
                "The LOCATION/FORM/TAG/FEATURES header was not found.");
        }

        if (options.RequireOfficialNotices && !qacNoticeFound)
        {
            AddIssue(
                "QAC-LIC0001",
                0,
                "The required Quranic Arabic Corpus v0.4 notice was not found.");
        }

        if (options.RequireOfficialNotices && !tanzilNoticeFound)
        {
            AddIssue(
                "QAC-LIC0002",
                0,
                "The required Tanzil Uthmani v1.0.2 notice was not found.");
        }

        if (options.RequireQacV04Coverage)
        {
            RequireCount("segments", validSegmentCount, ExpectedSegmentCountV04);
            RequireCount("words", wordCount, ExpectedWordCountV04);
            RequireCount("verses", verses.Count, ExpectedVerseCountV04);
            RequireCount("chapters", chapters.Count, ExpectedChapterCountV04);
        }

        return new QacVerificationReport
        {
            CatalogId = QacMorphologyCatalog.CatalogId,
            InputSha256 = inputSha256,
            DataRowCount = dataRowCount,
            ValidSegmentCount = validSegmentCount,
            WordCount = wordCount,
            VerseCount = verses.Count,
            ChapterCount = chapters.Count,
            RecordMerkleRoot = QacMerkle.ComputeRoot(leaves),
            HeaderFound = headerFound,
            QacNoticeFound = qacNoticeFound,
            TanzilNoticeFound = tanzilNoticeFound,
            TagCounts = tagCounts,
            SegmentKindCounts = segmentKindCounts,
            FeatureCounts = featureCounts,
            GrammarEvidence = new QacGrammarEvidence
            {
                FaRoleCounts = faRoleCounts,
                CausalFaCount = causalFaCount,
                CausalFaDirectImperfectCount = causalFaDirectImperfectCount,
                CausalFaDirectImperfectSubjunctiveCount =
                    causalFaDirectImperfectSubjunctiveCount,
                CausalFaOtherContinuationCount = causalFaOtherContinuationCount,
            },
            TransliterationEvidence = new QacTransliterationEvidence
            {
                MappedSegmentCount = mappedSegmentCount,
                EmptyElidedFormCount = emptyElidedFormCount,
                SpacedFormCount = spacedFormCount,
                DistinctFormCount = distinctForms.Count,
                ArabicFormMerkleRoot = QacMerkle.ComputeRoot(arabicFormLeaves),
            },
            ErrorCount = errorCount,
            Errors = errors,
        };

        void RequireCount(string name, long actual, long expected)
        {
            if (actual != expected)
            {
                AddIssue(
                    "QAC-COV0001",
                    0,
                    $"Expected {expected} {name} for QAC v0.4 but found {actual}.");
            }
        }
    }
}
