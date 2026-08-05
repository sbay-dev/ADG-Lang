using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;
using Adg.QuranicGrammar;
using Adg.QuranicTraining;

var json = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true,
};

try
{
    if (args.Length == 0)
    {
        PrintUsage();
        return 2;
    }

    switch (args[0])
    {
        case "verify-morphology":
            return VerifyMorphology(args[1..]);
        case "import-morphology":
            return ImportMorphology(args[1..]);
        case "build-lexicon":
            return BuildLexicon(args[1..]);
        case "evaluate-quran-morphology":
            return EvaluateQuranMorphology(args[1..]);
        case "verify-syntax":
            return VerifySyntax(args[1..]);
        case "syntax-catalog":
            return PrintSyntaxCatalog();
        case "syntax-self-test":
            return SyntaxSelfTest();
        case "syntax-property-test":
            return SyntaxPropertyTest(args[1..]);
        case "quranic-rule-inventory":
            return BuildQuranicRuleInventory(args[1..]);
        case "quranic-rule-contracts":
            return BuildQuranicRuleContracts(args[1..]);
        case "audit-quranic-phrase-contracts":
            return AuditQuranicPhraseContracts(args[1..]);
        case "audit-quranic-relation-contracts":
            return AuditQuranicRelationContracts(args[1..]);
        case "audit-quranic-lexeme-allowlists":
            return AuditQuranicLexemeAllowlists(args[1..]);
        case "quranic-score-policy":
            return WriteQuranicScorePolicy(args[1..]);
        case "build-cns-grammar-corpus":
            return BuildCnsGrammarCorpus(args[1..]);
        case "build-cns-corpus-splits":
            return BuildCnsCorpusSplits(args[1..]);
        case "build-cns-knowledge-roots":
            return BuildCnsKnowledgeRoots(args[1..]);
        case "validate-quranic-diacritics":
            return ValidateQuranicDiacritics(args[1..]);
        case "evaluate-quranic-diacritics":
            return EvaluateQuranicDiacritics(args[1..]);
        case "test-quranic-diacritic-mutations":
            return TestQuranicDiacriticMutations(args[1..]);
        case "diacritize-quranic":
            return DiacritizeQuranic(args[1..]);
        case "evaluate-quranic-diacritization":
            return EvaluateQuranicDiacritization(args[1..]);
        case "parse-grammar":
            return ParseGrammar(args[1..]);
        case "evaluate-quran-grammar":
            return EvaluateQuranGrammar(args[1..]);
        case "evaluate-quran-syntax":
            return EvaluateQuranSyntax(args[1..]);
        case "verify-ud-padt":
            return VerifyUdArabic(args[1..], UdArabicPadtSource.Descriptor);
        case "verify-ud-pud":
            return VerifyUdArabic(args[1..], UdArabicPudSource.Descriptor);
        case "evaluate-natural-arabic":
            return EvaluateNaturalArabic(args[1..]);
        case "catalog":
            return PrintCatalog();
        case "self-test":
            return SelfTest();
        default:
            Console.Error.WriteLine($"Unknown command '{args[0]}'.");
            PrintUsage();
            return 2;
    }
}
catch (Exception exception) when (
    exception is ArgumentException
    or FileNotFoundException
    or InvalidDataException
    or InvalidOperationException)
{
    Console.Error.WriteLine(exception.Message);
    return 2;
}

int VerifyMorphology(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException("verify-morphology requires an input file.");
    }

    var input = commandArgs[0];
    var fullCoverage = commandArgs.Contains("--full-v0.4", StringComparer.Ordinal);
    var report = QacMorphologyVerifier.VerifyFile(
        input,
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage = fullCoverage,
        });
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int VerifySyntax(string[] commandArgs)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            "verify-syntax requires a syntax file and a QAC morphology file.");
    }

    var morphologyReport = QacMorphologyVerifier.VerifyFile(
        commandArgs[1],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!morphologyReport.IsValid)
    {
        throw new InvalidDataException(
            $"QAC morphology verification failed with "
            + $"{morphologyReport.ErrorCount} error(s).");
    }

    var compactMorphologyIndex = Array.IndexOf(
        commandArgs,
        "--syntax-morphology");
    if (compactMorphologyIndex >= 0
        && compactMorphologyIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "--syntax-morphology requires a compact morphology path.");
    }

    var report = QacSyntaxTreebankVerifier.VerifyFile(
        commandArgs[0],
        QacMorphologyImporter.ReadRecords(commandArgs[1]),
        compactMorphologyIndex >= 0
            ? commandArgs[compactMorphologyIndex + 1]
            : null,
        commandArgs.Contains("--pinned-2023", StringComparer.Ordinal));
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int ImportMorphology(string[] commandArgs)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            "import-morphology requires an input file and output directory.");
    }

    var sourceIndex = Array.IndexOf(commandArgs, "--source");
    if (sourceIndex < 0 || sourceIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "import-morphology requires --source official|mirror|local-copy.");
    }

    var sourceKind = commandArgs[sourceIndex + 1];
    if (sourceKind is not ("official" or "mirror" or "local-copy"))
    {
        throw new ArgumentException(
            "--source must be official, mirror, or local-copy.");
    }

    var result = QacMorphologyImporter.ImportFile(
        commandArgs[0],
        commandArgs[1],
        sourceKind,
        commandArgs.Contains("--full-v0.4", StringComparer.Ordinal));
    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                result.RecordsPath,
                result.ReportPath,
                result.SourcePath,
                result.LicensePath,
                result.Report.InputSha256,
                result.Report.RecordMerkleRoot,
                result.Report.ValidSegmentCount,
                result.Report.WordCount,
            },
            json));
    return 0;
}

