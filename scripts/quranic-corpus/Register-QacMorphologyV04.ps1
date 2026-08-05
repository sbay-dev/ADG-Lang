[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string] $SourceFile,

    [Parameter(Mandatory)]
    [string] $DestinationDirectory,

    [string] $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceFile).Path
$repository = [System.IO.Path]::GetFullPath($RepositoryRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar)
$rawDirectory = [System.IO.Path]::GetFullPath($DestinationDirectory).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar)
$repositoryPrefix = $repository + [System.IO.Path]::DirectorySeparatorChar
$isRepository = $rawDirectory.Equals(
    $repository,
    [System.StringComparison]::OrdinalIgnoreCase)
$isInsideRepository = $rawDirectory.StartsWith(
    $repositoryPrefix,
    [System.StringComparison]::OrdinalIgnoreCase)
if ($isRepository -or $isInsideRepository) {
    throw 'DestinationDirectory must be outside the Git repository.'
}

$destination = Join-Path $rawDirectory 'quranic-corpus-morphology-0.4.txt'
$provenance = Join-Path $rawDirectory 'PROVENANCE.local.json'

$text = Get-Content -LiteralPath $source -Raw
$requiredMarkers = @(
    'Quranic Arabic Corpus (morphology, version 0.4)',
    'Tanzil Quran Text (Uthmani, version 1.0.2)',
    "LOCATION`tFORM`tTAG`tFEATURES"
)

foreach ($marker in $requiredMarkers) {
    if (-not $text.Contains($marker, [System.StringComparison]::Ordinal)) {
        throw "The selected file is missing required marker: $marker"
    }
}

New-Item -ItemType Directory -Force -Path $rawDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()

[ordered]@{
    source = 'https://corpus.quran.com/download/'
    resource = 'Quranic Arabic Corpus morphology'
    version = '0.4'
    retrievalMethod = 'official email-gated download form'
    rawFile = 'quranic-corpus-morphology-0.4.txt'
    sha256 = $hash
    upstreamChecksumPublished = $false
    licenseNotice = '..\LICENSE-DATA.txt'
} | ConvertTo-Json | Set-Content -LiteralPath $provenance -Encoding utf8NoBOM

[pscustomobject]@{
    RawFile = $destination
    Sha256 = $hash
    Provenance = $provenance
}
