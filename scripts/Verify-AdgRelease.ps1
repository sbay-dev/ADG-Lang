<#
.SYNOPSIS
  Verifies the public ADG-Lang release repository.

.DESCRIPTION
  Runs the public reference compiler against valid and invalid AST examples.
  The script proves that valid examples pass and invalid examples fail before
  backend output. Native executable linking is optional and requires LLVM clang.
#>

param(
    [string]$Root = ".",
    [string]$ProjectPath = "src\Adg.Compiler",
    [switch]$SkipNative
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoPath {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath((Join-Path $Root $Path))
}

function Invoke-Adg {
    param(
        [string[]]$AdgArgs,
        [switch]$AllowFailure
    )

    $project = Resolve-RepoPath $ProjectPath
    $dotnetArgs = @("run", "--project", $project, "--") + $AdgArgs
    Write-Host "[INFO] dotnet $($dotnetArgs -join ' ')" -ForegroundColor Cyan

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "dotnet"
    $psi.Arguments = (($dotnetArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join " ")
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $text = $stdout + $stderr
    if (-not $AllowFailure -and $process.ExitCode -ne 0) {
        throw "Command failed with exit code $($process.ExitCode)`n$text"
    }

    return [PSCustomObject]@{
        ExitCode = $process.ExitCode
        Output = $text
    }
}

$validExamples = @(
    @{ Id = "proof-10-words"; Path = "examples\valid\proof-10-words.adg.json" },
    @{ Id = "causal-10-words"; Path = "examples\valid\causal-10-words.adg.json" }
)

$invalidExamples = @(
    @{ Id = "invalid-fael-nasb"; Path = "examples\invalid\invalid-fael-nasb.adg.json"; Diagnostic = "ADG1001" },
    @{ Id = "invalid-maful-raf"; Path = "examples\invalid\invalid-maful-raf.adg.json"; Diagnostic = "ADG1002" },
    @{ Id = "invalid-jarr-raf"; Path = "examples\invalid\invalid-jarr-raf.adg.json"; Diagnostic = "ADG1003" },
    @{ Id = "invalid-condition-missing-answer"; Path = "examples\invalid\invalid-condition-missing-answer.adg.json"; Diagnostic = "ADG1004" },
    @{ Id = "invalid-explanation-case-mismatch"; Path = "examples\invalid\invalid-explanation-case-mismatch.adg.json"; Diagnostic = "ADG1005" },
    @{ Id = "invalid-question-missing-target"; Path = "examples\invalid\invalid-question-missing-target.adg.json"; Diagnostic = "ADG1006" },
    @{ Id = "invalid-negation-no-target"; Path = "examples\invalid\invalid-negation-no-target.adg.json"; Diagnostic = "ADG1007" }
)

$artifactDir = Resolve-RepoPath "artifacts"
if (Test-Path $artifactDir) {
    Remove-Item $artifactDir -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactDir | Out-Null

Invoke-Adg -AdgArgs @("--self-test") | Out-Null
Invoke-Adg -AdgArgs @("test-matrix") | Out-Null

foreach ($example in $validExamples) {
    $input = Resolve-RepoPath $example.Path
    $ll = Join-Path $artifactDir "$($example.Id).ll"
    $exe = Join-Path $artifactDir "$($example.Id).exe"

    Invoke-Adg -AdgArgs @("verify", $input) | Out-Null

    if ($SkipNative) {
        Invoke-Adg -AdgArgs @("compile", $input, "--emit-llvm", $ll) | Out-Null
    } else {
        Invoke-Adg -AdgArgs @("compile", $input, "--emit-llvm", $ll, "--native", $exe) | Out-Null
        & $exe | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Native executable failed: $exe"
        }
    }

    if (-not (Test-Path $ll)) {
        throw "Expected LLVM IR was not emitted: $ll"
    }
}

foreach ($example in $invalidExamples) {
    $input = Resolve-RepoPath $example.Path
    $result = Invoke-Adg -AdgArgs @("verify", $input) -AllowFailure
    if ($result.ExitCode -eq 0) {
        throw "Invalid example unexpectedly passed: $($example.Path)"
    }
    if ($result.Output -notmatch [regex]::Escape($example.Diagnostic)) {
        throw "Expected diagnostic $($example.Diagnostic) was not found for $($example.Path). Output: $($result.Output)"
    }
}

Write-Host "[PASS] ADG-Lang public release verification completed." -ForegroundColor Green
