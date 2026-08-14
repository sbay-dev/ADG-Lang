$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$work = Join-Path $root ".validation-cloudflare-container"
$hmacFile = Join-Path $work "backup-hmac-key"
$baseUrlFile = Join-Path $work "backup-base-url"
$hostBaseUrlFile = Join-Path $work "backup-base-url-host"
$tokenFile = Join-Path $work "bridge-token"
$workerOut = Join-Path $work "worker.stdout.log"
$workerErr = Join-Path $work "worker.stderr.log"
$latestArchive = Join-Path $work "latest.dump"
$workerPort = 18767
$bridgePort = 18080
$containerName = "adg-cpoly-postgres-cloudflare-validation"
$image = "adg-cpoly-postgres-cloudflare:validation"
$workerProcess = $null

New-Item -ItemType Directory -Force $work | Out-Null
[IO.File]::WriteAllText(
    $hmacFile,
    "Validation-HMAC-Key-At-Least-32-Bytes-Only!",
    [Text.UTF8Encoding]::new($false)
)
[IO.File]::WriteAllText(
    $baseUrlFile,
    "http://host.docker.internal:$workerPort",
    [Text.UTF8Encoding]::new($false)
)
[IO.File]::WriteAllText(
    $hostBaseUrlFile,
    "http://127.0.0.1:$workerPort",
    [Text.UTF8Encoding]::new($false)
)
[IO.File]::WriteAllText(
    $tokenFile,
    "Validation-Bridge-Bearer-Token-At-Least-32-Bytes!",
    [Text.UTF8Encoding]::new($false)
)

function Start-DatabaseContainer {
    param([bool]$AllowFresh)

    $fresh = if ($AllowFresh) { "true" } else { "false" }
    docker run -d `
        --name $containerName `
        -p "127.0.0.1:${bridgePort}:18444" `
        -e "CPOLY_POSTGRES_INTERNAL_TOKEN=Validation-Bridge-Bearer-Token-At-Least-32-Bytes!" `
        -e "CPOLY_BACKUP_HMAC_KEY=Validation-HMAC-Key-At-Least-32-Bytes-Only!" `
        -e "CPOLY_BACKUP_BASE_URL=http://host.docker.internal:$workerPort" `
        -e "ADG_BACKUP_ALLOW_HTTP=true" `
        -e "ADG_MIGRATOR_PASSWORD=ValidationMigratorPassword-Only-02!" `
        -e "ADG_RUNTIME_PASSWORD=ValidationRuntimePassword-Only-03!" `
        -e "ADG_BACKUP_PASSWORD=ValidationBackupPassword-Only-04!" `
        -e "POSTGRES_SUPERUSER_PASSWORD=ValidationSuperuserPassword-Only-01!" `
        -e "CPOLY_ALLOW_FRESH_BOOTSTRAP=$fresh" `
        -e "CPOLY_BACKUP_ON_SIGTERM=true" `
        $image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare-equivalent container did not start." }

    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        try {
            $recovery = Invoke-BridgeClient "recovery" | ConvertFrom-Json
            if ($recovery.status.ready -eq $true) { return }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    docker logs $containerName
    throw "Cloudflare-equivalent container did not become ready."
}

function Invoke-BridgeClient {
    param([string]$Action)
    $output = node (Join-Path $root "validation\bridge-smoke-client.mjs") `
        --base-url "http://127.0.0.1:$bridgePort" `
        --token-file $tokenFile `
        --action $Action 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Bridge client action failed: $Action" }
    return ($output -join "`n").Trim()
}

try {
    docker rm -f $containerName 2>$null | Out-Null
    $node = (Get-Command node -ErrorAction Stop).Source
    $workerProcess = Start-Process -FilePath $node -PassThru -WindowStyle Hidden `
        -ArgumentList @(
            (Join-Path $root "validation\real-worker-backup-harness.mjs"),
            "--key-file", $hmacFile,
            "--bridge-base-url", "http://127.0.0.1:$bridgePort",
            "--bridge-token-file", $tokenFile,
            "--port", "$workerPort"
        ) `
        -RedirectStandardOutput $workerOut `
        -RedirectStandardError $workerErr

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod `
                "http://127.0.0.1:$workerPort/__harness/healthz" -TimeoutSec 2
            if ($health.ok -eq $true) { break }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }

    Start-DatabaseContainer -AllowFresh $true
    $seed = Invoke-BridgeClient "seed" | ConvertFrom-Json
    $sourceHash = Invoke-BridgeClient "hash"
    Invoke-BridgeClient "backup" | Out-Null

    for ($attempt = 0; $attempt -lt 240; $attempt++) {
        $status = Invoke-BridgeClient "recovery" | ConvertFrom-Json
        if ($status.status.backupInProgress -eq $false -and $attempt -gt 0) {
            if ($status.status.lastError) { throw "On-demand backup failed." }
            break
        }
        Start-Sleep -Seconds 1
    }

    docker stop --time 130 $containerName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "SIGTERM container stop failed." }
    $terminatedLogs = docker logs $containerName 2>&1 | Out-String
    if ($terminatedLogs -notmatch "CLOUDFLARE_CONTAINER_BACKUP_COMPLETE") {
        throw "SIGTERM backup completion evidence was absent."
    }
    docker rm $containerName | Out-Null

    $env:ADG_BACKUP_BASE_URL_FILE = $hostBaseUrlFile
    $env:ADG_BACKUP_HMAC_KEY_FILE = $hmacFile
    $env:ADG_BACKUP_ALLOW_HTTP = "true"
    python (Join-Path $root "scripts\d1_backup_client.py") download `
        --output $latestArchive
    if ($LASTEXITCODE -ne 0) { throw "KV archive reconstruction failed." }
    $archiveHash =
        (Get-FileHash -Algorithm SHA256 $latestArchive).Hash.ToLowerInvariant()

    Start-DatabaseContainer -AllowFresh $false
    $restoredHash = Invoke-BridgeClient "hash"
    $recovery = Invoke-BridgeClient "recovery" | ConvertFrom-Json
    if ($restoredHash -ne $sourceHash) {
        throw "Restored Cloudflare-container data hash differs from source."
    }
    if (($recovery.status.ready -ne $true) `
        -or (([long]$recovery.status.currentGeneration) -lt 2) `
        -or (([long]$recovery.status.receiptWatermark) -lt ([long]$seed.receiptSeq))) {
        throw "Recovered generation/receipt watermark is invalid."
    }

    Write-Host "PASS Cloudflare container recovery archiveSha=$archiveHash dataSha=$restoredHash generation=$($recovery.status.currentGeneration) receipt=$($recovery.status.receiptWatermark)"
}
catch {
    if (Test-Path $workerErr) { Write-Host (Get-Content -Raw $workerErr) }
    throw
}
finally {
    docker rm -f $containerName 2>$null | Out-Null
    if ($null -ne $workerProcess) {
        if (-not $workerProcess.HasExited) {
            Stop-Process -Id $workerProcess.Id -Force
        }
        Wait-Process -Id $workerProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
        $workerProcess.Dispose()
    }
    Remove-Item Env:ADG_BACKUP_BASE_URL_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:ADG_BACKUP_HMAC_KEY_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:ADG_BACKUP_ALLOW_HTTP -ErrorAction SilentlyContinue
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path $work); $attempt++) {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
        if (Test-Path $work) { Start-Sleep -Milliseconds 200 }
    }
}
