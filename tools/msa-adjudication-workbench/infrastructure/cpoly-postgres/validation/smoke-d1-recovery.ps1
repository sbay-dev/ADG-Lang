$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $root "standard\docker-compose.yml"
$work = Join-Path $root ".validation-d1-recovery"
$secretDir = Join-Path $work "secrets"
$migrationDir = Join-Path $root "migrations\postgresql"
$archive = Join-Path $work "adg-adjudication.dump"
$archiveMetadata = Join-Path $work "manifest-base.json"
$restoreEvidence = Join-Path $work "restore-evidence.json"
$secondBackupDir = Join-Path $work "second-backup"
$secondArchive = Join-Path $secondBackupDir "adg-adjudication.dump"
$secondMetadata = Join-Path $secondBackupDir "manifest-base.json"
$secondEvidence = Join-Path $secondBackupDir "restore-evidence.json"
$restoredArchive = Join-Path $work "adg-adjudication.restored.dump"
$recoveryState = Join-Path $work "recovery-state.json"
$recoveryReady = Join-Path $work "recovery-ready.tsv"
$hmacKeyFile = Join-Path $work "backup-hmac-key"
$baseUrlFile = Join-Path $work "backup-base-url"
$workerStdout = Join-Path $work "worker.stdout.log"
$workerStderr = Join-Path $work "worker.stderr.log"
$volume = "cpoly-adg-postgres-d1-recovery-validation"
$project = "cpoly-adg-postgres"
$container = "cpoly-adg-postgres-postgres-1"
$workerPort = 18765
$workerProcess = $null

function Write-Utf8File {
    param([string]$Path, [string]$Value)
    [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Wait-PostgresHealthy {
    $status = "unknown"
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $status = docker inspect --format "{{.State.Health.Status}}" $container 2>$null
        if ($status -eq "healthy") { return }
        if ($status -eq "unhealthy") { break }
        Start-Sleep -Seconds 2
    }
    docker compose -f $composeFile logs --no-color postgres
    throw "PostgreSQL health check failed: $status"
}

function Start-FreshPostgres {
    docker compose -f $composeFile up -d postgres
    if ($LASTEXITCODE -ne 0) { throw "Compose PostgreSQL startup failed." }
    Wait-PostgresHealthy
}

$existing = docker ps -a --filter "label=com.docker.compose.project=$project" --format "{{.ID}}"
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Docker containers." }
if ($existing) { throw "Recovery smoke refuses to collide with an existing $project project." }
docker volume inspect $volume 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw "Recovery smoke volume already exists: $volume" }

$portProbe = [Net.Sockets.TcpClient]::new()
try {
    $portProbe.Connect("127.0.0.1", $workerPort)
    throw "Recovery smoke port is already in use: $workerPort"
}
catch [Net.Sockets.SocketException] {
}
catch {
    if (Test-Path $workerStderr) {
        Write-Host (Get-Content -Raw $workerStderr)
    }
    throw
}
finally {
    $portProbe.Dispose()
}

New-Item -ItemType Directory -Force $secretDir | Out-Null
New-Item -ItemType Directory -Force $secondBackupDir | Out-Null

$validationSecrets = @{
    "postgres-superuser-password" = "ValidationSuperuserPassword-Only-01!"
    "adg-migrator-password" = "ValidationMigratorPassword-Only-02!"
    "adg-runtime-password" = "ValidationRuntimePassword-Only-03!"
    "adg-backup-password" = "ValidationBackupPassword-Only-04!"
    "backup-aws-access-key-id" = "validation-access-key-only"
    "backup-aws-secret-access-key" = "validation-secret-key-only"
    "backup-libsodium-key" = "dmFsaWRhdGlvbi1vbmx5LWxpYnNvZGl1bS1rZXktMzI="
}
foreach ($item in $validationSecrets.GetEnumerator()) {
    Write-Utf8File (Join-Path $secretDir $item.Key) $item.Value
}
Write-Utf8File $hmacKeyFile "Validation-HMAC-Key-At-Least-32-Bytes-Only!"
Write-Utf8File $baseUrlFile "http://127.0.0.1:$workerPort"