int PrintCatalog()
{
    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                catalogId = QacMorphologyCatalog.CatalogId,
                sources = QacMorphologyCatalog.Sources,
                tags = QacMorphologyCatalog.Tags.Values
                    .OrderBy(tag => tag.Code, StringComparer.Ordinal),
                literalFeatures = QacMorphologyCatalog.LiteralFeatures
                    .OrderBy(feature => feature, StringComparer.Ordinal),
                personGenderNumberValues =
                    QacMorphologyCatalog.PersonGenderNumberValues
                        .OrderBy(value => value, StringComparer.Ordinal),
                verbForms = QacMorphologyCatalog.VerbForms
                    .OrderBy(value => value, StringComparer.Ordinal),
                specialClasses = QacMorphologyCatalog.SpecialClasses
                    .OrderBy(value => value, StringComparer.Ordinal),
                extendedBuckwalter = new
                {
                    source = ExtendedBuckwalter.SourceUrl,
                    mappings = ExtendedBuckwalter.Mappings
                        .OrderBy(pair => pair.Key)
                        .Select(pair => new
                        {
                            buckwalter = pair.Key.ToString(),
                            arabic = pair.Value.ToString(),
                            unicode = $"U+{(int)pair.Value:X4}",
                        }),
                },
            },
            json));
    return 0;
}

int BuildLexicon(string[] commandArgs)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            "build-lexicon requires an input file and output directory.");
    }

    var sourceIndex = Array.IndexOf(commandArgs, "--source");
    if (sourceIndex < 0 || sourceIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "build-lexicon requires --source official|mirror|local-copy.");
    }

    var sourceKind = commandArgs[sourceIndex + 1];
    if (sourceKind is not ("official" or "mirror" or "local-copy"))
    {
        throw new ArgumentException(
            "--source must be official, mirror, or local-copy.");
    }

    var result = QacLexiconArtifactWriter.Build(
        commandArgs[0],
        commandArgs[1],
        sourceKind,
        commandArgs.Contains("--full-v0.4", StringComparer.Ordinal));
    Console.WriteLine(JsonSerializer.Serialize(result, json));
    return 0;
}

int EvaluateQuranMorphology(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "evaluate-quran-morphology requires an input file.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with {verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var corpus = QacVerseCorpus.Build(lexicon.Words);
    var evaluation = QacQuranMorphologyEvaluator.Evaluate(lexicon, corpus);
    var serialized = JsonSerializer.Serialize(evaluation, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return evaluation.IsValid ? 0 : 1;
}

int PrintSyntaxCatalog()
{
    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                sources = new[]
                {
                    QacSyntaxCatalog.PhraseTagSource,
                    QacSyntaxCatalog.RelationSource,
                    QacSyntaxCatalog.GraphSource,
                },
                nodeKinds = Enum.GetNames<QacSyntaxNodeKind>(),
                phraseTags = QacSyntaxCatalog.PhraseTags.Values
                    .OrderBy(value => value.Code, StringComparer.Ordinal),
                dependencyRelations = QacSyntaxCatalog.DependencyRelations.Values
                    .OrderBy(value => value.Code, StringComparer.Ordinal),
                direction = "dependent-to-head",
                singleHead = true,
            },
            json));
    return 0;
}

