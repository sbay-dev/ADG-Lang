[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$manifestPath = Join-Path $root "versions\v1\MERKLE-MANIFEST.json"
$relativePaths = @(
    "ADG-Lang.Native.slnx",
    "scripts\quranic-core\Write-QuranicCoreV1Merkle.ps1",
    "src\Adg.QuranicCore\Adg.QuranicCore.csproj",
    "src\Adg.QuranicCore\Models.cs",
    "src\Adg.QuranicCore\QuranicCausalityAnalyzer.cs",
    "src\Adg.QuranicCore\QuranicTextNormalizer.cs",
    "src\Adg.QuranicCore\QuranicTokenizer.cs",
    "src\Adg.QuranicCore.Cli\Adg.QuranicCore.Cli.csproj",
    "src\Adg.QuranicCore.Cli\Program.cs",
    "src\Adg.QuranicCore.Cli\QuranicCorpusVerifier.cs",
    "tests\quranic-core-v1\causal-gold.json",
    "versions\v1\RELEASE.md",
    "versions\v1\VERSION-MANIFEST.json",
    "versions\v1\evidence\quranic-core-v1-report.json",
    "versions\v1\modules\pipeline\pipe-quranic-text\v1\MODULE.md",
    "versions\v1\modules\services\s0-quranic-causality\v1\MODULE.md",
    "versions\v1\modules\tools\t0-quranic-cli\v1\MODULE.md"
) | Sort-Object

function Get-Sha256Text {
    param([Parameter(Mandatory)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

$files = foreach ($relativePath in $relativePaths) {
    $fullPath = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required v1 file is missing: $relativePath"
    }

    [ordered]@{
        path = $relativePath
        sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$level = @(
    $files | ForEach-Object {
        Get-Sha256Text (
            "ADG-QURANIC-CORE-V1-FILE$([char]0)$($_.path)$([char]0)$($_.sha256)"
        )
    }
)
$leafHashes = @($level)

while ($level.Count -gt 1) {
    if ($level.Count % 2 -ne 0) {
        $level += $level[-1]
    }

    $next = @()
    for ($index = 0; $index -lt $level.Count; $index += 2) {
        $next += Get-Sha256Text (
            "ADG-QURANIC-CORE-V1-NODE$([char]0)$($level[$index])$($level[$index + 1])"
        )
    }

    $level = $next
}

$manifest = [ordered]@{
    project = "ADG-Lang"
    version = "v1"
    algorithm = "sha256"
    leaf_domain = "ADG-QURANIC-CORE-V1-FILE"
    node_domain = "ADG-QURANIC-CORE-V1-NODE"
    root = $level[0]
    leaf_hashes = $leafHashes
    files = $files
    excluded = @(
        ".git",
        ".vs",
        "bin",
        "obj",
        "build",
        "artifacts",
        "publish",
        "logs",
        "caches",
        "secrets",
        "release_key.txt",
        "encrypted model weights"
    )
}

$json = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
    $manifestPath,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false))

Write-Output $manifest.root
