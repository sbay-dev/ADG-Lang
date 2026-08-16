$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$portalRoot = (Resolve-Path (Join-Path $root "..\..")).Path
$work = Join-Path $root ".validation-work"
$secretDir = Join-Path $work "secrets"
$migrationDir = Join-Path $work "migrations"
$rendered = Join-Path $work "rendered.yaml"
$renderedOperations = Join-Path $work "rendered-operations.yaml"
$renderedWalg = Join-Path $work "rendered-walg.yaml"
$renderedQdrantGpg = Join-Path $work "rendered-qdrant-gpg.yaml"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
    Write-Host "OK $Name"
}

Push-Location $root
try {
    Invoke-Checked "contract validation" { node .\validation\validate-contracts.mjs }
    Invoke-Checked "security policy validation" { node .\validation\validate-security.mjs }
    Invoke-Checked "integrity validation" { node .\validation\validate-integrity.mjs }

    Get-ChildItem -Recurse -File -Filter *.ps1 | ForEach-Object {
        $tokens = $null
        $parseErrors = $null
        [void][Management.Automation.Language.Parser]::ParseFile(
            $_.FullName,
            [ref]$tokens,
            [ref]$parseErrors
        )
        if ($parseErrors.Count -gt 0) {
            throw "PowerShell parse failed for $($_.FullName): $($parseErrors[0].Message)"
        }
    }
    Write-Host "OK PowerShell deployment script parse"

    Get-ChildItem -Recurse -File -Filter *.py | ForEach-Object {
        $pythonPath = $_.FullName.Replace("\", "\\")
        python -c "compile(open(r'$pythonPath', encoding='utf-8').read(), r'$pythonPath', 'exec')"
        if ($LASTEXITCODE -ne 0) {
            throw "Python parse failed for $($_.FullName)."
        }
    }
    Write-Host "OK Python backup client parse"
    Invoke-Checked "real Worker harness parse" {
        node --check .\validation\real-worker-backup-harness.mjs
    }
    Invoke-Checked "Cloudflare bridge parse" {
        node --check .\cloudflare\bridge\server.mjs
    }
    Invoke-Checked "Cloudflare bridge serialization parse" {
        node --check .\cloudflare\bridge\serialization.mjs
    }
    Invoke-Checked "Cloudflare Worker parse" {
        node --check .\cloudflare\worker\src\index.js
    }
    Invoke-Checked "Cloudflare smoke client parse" {
        node --check .\validation\bridge-smoke-client.mjs
    }
    Push-Location $portalRoot
    try {
        Invoke-Checked "actual Worker recovery tests" {
            node --test .\tests\cpoly-recovery-worker.test.mjs
        }
        Invoke-Checked "actual Worker container-provider tests" {
            node --test .\tests\cpoly-postgres-container.test.mjs
        }
    }
    finally {
        Pop-Location
    }

    if (Test-Path $work) {
        Remove-Item -Recurse -Force $work
    }
    New-Item -ItemType Directory -Force $secretDir, $migrationDir | Out-Null

    @(
        "postgres-superuser-password",
        "adg-migrator-password",
        "adg-runtime-password",
        "adg-backup-password",
        "postgres-server.crt",
        "postgres-server.key",
        "postgres-ca.crt",
        "backup-aws-access-key-id",
        "backup-aws-secret-access-key",
        "backup-libsodium-key"
    ) | ForEach-Object {
        Set-Content -NoNewline -Path (Join-Path $secretDir $_) -Value "validation-placeholder-only"
    }

    $env:CPOLY_SECRET_DIR = $secretDir
    $env:ADG_POSTGRES_MIGRATIONS_DIR = $migrationDir
    $env:WALG_S3_PREFIX = "s3://validation-only/adg-postgres"
    $env:AWS_ENDPOINT = "https://validation.invalid"

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "docker is required for docker compose config validation."
    }
    Invoke-Checked "docker compose config" {
        docker compose -f .\standard\docker-compose.yml config --quiet
    }
    Invoke-Checked "Cloudflare Dockerfile check" {
        docker build --quiet `
            --tag adg-cpoly-postgres-cloudflare:validation `
            .\cloudflare | Out-Null
    }

    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        throw "kubectl is required for Kustomize and manifest validation."
    }
    Invoke-Checked "Kustomize render" {
        kubectl kustomize . | Set-Content -Encoding utf8 $rendered
    }
    if ((Get-Item $rendered).Length -eq 0) {
        throw "Kustomize base render produced no resources."
    }
    Write-Host "OK Kubernetes base manifest parse (offline Kustomize)"

    Invoke-Checked "Kubernetes operations render" {
        kubectl kustomize .\kubernetes\operations |
            Set-Content -Encoding utf8 $renderedOperations
    }
    if ((Get-Item $renderedOperations).Length -eq 0) {
        throw "Kustomize operations render produced no resources."
    }
    Write-Host "OK Kubernetes operation manifest parse (offline Kustomize)"

    Invoke-Checked "Optional WAL-G render" {
        kubectl kustomize .\kubernetes\optional\walg |
            Set-Content -Encoding utf8 $renderedWalg
    }
    if ((Get-Item $renderedWalg).Length -eq 0) {
        throw "Kustomize optional WAL-G render produced no resources."
    }
    Write-Host "OK optional WAL-G manifest parse (offline Kustomize)"

    Invoke-Checked "Optional Qdrant GPG render" {
        kubectl kustomize .\kubernetes\optional\qdrant-gpg |
            Set-Content -Encoding utf8 $renderedQdrantGpg
    }
    if ((Get-Item $renderedQdrantGpg).Length -eq 0) {
        throw "Kustomize optional Qdrant GPG render produced no resources."
    }
    Write-Host "OK optional Qdrant GPG manifest parse (offline Kustomize)"

    Write-Host "PASS all CPOLY PostgreSQL validations"
}
finally {
    Remove-Item Env:CPOLY_SECRET_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:ADG_POSTGRES_MIGRATIONS_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:WALG_S3_PREFIX -ErrorAction SilentlyContinue
    Remove-Item Env:AWS_ENDPOINT -ErrorAction SilentlyContinue
    if (Test-Path $work) {
        Remove-Item -Recurse -Force $work
    }
    Pop-Location
}