int SyntaxSelfTest()
{
    var cause = new QacSyntaxNode(
        "fa",
        QacSyntaxNodeKind.Terminal,
        "CAUS",
        "فَ",
        new QacLocation(80, 4, 1, 1));
    var verbMorphology = new QacNormalizedMorphologyRecord(
        "(80:4:1:2)",
        "y*~ak~ara",
        "V",
        "Stem",
        ["STEM", "POS:V", "IMPF", "MOOD:SUBJ"],
        null,
        null,
        null,
        "3MS",
        null,
        "IMPF",
        "SUBJ",
        "ACT",
        "I",
        null,
        null,
        null);
    var verb = new QacSyntaxNode(
        "verb",
        QacSyntaxNodeKind.Terminal,
        "V",
        "يَذَّكَّرَ",
        new QacLocation(80, 4, 1, 2),
        Morphology: verbMorphology);
    var valid = QacSyntaxValidator.Validate(
        new QacDependencyGraph(
            "valid-causal-fa",
            [cause, verb],
            [new QacDependencyEdge("fa", "verb", "caus")]));
    var reversed = QacSyntaxValidator.Validate(
        new QacDependencyGraph(
            "reversed-causal-fa",
            [cause, verb],
            [new QacDependencyEdge("verb", "fa", "caus")]));
    var multiHead = QacSyntaxValidator.Validate(
        new QacDependencyGraph(
            "multi-head",
            [cause, verb, new QacSyntaxNode(
                "other",
                QacSyntaxNodeKind.Hidden,
                "V",
                "يَكُونُ")],
            [
                new QacDependencyEdge("fa", "verb", "caus"),
                new QacDependencyEdge("fa", "other", "sub"),
            ]));

    var contractSelfTest = QuranicGrammarContractCatalog.SelfTest();
    var lexemeAuditSelfTest =
        QuranicLexemeAllowlistAuditor.SelfTest();
    var scorePolicySelfTest =
        QacMorphologySelectionScorePolicy.SelfTest();
    var splitManifestSelfTest =
        QuranicCorpusSplitManifestBuilder.SelfTest();
    var knowledgeRootSelfTest =
        QuranicKnowledgeRootCatalogBuilder.SelfTest();
    if (!valid.IsValid
        || reversed.IsValid
        || multiHead.IsValid
        || QacSyntaxCatalog.PhraseTags.Count != 6
        || QacSyntaxCatalog.DependencyRelations.Count != 45
        || !contractSelfTest
        || !lexemeAuditSelfTest
        || !scorePolicySelfTest
        || !splitManifestSelfTest
        || !knowledgeRootSelfTest)
    {
        throw new InvalidOperationException(
            "QAC syntax schema self-test failed: "
            + $"valid={valid.IsValid}, "
            + $"reversed={reversed.IsValid}, "
            + $"multiHead={multiHead.IsValid}, "
            + $"contracts={contractSelfTest}, "
            + $"lexemeAudit={lexemeAuditSelfTest}, "
            + $"scorePolicy={scorePolicySelfTest}, "
            + $"splitManifest={splitManifestSelfTest}, "
            + $"knowledgeRoots={knowledgeRootSelfTest}.");
    }

    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                passed = true,
                phraseTags = QacSyntaxCatalog.PhraseTags.Count,
                dependencyRelations = QacSyntaxCatalog.DependencyRelations.Count,
                ruleContracts = 51,
                lexemeAllowlistAudit = true,
                morphologyScorePolicy =
                    QacMorphologySelectionScorePolicyReport.PolicyId,
                runtimeContract = true,
                leakageSafeGrouping = true,
                knowledgeRootProjection = true,
                reversedErrors = reversed.Errors.Count,
                multiHeadErrors = multiHead.Errors.Count,
            },
            json));
    return 0;
}

int SyntaxPropertyTest(string[] commandArgs)
{
    var report = QacSyntaxPropertyTests.Run();
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int BuildQuranicRuleInventory(string[] commandArgs)
{
    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "quranic-rule-inventory");
    var report = QuranicGrammarRuleInventory.Build(treebank);
    var serialized = JsonSerializer.Serialize(report, json);
    if (commandArgs.Contains("--summary-only", StringComparer.Ordinal))
    {
        Console.WriteLine(
            JsonSerializer.Serialize(
                new
                {
                    report.InventoryContractId,
                    report.GraphCount,
                    report.DependencyRuleCount,
                    report.ObservedDependencyRuleCount,
                    report.PhraseRuleCount,
                    report.ObservedPhraseRuleCount,
                    report.CanonicalValidatorRuleCount,
                    report.DependencyEvidenceCount,
                    report.PhraseEvidenceCount,
                    report.InventoryMerkleRoot,
                    report.IsInventoryComplete,
                },
                json));
    }
    else
    {
        Console.WriteLine(serialized);
    }

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsInventoryComplete ? 0 : 1;
}

