param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"

function Get-NormalizedSha256 {
    param([Parameter(Mandatory)][string]$Path)

    $text = [System.IO.File]::ReadAllText($Path)
    $normalized = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

function Get-TextSha256 {
    param([Parameter(Mandatory)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

function Get-RelativeArtifactPath {
    param([Parameter(Mandatory)][string]$Path)

    return [System.IO.Path]::GetRelativePath($Root, $Path).Replace("\", "/")
}

$releaseRoot = Join-Path $Root "versions\v3"
$versionManifestPath = Join-Path $releaseRoot "VERSION-MANIFEST.json"
$outputPath = Join-Path $releaseRoot "MERKLE-MANIFEST.json"

if (-not (Test-Path -LiteralPath $versionManifestPath)) {
    throw "Missing v3 version manifest: $versionManifestPath"
}

$versionManifest = Get-Content -LiteralPath $versionManifestPath -Raw |
    ConvertFrom-Json
$activeModules = @($versionManifest.modules | Where-Object status -eq "active")
$activeModuleIds = @($activeModules.moduleId)

foreach ($module in $activeModules) {
    if ($module.version -ne "v3") {
        throw "Mixed active module version: $($module.moduleId)@$($module.version)"
    }

    $dossierPath = Join-Path $Root $module.dossier.Replace("/", "\")
    if (-not (Test-Path -LiteralPath $dossierPath)) {
        throw "Missing module dossier: $dossierPath"
    }

    $dossier = Get-Content -LiteralPath $dossierPath -Raw | ConvertFrom-Json
    if ($dossier.moduleId -ne $module.moduleId -or $dossier.version -ne "v3") {
        throw "Dossier identity mismatch: $dossierPath"
    }
}

$sourceSpecs = @(
    @{
        ModuleId = "pipeline.pipe-quranic-core"
        Path = "src\Adg.QuranicCore"
        Extensions = @(".cs", ".csproj")
    },
    @{
        ModuleId = "pipeline.pipe-qac-morphology"
        Path = "src\Adg.QuranicCorpus"
        Extensions = @(".cs", ".csproj")
    },
    @{
        ModuleId = "services.s0-deterministic-grammar"
        Path = "src\Adg.QuranicGrammar"
        Extensions = @(".cs", ".csproj")
    },
    @{
        ModuleId = "services.s1-grammar-corpus"
        Path = "src\Adg.QuranicTraining"
        Extensions = @(".cs", ".csproj")
    },
    @{
        ModuleId = "tools.t0-quranic-corpus-cli"
        Path = "src\Adg.QuranicCorpus.Cli"
        Extensions = @(".cs", ".csproj")
    }
)

$artifactOwners = [System.Collections.Generic.Dictionary[string, string]]::new(
    [System.StringComparer]::Ordinal
)

foreach ($spec in $sourceSpecs) {
    $sourceRoot = Join-Path $Root $spec.Path
    if (-not (Test-Path -LiteralPath $sourceRoot)) {
        throw "Missing source module path: $sourceRoot"
    }

    Get-ChildItem -LiteralPath $sourceRoot -File -Recurse |
        Where-Object {
            $_.Extension -in $spec.Extensions -and
            $_.FullName -notmatch "\\(bin|obj)\\"
        } |
        ForEach-Object {
            $relative = Get-RelativeArtifactPath $_.FullName
            if ($artifactOwners.ContainsKey($relative)) {
                throw "Duplicate artifact path: $relative"
            }

            $artifactOwners.Add($relative, $spec.ModuleId)
        }
}

$standaloneArtifacts = @(
    @{
        ModuleId = "tools.t0-quranic-corpus-cli"
        Path = "ADG-Lang.Native.slnx"
    },
    @{
        ModuleId = "pipeline.pipe-qac-morphology"
        Path = "THIRD_PARTY\quranic-arabic-corpus\LICENSE-DATA.txt"
    },
    @{
        ModuleId = "pipeline.pipe-qac-morphology"
        Path = "THIRD_PARTY\quranic-arabic-corpus\ATTRIBUTION.md"
    },
    @{
        ModuleId = "pipeline.pipe-qac-morphology"
        Path = "THIRD_PARTY\quranic-arabic-corpus\PROVENANCE.template.json"
    },
    @{
        ModuleId = "pipeline.pipe-qac-morphology"
        Path = "THIRD_PARTY\quranic-arabic-corpus\SYNTAX-PROVENANCE.template.json"
    },
    @{
        ModuleId = "tools.t1-release-manifest"
        Path = "scripts\quranic-corpus\Write-QuranicGrammarV3Merkle.ps1"
    }
)

foreach ($artifact in $standaloneArtifacts) {
    $path = Join-Path $Root $artifact.Path
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing standalone artifact: $path"
    }

    $relative = Get-RelativeArtifactPath $path
    if ($artifactOwners.ContainsKey($relative)) {
        throw "Duplicate artifact path: $relative"
    }

    $artifactOwners.Add($relative, $artifact.ModuleId)
}

Get-ChildItem -LiteralPath $releaseRoot -File -Recurse |
    Where-Object Name -ne "MERKLE-MANIFEST.json" |
    ForEach-Object {
        $relative = Get-RelativeArtifactPath $_.FullName
        if ($artifactOwners.ContainsKey($relative)) {
            throw "Duplicate artifact path: $relative"
        }

        $owner = "tools.t1-release-manifest"
        foreach ($module in $activeModules) {
            if ($relative -eq $module.dossier) {
                $owner = $module.moduleId
                break
            }
        }

        $artifactOwners.Add($relative, $owner)
    }

$entries = @(
    foreach ($relative in @($artifactOwners.Keys) | Sort-Object) {
        $moduleId = $artifactOwners[$relative]
        if ($moduleId -notin $activeModuleIds) {
            throw "Artifact owner is not an active v3 module: $moduleId"
        }

        $absolute = Join-Path $Root $relative.Replace("/", "\")
        $contentSha256 = Get-NormalizedSha256 $absolute
        $descriptor = "$moduleId|v3|$relative|$contentSha256"
        [ordered]@{
            moduleId = $moduleId
            version = "v3"
            path = $relative
            contentSha256 = $contentSha256
            descriptorDigest = Get-TextSha256 $descriptor
        }
    }
)

$level = @($entries.descriptorDigest)
if ($level.Count -eq 0) {
    throw "Cannot create a Merkle tree with zero artifacts."
}

while ($level.Count -gt 1) {
    $next = @()
    for ($index = 0; $index -lt $level.Count; $index += 2) {
        $left = $level[$index]
        $right = if ($index + 1 -lt $level.Count) {
            $level[$index + 1]
        }
        else {
            $left
        }

        $next += Get-TextSha256 "$left$right"
    }

    $level = $next
}

$manifest = [ordered]@{
    schemaVersion = 1
    release = "ADG-Lang Quranic Parser v3"
    version = "v3"
    generatedAtUtc = $versionManifest.releasedAtUtc
    hashAlgorithm = "SHA-256"
    contentNormalization = "UTF-8 text with LF line endings"
    leafDescriptor = "moduleId|version|path|contentSha256"
    oddLeafRule = "duplicate-last"
    artifactCount = $entries.Count
    artifacts = $entries
    releaseMerkleRoot = $level[0]
}

$json = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
    $outputPath,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "releaseRoot=$($level[0])"
Write-Output "artifactCount=$($entries.Count)"
Write-Output "manifest=$outputPath"