$openssl = (Get-Command openssl -ErrorAction Stop).Source
& $openssl req -x509 -newkey rsa:2048 -nodes -days 1 `
    -subj "/CN=CPOLY Validation CA" `
    -keyout (Join-Path $work "ca.key") `
    -out (Join-Path $secretDir "postgres-ca.crt") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation CA generation failed." }
& $openssl req -newkey rsa:2048 -nodes -subj "/CN=postgres" `
    -keyout (Join-Path $secretDir "postgres-server.key") `
    -out (Join-Path $work "server.csr") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation CSR generation failed." }
Write-Utf8File (Join-Path $work "san.ext") `
    "subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1`n"
& $openssl x509 -req -days 1 `
    -in (Join-Path $work "server.csr") `
    -CA (Join-Path $secretDir "postgres-ca.crt") `
    -CAkey (Join-Path $work "ca.key") `
    -CAcreateserial `
    -extfile (Join-Path $work "san.ext") `
    -out (Join-Path $secretDir "postgres-server.crt") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation certificate signing failed." }

$env:CPOLY_SECRET_DIR = $secretDir
$env:ADG_POSTGRES_MIGRATIONS_DIR = $migrationDir
$env:CPOLY_POSTGRES_DATA_VOLUME = $volume
$env:CPOLY_POSTGRES_PORT = "55433"
$env:CPOLY_POSTGRES_BIND_ADDRESS = "127.0.0.1"
$env:WALG_S3_PREFIX = "s3://validation-only/adg-postgres"
$env:AWS_ENDPOINT = "https://validation.invalid"
$env:ADG_BACKUP_BASE_URL_FILE = $baseUrlFile
$env:ADG_BACKUP_HMAC_KEY_FILE = $hmacKeyFile
$env:ADG_BACKUP_ALLOW_HTTP = "true"
$env:ADG_BACKUP_CHUNK_BYTES = "65536"