int AuditQuranicPhraseContracts(string[] commandArgs)
{
    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "audit-quranic-phrase-contracts");
    var report = QuranicPhraseContractAuditor.Audit(treebank);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int AuditQuranicRelationContracts(string[] commandArgs)
{
    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "audit-quranic-relation-contracts");
    var report = QuranicRelationContractAuditor.Audit(treebank);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int AuditQuranicLexemeAllowlists(string[] commandArgs)
{
    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "audit-quranic-lexeme-allowlists");
    var report = QuranicLexemeAllowlistAuditor.Audit(treebank);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int WriteQuranicScorePolicy(string[] commandArgs)
{
    var report = QacMorphologySelectionScorePolicy.BuildReport();
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int BuildQuranicRuleContracts(string[] commandArgs)
{
    var outputIndex = Array.IndexOf(commandArgs, "--out");
    if (outputIndex < 0 || outputIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "quranic-rule-contracts requires --out <jsonl-path>.");
    }

    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "quranic-rule-contracts");
    var inventory = QuranicGrammarRuleInventory.Build(treebank);
    var contracts = QuranicGrammarContractCatalog.Build(inventory);
    var artifact = QuranicGrammarContractArtifactWriter.WriteJsonLines(
        contracts,
        commandArgs[outputIndex + 1]);
    var summary = new
    {
        contractSetId = contracts.Id,
        contracts.InventoryContractId,
        contracts.InventoryMerkleRoot,
        contracts.ContractSetMerkleRoot,
        contracts.ContractCount,
        contracts.CanonicalValidatorContractCount,
        contracts.EvidenceOnlyContractCount,
        contracts.NormativeForCnsContractCount,
        contracts.IsComplete,
        artifact,
    };
    var serialized = JsonSerializer.Serialize(summary, json);
    Console.WriteLine(serialized);

    var manifestIndex = Array.IndexOf(commandArgs, "--manifest");
    if (manifestIndex >= 0)
    {
        if (manifestIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException(
                "--manifest requires an output path.");
        }

        File.WriteAllText(
            commandArgs[manifestIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return contracts.IsComplete && artifact.IsComplete ? 0 : 1;
}

int BuildCnsGrammarCorpus(string[] commandArgs)
{
    var outputIndex = Array.IndexOf(commandArgs, "--out");
    if (outputIndex < 0 || outputIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "build-cns-grammar-corpus requires --out <jsonl-path>.");
    }

    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "build-cns-grammar-corpus");
    var inventory = QuranicGrammarRuleInventory.Build(treebank);
    var contracts = QuranicGrammarContractCatalog.Build(inventory);
    var corpus = QuranicGrammarCorpusBuilder.Build(contracts);
    var artifact = QuranicGrammarCorpusArtifactWriter.WriteJsonLines(
        corpus,
        commandArgs[outputIndex + 1]);
    var summary = new
    {
        corpus.Id,
        corpus.ContractSetRoot,
        corpus.CorpusMerkleRoot,
        corpus.RecordCount,
        corpus.PositiveRecordCount,
        corpus.NegativeRecordCount,
        corpus.EvidenceOnlyRecordCount,
        corpus.NormativeRecordCount,
        corpus.TaskCounts,
        corpus.MutationCounts,
        corpus.IsValid,
        artifact,
    };
    var serialized = JsonSerializer.Serialize(summary, json);
    Console.WriteLine(serialized);

    var manifestIndex = Array.IndexOf(commandArgs, "--manifest");
    if (manifestIndex >= 0)
    {
        if (manifestIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException(
                "--manifest requires an output path.");
        }

        File.WriteAllText(
            commandArgs[manifestIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return corpus.IsValid && artifact.IsValid ? 0 : 1;
}

int BuildCnsCorpusSplits(string[] commandArgs)
{
    var outputIndex = Array.IndexOf(commandArgs, "--out");
    if (outputIndex < 0 || outputIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "build-cns-corpus-splits requires --out <jsonl-path>.");
    }

    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "build-cns-corpus-splits");
    var inventory = QuranicGrammarRuleInventory.Build(treebank);
    var contracts = QuranicGrammarContractCatalog.Build(inventory);
    var corpus = QuranicGrammarCorpusBuilder.Build(contracts);
    var splitManifest =
        QuranicCorpusSplitManifestBuilder.Build(corpus);
    var artifact =
        QuranicCorpusSplitManifestArtifactWriter.WriteJsonLines(
            splitManifest,
            commandArgs[outputIndex + 1]);
    var summary = new
    {
        splitManifest.Id,
        splitManifest.CorpusId,
        splitManifest.CorpusRoot,
        splitManifest.GroupingPolicy,
        splitManifest.AssignmentPolicy,
        splitManifest.Seed,
        splitManifest.RecordCount,
        splitManifest.GroupCount,
        splitManifest.CrossSplitLeakageCount,
        splitManifest.CurrentRecordSplitCounts,
        splitManifest.ReservedRecordSplitCounts,
        splitManifest.SplitMerkleRoot,
        splitManifest.IsValid,
        artifact,
    };
    var serialized = JsonSerializer.Serialize(summary, json);
    Console.WriteLine(serialized);

    var manifestIndex = Array.IndexOf(commandArgs, "--manifest");
    if (manifestIndex >= 0)
    {
        if (manifestIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException(
                "--manifest requires an output path.");
        }

        File.WriteAllText(
            commandArgs[manifestIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return splitManifest.IsValid && artifact.IsValid ? 0 : 1;
}

int BuildCnsKnowledgeRoots(string[] commandArgs)
{
    var outputIndex = Array.IndexOf(commandArgs, "--out");
    if (outputIndex < 0 || outputIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "build-cns-knowledge-roots requires --out <jsonl-path>.");
    }

    var treebank = LoadVerifiedQuranicTreebank(
        commandArgs,
        "build-cns-knowledge-roots");
    var inventory = QuranicGrammarRuleInventory.Build(treebank);
    var contracts = QuranicGrammarContractCatalog.Build(inventory);
    var corpus = QuranicGrammarCorpusBuilder.Build(contracts);
    var catalog = QuranicKnowledgeRootCatalogBuilder.Build(
        treebank,
        inventory,
        contracts,
        corpus);
    var artifact =
        QuranicKnowledgeRootCatalogArtifactWriter.WriteJsonLines(
            catalog,
            commandArgs[outputIndex + 1]);
    var summary = new
    {
        catalog.Id,
        catalog.InventoryRoot,
        catalog.ContractSetRoot,
        catalog.CorpusRoot,
        catalog.TreebankGraphRoot,
        catalog.KnowledgeMerkleRoot,
        catalog.RecordCount,
        catalog.RuleAssertionRecordCount,
        catalog.LexicalAssociationRecordCount,
        catalog.ControlledNegativeRecordCount,
        catalog.DistinctMorphologicalRootCount,
        catalog.PositiveRecordCount,
        catalog.NegativeRecordCount,
        catalog.UnverifiedRecordCount,
        catalog.NormativeRecordCount,
        catalog.EmbeddingVectorCount,
        catalog.ShardCounts,
        catalog.IsValid,
        artifact,
    };
    var serialized = JsonSerializer.Serialize(summary, json);
    Console.WriteLine(serialized);

    var manifestIndex = Array.IndexOf(commandArgs, "--manifest");
    if (manifestIndex >= 0)
    {
        if (manifestIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException(
                "--manifest requires an output path.");
        }

        File.WriteAllText(
            commandArgs[manifestIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return catalog.IsValid && artifact.IsValid ? 0 : 1;
}

QacSyntaxTreebank LoadVerifiedQuranicTreebank(
    string[] commandArgs,
    string commandName)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            $"{commandName} requires a syntax file "
            + "and a QAC morphology file.");
    }

    var compactMorphologyIndex = Array.IndexOf(
        commandArgs,
        "--syntax-morphology");
    if (compactMorphologyIndex < 0
        || compactMorphologyIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            $"{commandName} requires "
            + "--syntax-morphology <compact-file>.");
    }

    var morphologyVerification = QacMorphologyVerifier.VerifyFile(
        commandArgs[1],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!morphologyVerification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{morphologyVerification.ErrorCount} error(s).");
    }

    var records = QacMorphologyImporter.ReadRecords(commandArgs[1]).ToArray();
    var compactMorphologyPath = commandArgs[compactMorphologyIndex + 1];
    var syntaxVerification = QacSyntaxTreebankVerifier.VerifyFile(
        commandArgs[0],
        records,
        compactMorphologyPath,
        commandArgs.Contains("--pinned-2023", StringComparer.Ordinal));
    if (!syntaxVerification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC syntax verification failed with "
            + $"{syntaxVerification.GraphValidationErrorCount} structural error(s) "
            + $"and {syntaxVerification.Errors.Count} reported source error(s).");
    }

    return QacSyntaxTreebank.Load(
        commandArgs[0],
        records,
        compactMorphologyPath);
}

int ValidateQuranicDiacritics(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "validate-quranic-diacritics requires a QAC morphology file.");
    }

    var textIndex = Array.IndexOf(commandArgs, "--text");
    var locationIndex = Array.IndexOf(commandArgs, "--location");
    if ((textIndex < 0 || textIndex + 1 >= commandArgs.Length)
        && (locationIndex < 0 || locationIndex + 1 >= commandArgs.Length))
    {
        throw new ArgumentException(
            "validate-quranic-diacritics requires --text <Arabic text> "
            + "or --location <(chapter:verse)>.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var text = textIndex >= 0
        ? commandArgs[textIndex + 1]
        : QacVerseCorpus.Build(lexicon.Words).Verses
            .SingleOrDefault(verse =>
                verse.Location == commandArgs[locationIndex + 1])
            ?.Text
            ?? throw new ArgumentException(
                $"Quranic location '{commandArgs[locationIndex + 1]}' "
                + "was not found.");
    var parser = new QacDeterministicGrammarParser(
        lexicon,
        enableHeuristicFallback: false);
    var parse = parser.Parse(text);
    var functional = new QuranicFunctionalDiacriticValidator(
        QacDiacriticEvidenceIndex.Build(lexicon)).Validate(parse);
    var output = new
    {
        Input = text,
        parse.Status,
        SelectedScore = parse.SelectedAlternative.Score,
        Selected = parse.SelectedAlternative.Selection,
        parse.Graph,
        ParseDiagnostics = parse.Diagnostics,
        FunctionalValidation = functional,
    };
    var serialized = JsonSerializer.Serialize(output, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return functional.Status == QuranicFunctionalValidationStatus.Valid
        ? 0
        : 1;
}

int EvaluateQuranicDiacritics(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "evaluate-quranic-diacritics requires a QAC morphology file.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var report = QuranicFunctionalDiacriticEvaluator.Evaluate(lexicon);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int TestQuranicDiacriticMutations(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "test-quranic-diacritic-mutations requires a QAC morphology file.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var report = QuranicDiacriticMutationEvaluator.Evaluate(lexicon);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int DiacritizeQuranic(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "diacritize-quranic requires a QAC morphology file.");
    }

    var textIndex = Array.IndexOf(commandArgs, "--text");
    if (textIndex < 0 || textIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "diacritize-quranic requires --text <Arabic text>.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var report = new QuranicDeterministicDiacritizer(lexicon)
        .Diacritize(commandArgs[textIndex + 1]);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int EvaluateQuranicDiacritization(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "evaluate-quranic-diacritization requires a QAC morphology file.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var report =
        QuranicDiacritizationRoundTripEvaluator.Evaluate(lexicon);
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int ParseGrammar(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException("parse-grammar requires a QAC morphology file.");
    }

    var textIndex = Array.IndexOf(commandArgs, "--text");
    if (textIndex < 0 || textIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException("parse-grammar requires --text <Arabic text>.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(commandArgs[0]);
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with {verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var parser = new QacDeterministicGrammarParser(
        lexicon,
        commandArgs.Contains(
            "--allow-natural-heuristic",
            StringComparer.Ordinal)
        && !commandArgs.Contains("--no-heuristic", StringComparer.Ordinal));
    var result = parser.Parse(commandArgs[textIndex + 1]);
    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                status = result.Status.ToString(),
                selectedScore = result.SelectedAlternative.Score,
                selected = result.SelectedAlternative.Selection.Select(item => new
                {
                    item.UnitIndex,
                    item.Surface,
                    item.PrimaryTag,
                    source = item.Source.ToString(),
                    item.MorphologySignature,
                }),
                alternatives = result.Alternatives.Select(alternative => new
                {
                    alternative.Score,
                    alternative.Signature,
                }),
                graph = new
                {
                    nodes = result.Graph.Nodes.Select(node => new
                    {
                        node.Id,
                        kind = node.Kind.ToString(),
                        node.Tag,
                        node.Text,
                        node.TextRange,
                    }),
                    result.Graph.Edges,
                },
                validation = new
                {
                    result.Validation.IsValid,
                    result.Validation.RootCount,
                    result.Validation.Errors,
                },
                result.Diagnostics,
            },
            json));
    return result.Status == QacGrammarStatus.Invalid ? 1 : 0;
}

int EvaluateQuranGrammar(string[] commandArgs)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "evaluate-quran-grammar requires a QAC morphology file.");
    }

    var verification = QacMorphologyVerifier.VerifyFile(
        commandArgs[0],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!verification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with {verification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[0]));
    var corpus = QacVerseCorpus.Build(lexicon.Words);
    var evaluation = QacQuranGrammarEvaluator.Evaluate(lexicon, corpus);
    var serialized = JsonSerializer.Serialize(evaluation, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return 0;
}

int EvaluateQuranSyntax(string[] commandArgs)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            "evaluate-quran-syntax requires a syntax file and a QAC morphology file.");
    }

    var compactMorphologyIndex = Array.IndexOf(
        commandArgs,
        "--syntax-morphology");
    if (compactMorphologyIndex < 0
        || compactMorphologyIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException(
            "evaluate-quran-syntax requires --syntax-morphology <compact-file>.");
    }

    var morphologyVerification = QacMorphologyVerifier.VerifyFile(
        commandArgs[1],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!morphologyVerification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{morphologyVerification.ErrorCount} error(s).");
    }

    var records = QacMorphologyImporter.ReadRecords(commandArgs[1]).ToArray();
    var compactMorphologyPath = commandArgs[compactMorphologyIndex + 1];
    var syntaxVerification = QacSyntaxTreebankVerifier.VerifyFile(
        commandArgs[0],
        records,
        compactMorphologyPath,
        commandArgs.Contains("--pinned-2023", StringComparer.Ordinal));
    if (!syntaxVerification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC syntax verification failed with "
            + $"{syntaxVerification.GraphValidationErrorCount} structural error(s) "
            + $"and {syntaxVerification.Errors.Count} reported source error(s).");
    }

    var treebank = QacSyntaxTreebank.Load(
        commandArgs[0],
        records,
        compactMorphologyPath);
    var lexicon = QacMorphologyLexicon.Build(records);
    var corpus = QacVerseCorpus.Build(lexicon.Words);
    var evaluation = QacSyntaxGoldEvaluator.Evaluate(
        lexicon,
        corpus,
        treebank);
    var serialized = JsonSerializer.Serialize(evaluation, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return 0;
}

