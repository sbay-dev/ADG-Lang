[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$tracked = @(
    & git -C $RepositoryRoot ls-files --cached --others --exclude-standard
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate tracked files."
}

$failures = [System.Collections.Generic.List[string]]::new()
$forbiddenPaths = @(
    '(?i)(^|/)(bin|obj|raw)(/|$)',
    '(?i)(^|/)quranic-corpus-morphology-0\.4\.txt$',
    '(?i)(^|/)(syntax|morphology)\.txt$',
    '(?i)\.conllu$',
    '(?i)\.jsonl$',
    '(?i)(^|/)session-state(/|$)'
)

foreach ($relative in $tracked) {
    foreach ($pattern in $forbiddenPaths) {
        if ($relative -match $pattern) {
            $failures.Add("Forbidden tracked path: $relative")
            break
        }
    }

    $absolute = Join-Path $RepositoryRoot $relative
    if ((Get-Item -LiteralPath $absolute).Length -gt 2MB) {
        $failures.Add("Tracked file exceeds 2 MiB public limit: $relative")
    }
}

$indexEntries = @(& git -C $RepositoryRoot ls-files -s)
foreach ($entry in $indexEntries) {
    if ($entry -match '^120000\s') {
        $failures.Add("Tracked symbolic link is not allowed: $entry")
    }
}

$textExtensions = @(
    ".adg", ".cs", ".csproj", ".gitattributes", ".gitignore", ".json",
    ".md", ".props", ".ps1", ".slnx", ".targets", ".txt", ".yaml", ".yml"
)
$secretPatterns = @(
    'AKIA[0-9A-Z]{16}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '(?i)\b(api[_-]?key|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*["''][^"'']+'
)
$handoffPatterns = @(
    '(?i)\b[SX]:\\',
    '(?i)(/home/|/Users/|C:\\Users\\)',
    '(?i)copilot[\\/]+temp',
    '(?i)session-state[\\/]+[0-9a-f-]{16,}',
    '(?i)\b(claude-(opus|sonnet|haiku)|gpt-[0-9]|gemini-[0-9]|kimi-[a-z0-9])'
)
$handoffScope = '^(docs/research/quranic-core-v1/|docs/kanban/ADG-QURANIC-CORE-KANBAN\.md$|versions/|src/Adg\.Quranic|THIRD_PARTY/|NOTICE$|RESEARCH-EVALUATION-NOTICE\.md$)'

foreach ($relative in $tracked) {
    $extension = [System.IO.Path]::GetExtension($relative)
    if ($relative -notin @(".gitignore", ".gitattributes") -and
        $extension -notin $textExtensions) {
        continue
    }

    $absolute = Join-Path $RepositoryRoot $relative
    $content = [System.IO.File]::ReadAllText($absolute)
    foreach ($pattern in $secretPatterns) {
        if ($content -match $pattern) {
            $failures.Add("Possible secret in tracked text: $relative")
            break
        }
    }

    if ($relative -match $handoffScope) {
        foreach ($pattern in $handoffPatterns) {
            if ($content -match $pattern) {
                $failures.Add("Private runtime or local-path identifier in handoff: $relative")
                break
            }
        }
    }
}

if ($failures.Count -gt 0) {
    $failures | Sort-Object -Unique | ForEach-Object {
        Write-Error $_
    }
    exit 1
}

Write-Output "publicHandoffAudit=PASS"
Write-Output "trackedFiles=$($tracked.Count)"
Write-Output "rawCorporaTracked=0"
Write-Output "symbolicLinksTracked=0"
Write-Output "filesOver2MiB=0"