try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $workerProcess = Start-Process -FilePath $node -PassThru -WindowStyle Hidden `
        -ArgumentList @(
            (Join-Path $root "validation\real-worker-backup-harness.mjs"),
            "--key-file", $hmacKeyFile,
            "--port", "$workerPort"
        ) `
        -RedirectStandardOutput $workerStdout `
        -RedirectStandardError $workerStderr

    $workerReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$workerPort/__harness/healthz" -TimeoutSec 2
            if ($health.ok -eq $true) {
                $workerReady = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $workerReady) {
        $workerError = Get-Content -Raw $workerStderr -ErrorAction SilentlyContinue
        throw "Actual Worker backup harness did not become ready. $workerError"
    }

    Start-FreshPostgres
    docker compose -f $composeFile --profile operations run --rm migrate
    if ($LASTEXITCODE -ne 0) { throw "Initial migration failed." }

    docker compose -f $composeFile exec -T --user postgres postgres `
        psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication -c `
        "SET ROLE adg_owner; CREATE TABLE adjudication.recovery_seed(id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO adjudication.recovery_seed SELECT value, repeat(md5(value::text), 8) FROM generate_series(1, 5000) AS value; INSERT INTO adjudication.cpoly_write_receipts(generation,request_id,payload_hash,operation_kind,statement_count,applied_at) VALUES (1, '00000000-0000-4000-8000-000000000001', repeat('a',64), 'run', 1, 1);"
    if ($LASTEXITCODE -ne 0) { throw "Recovery seed creation failed." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'export PGPASSWORD="$(cat /run/secrets/roles/adg-runtime-password)"; test "$(psql "host=postgres port=5432 dbname=adg_adjudication user=adg_runtime sslmode=verify-full sslrootcert=/run/secrets/tls/postgres-ca.crt" -Atqc "SELECT to_regclass(''users'')::text")" = "users"'
    if ($LASTEXITCODE -ne 0) { throw "Runtime search_path does not resolve adjudication." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'export PGPASSWORD="$(cat /run/secrets/roles/adg-runtime-password)"; psql "host=postgres port=5432 dbname=adg_adjudication user=adg_runtime sslmode=verify-full sslrootcert=/run/secrets/tls/postgres-ca.crt" -v ON_ERROR_STOP=1 -c "UPDATE adjudication.cpoly_recovery_state SET ready = TRUE;" >/dev/null 2>&1'
    if ($LASTEXITCODE -eq 0) { throw "Runtime role can mutate the recovery gate." }

    $beforeHash = docker compose -f $composeFile exec -T --user postgres postgres `
        /bin/sh -c 'psql -U postgres -d adg_adjudication -At -F "|" -c "SELECT id,payload FROM adjudication.recovery_seed ORDER BY id" | sha256sum | awk "{print \$1}"'
    if ($LASTEXITCODE -ne 0 -or $beforeHash -notmatch "^[0-9a-f]{64}$") {
        throw "Unable to calculate source data hash."
    }

    docker compose -f $composeFile exec -T --user postgres postgres /bin/sh -c `
        'mkdir -p /var/lib/postgresql/data/backup-work; BACKUP_ROOT=/var/lib/postgresql/data/backup-work PGHOST=postgres PGPORT=5432 PGDATABASE=adg_adjudication PGUSER=adg_backup PGSSLMODE=verify-full PGSSLROOTCERT=/run/secrets/tls/postgres-ca.crt /bin/sh /opt/cpoly/scripts/create-kv-binary-backup.sh'
    if ($LASTEXITCODE -ne 0) { throw "KV binary backup creation failed." }
    docker compose -f $composeFile exec -T --user postgres postgres /bin/sh -c `
        'VERIFY_ROOT=/var/lib/postgresql/data/disposable-verify BINARY_ARCHIVE=/var/lib/postgresql/data/backup-work/adg-adjudication.dump RESTORE_EVIDENCE_FILE=/var/lib/postgresql/data/backup-work/restore-evidence.json /bin/sh /opt/cpoly/scripts/verify-binary-backup-job.sh'
    if ($LASTEXITCODE -ne 0) { throw "Disposable PostgreSQL 16 restore verification failed." }

    docker cp "${container}:/var/lib/postgresql/data/backup-work/adg-adjudication.dump" $archive | Out-Null
    docker cp "${container}:/var/lib/postgresql/data/backup-work/manifest-base.json" $archiveMetadata | Out-Null
    docker cp "${container}:/var/lib/postgresql/data/backup-work/restore-evidence.json" $restoreEvidence | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archive) `
        -or -not (Test-Path $archiveMetadata) -or -not (Test-Path $restoreEvidence)) {
        throw "Unable to copy encrypted backup descriptor artifacts."
    }

    python (Join-Path $root "scripts\d1_backup_client.py") upload `
        --archive $archive `
        --manifest-base $archiveMetadata `
        --restore-evidence $restoreEvidence `
        --archive-format postgres-custom `
        --encryption-format none `
        --database adg_adjudication
    if ($LASTEXITCODE -ne 0) { throw "Signed D1-compatible upload failed." }
    $sourceArchiveHash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()

    docker compose -f $composeFile exec -T --user postgres postgres `
        psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication -c `
        "SET ROLE adg_owner; UPDATE adjudication.cpoly_runtime_state SET current_generation = 2, updated_at = 2 WHERE singleton = TRUE; INSERT INTO adjudication.cpoly_write_receipts(generation,request_id,payload_hash,operation_kind,statement_count,applied_at) VALUES (2, '00000000-0000-4000-8000-000000000002', repeat('b',64), 'run', 1, 2);"
    if ($LASTEXITCODE -ne 0) { throw "Second backup generation seed failed." }

    docker compose -f $composeFile exec -T --user postgres postgres /bin/sh -c `
        'rm -rf /var/lib/postgresql/data/backup-work-2 /var/lib/postgresql/data/disposable-verify-2; mkdir -p /var/lib/postgresql/data/backup-work-2; BACKUP_ROOT=/var/lib/postgresql/data/backup-work-2 PGHOST=postgres PGPORT=5432 PGDATABASE=adg_adjudication PGUSER=adg_backup PGSSLMODE=verify-full PGSSLROOTCERT=/run/secrets/tls/postgres-ca.crt /bin/sh /opt/cpoly/scripts/create-kv-binary-backup.sh'
    if ($LASTEXITCODE -ne 0) { throw "Second-generation KV backup creation failed." }
    docker compose -f $composeFile exec -T --user postgres postgres /bin/sh -c `
        'VERIFY_ROOT=/var/lib/postgresql/data/disposable-verify-2 BINARY_ARCHIVE=/var/lib/postgresql/data/backup-work-2/adg-adjudication.dump RESTORE_EVIDENCE_FILE=/var/lib/postgresql/data/backup-work-2/restore-evidence.json /bin/sh /opt/cpoly/scripts/verify-binary-backup-job.sh'
    if ($LASTEXITCODE -ne 0) { throw "Second-generation restore verification failed." }
    docker cp "${container}:/var/lib/postgresql/data/backup-work-2/adg-adjudication.dump" $secondArchive | Out-Null
    docker cp "${container}:/var/lib/postgresql/data/backup-work-2/manifest-base.json" $secondMetadata | Out-Null
    docker cp "${container}:/var/lib/postgresql/data/backup-work-2/restore-evidence.json" $secondEvidence | Out-Null
    python (Join-Path $root "scripts\d1_backup_client.py") upload `
        --archive $secondArchive `
        --manifest-base $secondMetadata `
        --restore-evidence $secondEvidence `
        --archive-format postgres-custom `
        --encryption-format none `
        --database adg_adjudication
    if ($LASTEXITCODE -ne 0) { throw "Second-generation upload failed." }

    $delay = Invoke-RestMethod `
        "http://127.0.0.1:$workerPort/__harness/delay-latest?reads=10" `
        -TimeoutSec 10
    if ($delay.delayedKeys -lt 1) { throw "KV delayed visibility was not configured." }

    docker compose -f $composeFile down --remove-orphans | Out-Null
    docker volume rm $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Destructive PGDATA volume removal failed." }

    Start-FreshPostgres
    $downloadOutput = python (Join-Path $root "scripts\d1_backup_client.py") download `
        --begin-recovery `
        --recovery-state $recoveryState `
        --output $restoredArchive `
        --manifest-output (Join-Path $work "restored-manifest.json")
    if ($LASTEXITCODE -ne 0) { throw "Signed D1-compatible download failed." }
    $downloadText = ($downloadOutput -join "`n")
    Write-Host $downloadText
    if ($downloadText -notmatch "RESTORE_FALLBACK") {
        throw "Client did not fall back from the delayed newest KV generation."
    }
    $reconstructedArchiveHash =
        (Get-FileHash -Algorithm SHA256 $restoredArchive).Hash.ToLowerInvariant()
    if ($sourceArchiveHash -ne $reconstructedArchiveHash) {
        throw "Reconstructed PostgreSQL archive SHA-256 differs from the uploaded binary."
    }

    docker cp $restoredArchive "${container}:/var/lib/postgresql/data/adg-adjudication.dump" | Out-Null
    docker cp "$migrationDir\." "${container}:/var/lib/postgresql/data/migrations" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to stage restore inputs." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'BINARY_ARCHIVE=/var/lib/postgresql/data/adg-adjudication.dump MIGRATIONS_DIR=/var/lib/postgresql/data/migrations PGHOST=postgres PGPORT=5432 PGDATABASE=adg_adjudication PGUSER=adg_migrator PGSSLMODE=verify-full PGSSLROOTCERT=/run/secrets/tls/postgres-ca.crt /bin/sh /opt/cpoly/scripts/restore-binary-backup.sh'
    if ($LASTEXITCODE -ne 0) { throw "Logical restore into fresh PGDATA failed." }

    $recoveryStateValue = Get-Content -Raw $recoveryState | ConvertFrom-Json
    $targetGeneration = [long]$recoveryStateValue.recovery.targetGeneration
    docker compose -f $composeFile exec -T --user postgres postgres `
        psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication -c `
        "SET ROLE adg_owner; UPDATE adjudication.cpoly_runtime_state SET current_generation = $targetGeneration, updated_at = 2 WHERE singleton = TRUE; INSERT INTO adjudication.cpoly_write_receipts(generation,request_id,payload_hash,operation_kind,statement_count,applied_at) VALUES ($targetGeneration, '00000000-0000-4000-8000-000000000002', repeat('b',64), 'run', 1, 2);"
    if ($LASTEXITCODE -ne 0) { throw "Validation replay promotion failed." }

    python (Join-Path $root "scripts\d1_backup_client.py") recovery-complete `
        --recovery-state $recoveryState `
        --ready-output $recoveryReady `
        --timeout-seconds 120 `
        --poll-seconds 1
    if ($LASTEXITCODE -ne 0) { throw "Worker recovery completion gate failed." }

    docker cp $recoveryReady "${container}:/var/lib/postgresql/data/recovery-ready.tsv" | Out-Null
    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'RECOVERY_READY_FILE=/var/lib/postgresql/data/recovery-ready.tsv PGHOST=postgres PGPORT=5432 PGDATABASE=adg_adjudication PGUSER=adg_migrator PGSSLMODE=verify-full PGSSLROOTCERT=/run/secrets/tls/postgres-ca.crt /bin/sh /opt/cpoly/scripts/mark-recovery-ready.sh'
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL readiness gate did not open." }

    $gateState = docker compose -f $composeFile exec -T --user postgres postgres `
        psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication -Atqc `
        "SELECT ready AND worker_status = 'ready' AND snapshot_generation = 1 AND postgres_receipt_watermark = 1 FROM adjudication.cpoly_recovery_state;"
    if ($LASTEXITCODE -ne 0 -or $gateState.Trim() -ne "t") {
        throw "Recovery readiness state query failed."
    }

    $afterHash = docker compose -f $composeFile exec -T --user postgres postgres `
        /bin/sh -c 'psql -U postgres -d adg_adjudication -At -F "|" -c "SELECT id,payload FROM adjudication.recovery_seed ORDER BY id" | sha256sum | awk "{print \$1}"'
    if ($LASTEXITCODE -ne 0 -or $afterHash -ne $beforeHash) {
        throw "Recovered data hash does not match the seeded data hash."
    }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'BINARY_ARCHIVE=/var/lib/postgresql/data/adg-adjudication.dump MIGRATIONS_DIR=/var/lib/postgresql/data/migrations PGHOST=postgres PGPORT=5432 PGDATABASE=adg_adjudication PGUSER=adg_migrator PGSSLMODE=verify-full PGSSLROOTCERT=/run/secrets/tls/postgres-ca.crt /bin/sh /opt/cpoly/scripts/restore-binary-backup.sh >/dev/null 2>&1'
    if ($LASTEXITCODE -eq 0) {
        throw "Restore guard allowed overwrite of a non-empty database without confirmation."
    }

    Write-Host "PASS KV binary recovery smoke archiveSha=$reconstructedArchiveHash dataSha=$afterHash"
}
finally {
    docker compose -f $composeFile down --remove-orphans 2>$null | Out-Null
    docker volume rm $volume 2>$null | Out-Null
    if ($null -ne $workerProcess) {
        if (-not $workerProcess.HasExited) {
            Stop-Process -Id $workerProcess.Id -Force
        }
        Wait-Process -Id $workerProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
        $workerProcess.Dispose()
    }
    @(
        "CPOLY_SECRET_DIR",
        "ADG_POSTGRES_MIGRATIONS_DIR",
        "CPOLY_POSTGRES_DATA_VOLUME",
        "CPOLY_POSTGRES_PORT",
        "CPOLY_POSTGRES_BIND_ADDRESS",
        "WALG_S3_PREFIX",
        "AWS_ENDPOINT",
        "ADG_BACKUP_BASE_URL_FILE",
        "ADG_BACKUP_HMAC_KEY_FILE",
        "ADG_BACKUP_ALLOW_HTTP",
        "ADG_BACKUP_CHUNK_BYTES"
    ) | ForEach-Object {
        Remove-Item "Env:$_" -ErrorAction SilentlyContinue
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path $work); $attempt++) {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
        if (Test-Path $work) { Start-Sleep -Milliseconds 200 }
    }
}
