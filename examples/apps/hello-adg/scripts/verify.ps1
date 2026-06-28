param(
    [string]$CompilerProject
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")

if (-not $CompilerProject) {
    $CompilerProject = Join-Path $RepoRoot "src\Adg.Compiler"
}

$Entry = Join-Path $ProjectRoot "src\main.adg.json"
dotnet run --project $CompilerProject -- verify $Entry