int VerifyUdArabic(
    string[] commandArgs,
    UdArabicSourceDescriptor source)
{
    if (commandArgs.Length == 0)
    {
        throw new ArgumentException(
            "UD verification requires a CoNLL-U test file.");
    }

    var report = UdArabicPadtVerifier.VerifyFile(
        commandArgs[0],
        source,
        requirePinnedSource:
            !commandArgs.Contains("--allow-unpinned", StringComparer.Ordinal));
    var serialized = JsonSerializer.Serialize(report, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return report.IsValid ? 0 : 1;
}

int EvaluateNaturalArabic(string[] commandArgs)
{
    if (commandArgs.Length < 2)
    {
        throw new ArgumentException(
            "evaluate-natural-arabic requires a CoNLL-U test file "
            + "and a QAC morphology file.");
    }

    var sourceIndex = Array.IndexOf(commandArgs, "--corpus");
    if (sourceIndex >= 0 && sourceIndex + 1 >= commandArgs.Length)
    {
        throw new ArgumentException("--corpus requires padt or pud.");
    }

    var source = sourceIndex < 0 || commandArgs[sourceIndex + 1] == "padt"
        ? UdArabicPadtSource.Descriptor
        : commandArgs[sourceIndex + 1] == "pud"
            ? UdArabicPudSource.Descriptor
            : throw new ArgumentException("--corpus must be padt or pud.");
    var udVerification = UdArabicPadtVerifier.VerifyFile(
        commandArgs[0],
        source,
        requirePinnedSource:
            !commandArgs.Contains("--allow-unpinned", StringComparer.Ordinal));
    if (!udVerification.IsValid)
    {
        throw new InvalidDataException(
            $"UD Arabic-PADT verification failed with "
            + $"{udVerification.Errors.Count} error(s).");
    }

    var morphologyVerification = QacMorphologyVerifier.VerifyFile(
        commandArgs[1],
        new QacVerificationOptions
        {
            RequireOfficialNotices = true,
            RequireQacV04Coverage =
                commandArgs.Contains("--full-v0.4", StringComparer.Ordinal),
        });
    if (!morphologyVerification.IsValid)
    {
        throw new InvalidDataException(
            $"QAC source failed verification with "
            + $"{morphologyVerification.ErrorCount} error(s).");
    }

    var lexicon = QacMorphologyLexicon.Build(
        QacMorphologyImporter.ReadRecords(commandArgs[1]));
    var corpus = UdArabicCorpus.Load(commandArgs[0]);
    var evaluation = UdArabicParserEvaluator.Evaluate(lexicon, corpus, source);
    var serialized = JsonSerializer.Serialize(evaluation, json);
    Console.WriteLine(serialized);

    var reportIndex = Array.IndexOf(commandArgs, "--report");
    if (reportIndex >= 0)
    {
        if (reportIndex + 1 >= commandArgs.Length)
        {
            throw new ArgumentException("--report requires an output path.");
        }

        File.WriteAllText(
            commandArgs[reportIndex + 1],
            serialized + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    return evaluation.MeetsNaturalArabicReadinessGate ? 0 : 1;
}

int SelfTest()
{
    const string valid = """
        LOCATION	FORM	TAG	FEATURES
        (1:1:1:1)	wa	CONJ	PREFIX|w:CONJ+
        (1:1:1:2)	kataba	V	STEM|POS:V|PERF|LEM:kataba|ROOT:ktb|3MS
        (1:1:1:3)	hu	PRON	SUFFIX|PRON:3MS
        (1:1:2:1)	fa	CAUS	PREFIX|f:CAUS+
        (1:1:2:2)	yaktuba	V	STEM|POS:V|IMPF|MOOD:SUBJ|LEM:kataba|ROOT:ktb|3MS
        """;
    const string invalid = """
        LOCATION	FORM	TAG	FEATURES
        (1:1:1:1)	yaktubu	V	STEM|POS:V|IMPF|MOOD:UNKNOWN|LEM:kataba|ROOT:ktb|3MS
        """;

    var validHash = Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(valid))).ToLowerInvariant();
    var first = QacMorphologyVerifier.Verify(
        new StringReader(valid),
        validHash,
        new QacVerificationOptions { RequireOfficialNotices = false });
    var second = QacMorphologyVerifier.Verify(
        new StringReader(valid),
        validHash,
        new QacVerificationOptions { RequireOfficialNotices = false });
    var rejected = QacMorphologyVerifier.Verify(
        new StringReader(invalid),
        "invalid-fixture",
        new QacVerificationOptions { RequireOfficialNotices = false });
    var formattingTokens = new Adg.QuranicCore.QuranicTokenizer()
        .Tokenize("قال ـ الرئيس");
    var elongation = formattingTokens.Single(token => token.Surface == "ـ");

    if (!first.IsValid
        || first.ValidSegmentCount != 5
        || first.WordCount != 2
        || first.GrammarEvidence.CausalFaCount != 1
        || first.GrammarEvidence.CausalFaDirectImperfectCount != 1
        || first.GrammarEvidence.CausalFaDirectImperfectSubjunctiveCount != 1
        || first.TransliterationEvidence.MappedSegmentCount != 5
        || first.RecordMerkleRoot != second.RecordMerkleRoot
        || rejected.IsValid
        || rejected.Errors.All(issue => issue.Code != "QAC-MOR0008")
        || elongation.Kind != Adg.QuranicCore.QuranicTokenKind.Other)
    {
        throw new InvalidOperationException("QAC morphology self-test failed.");
    }

    Console.WriteLine(
        JsonSerializer.Serialize(
            new
            {
                passed = true,
                first.ValidSegmentCount,
                first.WordCount,
                first.RecordMerkleRoot,
                rejectedErrorCode = rejected.Errors[0].Code,
            },
            json));
    return 0;
}

void PrintUsage()
{
    Console.Error.WriteLine(
        """
        Usage:
          qac verify-morphology <input> [--full-v0.4] [--report <path>]
          qac import-morphology <input> <output-directory> --source official|mirror|local-copy [--full-v0.4]
          qac build-lexicon <input> <output-directory> --source official|mirror|local-copy [--full-v0.4]
          qac evaluate-quran-morphology <input> [--full-v0.4] [--report <path>]
          qac verify-syntax <syntax> <morphology> [--syntax-morphology <compact-file>] [--pinned-2023] [--full-v0.4] [--report <path>]
          qac syntax-catalog
          qac syntax-self-test
          qac syntax-property-test [--report <path>]
          qac quranic-rule-inventory <syntax> <morphology> --syntax-morphology <compact-file> [--pinned-2023] [--full-v0.4] [--summary-only] [--report <path>]
          qac audit-quranic-phrase-contracts <syntax> <morphology> --syntax-morphology <compact-file> [--pinned-2023] [--full-v0.4] [--report <path>]
          qac audit-quranic-relation-contracts <syntax> <morphology> --syntax-morphology <compact-file> [--pinned-2023] [--full-v0.4] [--report <path>]
          qac audit-quranic-lexeme-allowlists <syntax> <morphology> --syntax-morphology <compact-file> [--pinned-2023] [--full-v0.4] [--report <path>]
          qac quranic-score-policy [--report <path>]
          qac quranic-rule-contracts <syntax> <morphology> --syntax-morphology <compact-file> --out <contracts.jsonl> [--manifest <path>] [--pinned-2023] [--full-v0.4]
          qac build-cns-grammar-corpus <syntax> <morphology> --syntax-morphology <compact-file> --out <corpus.jsonl> [--manifest <path>] [--pinned-2023] [--full-v0.4]
          qac build-cns-corpus-splits <syntax> <morphology> --syntax-morphology <compact-file> --out <split-groups.jsonl> [--manifest <path>] [--pinned-2023] [--full-v0.4]
          qac build-cns-knowledge-roots <syntax> <morphology> --syntax-morphology <compact-file> --out <knowledge-roots.jsonl> [--manifest <path>] [--pinned-2023] [--full-v0.4]
          qac validate-quranic-diacritics <morphology> (--text <Arabic text> | --location <(chapter:verse)>) [--full-v0.4] [--report <path>]
          qac evaluate-quranic-diacritics <morphology> [--full-v0.4] [--report <path>]
          qac test-quranic-diacritic-mutations <morphology> [--full-v0.4] [--report <path>]
          qac diacritize-quranic <morphology> --text <Arabic text> [--full-v0.4] [--report <path>]
          qac evaluate-quranic-diacritization <morphology> [--full-v0.4] [--report <path>]
          qac parse-grammar <input> --text <Arabic text> [--allow-natural-heuristic]
          qac evaluate-quran-grammar <input> [--full-v0.4] [--report <path>]
          qac evaluate-quran-syntax <syntax> <morphology> --syntax-morphology <compact-file> [--pinned-2023] [--full-v0.4] [--report <path>]
          qac verify-ud-padt <conllu-test> [--allow-unpinned] [--report <path>]
          qac verify-ud-pud <conllu-test> [--allow-unpinned] [--report <path>]
          qac evaluate-natural-arabic <conllu-test> <morphology> [--corpus padt|pud] [--allow-unpinned] [--full-v0.4] [--report <path>]
          qac catalog
          qac self-test
        """);
}
