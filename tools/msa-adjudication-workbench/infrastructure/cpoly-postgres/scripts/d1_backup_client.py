#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import time
from urllib import error, parse, request
import uuid

API_PREFIX = "/api/internal/cpoly-backups"
BACKUP_DESCRIPTOR_SCHEMA = "adg.cpoly-postgres.backup.v1"
CREATE_SCHEMA = BACKUP_DESCRIPTOR_SCHEMA
COMPLETE_SCHEMA = BACKUP_DESCRIPTOR_SCHEMA
MANIFEST_SCHEMA = "cpoly_postgres_backup_v1"
GPG_CLAIM_BOUNDARY = (
    "This proves creation, integrity, encryption, and the requested restore "
    "test only. Off-host replication and recovery-time objectives require "
    "separate scheduled operations."
)
KV_BINARY_CLAIM_BOUNDARY = (
    "This proves creation, integrity, EntityCrypt protected-column "
    "attestations, separate role bootstrap handling, and the requested "
    "restore test only. Off-host replication and recovery-time objectives "
    "require separate scheduled operations."
)
DEFAULT_CHUNK_BYTES = 512 * 1024
MAX_CHUNK_BYTES = 512 * 1024
DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_CHUNKS = 512
DEFAULT_FETCH_RETRY_ATTEMPTS = 4
DEFAULT_FETCH_RETRY_DELAY_MS = 1500
CLIENT_USER_AGENT = "adg-cpoly-postgres-backup/1.0"


def fail(message):
    raise RuntimeError(message)


def canonical_json(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sha256_file(file_path):
    digest = hashlib.sha256()
    size = 0
    with file_path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def load_json(path_value, field_name):
    file_path = Path(path_value)
    if not file_path.is_file():
        fail(f"{field_name} file is absent: {file_path}")
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{field_name} JSON is invalid: {exc}")


class BackupApi:
    def __init__(self):
        base_url_path = Path(os.environ.get(
            "ADG_BACKUP_BASE_URL_FILE",
            "/run/secrets/portal-backup/base-url",
        ))
        key_path = Path(os.environ.get(
            "ADG_BACKUP_HMAC_KEY_FILE",
            "/run/secrets/portal-backup/hmac-key",
        ))
        if not base_url_path.is_file():
            fail(f"Backup URL secret file is absent: {base_url_path}")
        if not key_path.is_file():
            fail(f"Backup HMAC secret file is absent: {key_path}")

        self.base_url = base_url_path.read_text(encoding="utf-8").strip().rstrip("/")
        parsed = parse.urlsplit(self.base_url)
        allow_http = os.environ.get("ADG_BACKUP_ALLOW_HTTP", "false").lower() == "true"
        if parsed.scheme != "https" and not (allow_http and parsed.scheme == "http"):
            fail("Backup API must use HTTPS.")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            fail("Backup URL secret must contain an origin only, without a path/query.")
        if not parsed.hostname:
            fail("Backup URL secret is invalid.")

        self.key = key_path.read_bytes().strip()
        if len(self.key) < 32:
            fail("Backup HMAC key must contain at least 32 bytes.")

    def request(self, method, path, body=b"", content_type=None):
        method = method.upper()
        timestamp = str(int(time.time() * 1000))
        nonce = str(uuid.uuid4())
        body_sha256 = hashlib.sha256(body).hexdigest()
        canonical = "\n".join((
            method,
            path,
            timestamp,
            nonce,
            body_sha256,
        )).encode("utf-8")
        signature = hmac.new(self.key, canonical, hashlib.sha256).hexdigest()
        headers = {
            "accept": "application/json",
            "user-agent": CLIENT_USER_AGENT,
            "x-adg-timestamp": timestamp,
            "x-adg-nonce": nonce,
            "x-adg-content-sha256": body_sha256,
            "x-adg-signature": signature,
        }
        if content_type:
            headers["content-type"] = content_type
        data = body if method in ("POST", "PUT", "PATCH") else None
        api_request = request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with request.urlopen(api_request, timeout=120) as response:
                return response.status, response.read(), response.headers
        except error.HTTPError as exc:
            return exc.code, exc.read(), exc.headers
        except error.URLError as exc:
            fail(f"Backup API {method} {path} transport failed: {exc.reason}")

    def json_request(self, method, path, value=None, allowed_statuses=()):
        body = canonical_json(value) if value is not None else b""
        status, response_body, headers = self.request(
            method,
            path,
            body,
            "application/json" if value is not None else None,
        )
        try:
            payload = json.loads(response_body) if response_body else {}
        except json.JSONDecodeError as exc:
            response_type = headers.get("content-type", "unknown")
            fail(
                f"Backup API returned non-JSON HTTP {status} "
                f"({response_type}): {exc}"
            )
        if not 200 <= status < 300 and status not in allowed_statuses:
            fail(
                f"Backup API {method} {path} returned HTTP {status}: "
                f"{payload.get('message', 'request_failed')} "
                f"{payload.get('detail', '')}".strip()
            )
        return status, payload, headers


def build_chunks(archive_path, chunk_bytes, max_total_bytes, max_chunks):
    if chunk_bytes < 64 * 1024 or chunk_bytes > MAX_CHUNK_BYTES:
        fail(f"Chunk size must be between 65536 and {MAX_CHUNK_BYTES} bytes.")
    archive_sha256, archive_size = sha256_file(archive_path)
    if archive_size < 1 or archive_size > max_total_bytes:
        fail(f"Encrypted archive exceeds the bounded total cap: {archive_size}")
    chunks = []
    with archive_path.open("rb") as stream:
        index = 0
        while chunk := stream.read(chunk_bytes):
            chunks.append({
                "index": index,
                "sizeBytes": len(chunk),
                "sha256": hashlib.sha256(chunk).hexdigest(),
            })
            index += 1
    if not chunks or len(chunks) > max_chunks:
        fail("Encrypted archive chunk count exceeds the bounded cap.")
    return archive_sha256, archive_size, chunks


def parse_timestamp_ms(value, field_name):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        fail(f"{field_name} is invalid.")
    if parsed < 0:
        fail(f"{field_name} is invalid.")
    return parsed


def validate_backup_descriptor(backup, expected_archive_format=None):
    if not isinstance(backup, dict) or backup.get("status") != "complete":
        fail("No latest complete backup descriptor is available.")
    archive = backup.get("archive")
    chunks = backup.get("chunks")
    manifest = backup.get("metadata")
    if not isinstance(archive, dict) or not isinstance(chunks, list) \
            or not isinstance(manifest, dict):
        fail("Latest response must contain descriptor metadata only.")
    if expected_archive_format and archive.get("format") != expected_archive_format:
        fail("Latest archive format is incompatible.")
    if archive.get("chunkCount") != len(chunks):
        fail("Latest backup chunk count is inconsistent.")
    if int(archive.get("chunkSizeBytes", 0)) > MAX_CHUNK_BYTES \
            or int(archive.get("sizeBytes", 0)) > int(os.environ.get(
                "ADG_BACKUP_MAX_TOTAL_BYTES",
                DEFAULT_MAX_TOTAL_BYTES,
            )):
        fail("Latest descriptor exceeds the local recovery cap.")
    backup_id = str(backup.get("backupId", "")).lower()
    try:
        if str(uuid.UUID(backup_id, version=4)) != backup_id:
            fail("Latest backupId is not a UUIDv4.")
    except ValueError:
        fail("Latest backupId is invalid.")
    available_after = parse_timestamp_ms(
        backup.get("availableAfter", 0),
        "Latest backup availableAfter",
    )
    return {
        "backup": backup,
        "backup_id": backup_id,
        "archive": archive,
        "chunks": chunks,
        "manifest": manifest,
        "available_after": available_after,
    }


def sleep_ms(delay_ms):
    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)


def fetch_chunk_with_retry(api, backup_id, expected, max_attempts, retry_delay_ms):
    path = f"{API_PREFIX}/{backup_id}/chunks/{expected['index']}"
    last_error = None
    for attempt in range(max_attempts):
        status, chunk, headers = api.request("GET", path)
        if status == 200:
            chunk_hash = hashlib.sha256(chunk).hexdigest()
            response_hash = headers.get("x-adg-content-sha256")
            if len(chunk) == expected.get("sizeBytes") \
                    and len(chunk) <= MAX_CHUNK_BYTES \
                    and chunk_hash == expected.get("sha256") \
                    and (not response_hash or response_hash.lower() == chunk_hash):
                return chunk
            last_error = (
                f"Chunk integrity mismatch at index {expected['index']} "
                f"(attempt {attempt + 1}/{max_attempts})."
            )
        else:
            last_error = (
                f"Chunk download returned HTTP {status} at index {expected['index']} "
                f"(attempt {attempt + 1}/{max_attempts})."
            )
        if attempt + 1 < max_attempts:
            sleep_ms(retry_delay_ms * (attempt + 1))
    raise RuntimeError(last_error or "Chunk download failed.")


def validate_restore_evidence(manifest, restore_evidence):
    if restore_evidence.get("requested") is not True \
            or restore_evidence.get("status") != "PASS":
        fail("Restore evidence must be requested and PASS.")
    inventory = [str(row.get("name", "")) for row in manifest.get("databases", [])]
    evidence_rows = restore_evidence.get("databases")
    if not inventory or not isinstance(evidence_rows, list):
        fail("Restore evidence or database inventory is missing.")
    restored = [str(row.get("source_database", "")) for row in evidence_rows]
    if len(restored) != len(set(restored)):
        fail("Restore evidence contains a duplicate source database.")
    if sorted(restored) != sorted(inventory):
        fail("Restore evidence must cover every inventoried database exactly once.")
    for row in evidence_rows:
        if row.get("status") != "PASS" or int(row.get("restored_bytes", 0)) < 1:
            fail("Every restore evidence row must report PASS and positive bytes.")
    return restore_evidence


def build_upload_spec(args):
    archive_path = Path(args.archive)
    if not archive_path.is_file():
        fail(f"Encrypted archive is absent: {archive_path}")
    with archive_path.open("rb") as stream:
        prefix = stream.read(5)
    if args.archive_format == "postgres-custom":
        if prefix != b"PGDMP":
            fail("Backup archive is not PostgreSQL custom format.")
    elif args.archive_format == "openpgp-aes256-tar":
        if not prefix or prefix[0] & 0x80 == 0:
            fail("Encrypted archive does not appear to be binary OpenPGP.")
    else:
        fail("Unsupported archive format.")

    manifest = load_json(args.manifest_base, "Manifest base")
    restore_evidence = load_json(args.restore_evidence, "Restore evidence")
    if manifest.get("schema") != MANIFEST_SCHEMA:
        fail("Manifest base schema is incompatible with the Worker.")
    expected_boundary = (
        KV_BINARY_CLAIM_BOUNDARY
        if args.archive_format == "postgres-custom"
        else GPG_CLAIM_BOUNDARY
    )
    if manifest.get("claim_boundary") != expected_boundary:
        fail("Manifest claim boundary is incompatible with the selected lane.")
    if int(manifest.get("snapshotGeneration", -1)) < 1:
        fail("Manifest snapshotGeneration must be positive and monotonic.")
    if int(manifest.get("postgresReceiptWatermark", -1)) < 0:
        fail("Manifest postgresReceiptWatermark is invalid.")
    manifest["restore_test"] = validate_restore_evidence(
        manifest,
        restore_evidence,
    )

    chunk_bytes = int(os.environ.get("ADG_BACKUP_CHUNK_BYTES", DEFAULT_CHUNK_BYTES))
    max_total_bytes = int(os.environ.get(
        "ADG_BACKUP_MAX_TOTAL_BYTES",
        DEFAULT_MAX_TOTAL_BYTES,
    ))
    max_chunks = int(os.environ.get("ADG_BACKUP_MAX_CHUNKS", DEFAULT_MAX_CHUNKS))
    archive_sha256, archive_size, chunks = build_chunks(
        archive_path,
        chunk_bytes,
        max_total_bytes,
        max_chunks,
    )
    archive = {
        "database": args.database,
        "format": args.archive_format,
        "fileName": archive_path.name,
        "sizeBytes": archive_size,
        "sha256": archive_sha256,
        "chunkCount": len(chunks),
        "chunkSizeBytes": max(chunk["sizeBytes"] for chunk in chunks),
        "contentType": "application/octet-stream",
        "encryptionFormat": args.encryption_format,
    }
    if args.archive_format == "postgres-custom":
        attestations = manifest.get("attestations")
        if not isinstance(attestations, dict) \
                or attestations.get("schema") != \
                "adg.cpoly-postgres.backup-attestations.v1" \
                or attestations.get("protected_columns_entitycrypt") is not True \
                or attestations.get("role_password_material_excluded") is not True \
                or attestations.get("bootstrap_roles_separate") is not True:
            fail("KV binary lane requires the finalized EntityCrypt/role attestations.")
    else:
        encryption = manifest.get("encryption")
        if not isinstance(encryption, dict) \
                or encryption.get("encrypted_archive") != archive["fileName"] \
                or int(encryption.get("encrypted_bytes", 0)) != archive_size \
                or encryption.get("encrypted_sha256") != archive_sha256 \
                or encryption.get("round_trip_verified") is not True:
            fail("Manifest encryption metadata does not match the encrypted archive.")
    retention_hours = int(os.environ.get("ADG_BACKUP_RETENTION_HOURS", "168"))
    create_body = {
        "schema": CREATE_SCHEMA,
        "retentionHours": retention_hours,
        "metadata": manifest,
        "archive": archive,
        "chunks": chunks,
    }
    complete_body = {
        "schema": COMPLETE_SCHEMA,
        "chunkCount": archive["chunkCount"],
        "totalBytes": archive["sizeBytes"],
        "sha256": archive["sha256"],
    }
    return archive_path, manifest, archive, chunks, create_body, complete_body


def upload(args):
    archive_path, manifest, archive, chunks, create_body, complete_body = \
        build_upload_spec(args)
    api = BackupApi()
    _, created, _ = api.json_request("POST", API_PREFIX, create_body)
    if created.get("ok") is not True or not isinstance(created.get("backup"), dict):
        fail("Worker create response shape is incompatible.")
    created_backup = created["backup"]
    backup_id = str(created_backup.get("backupId", "")).lower()
    try:
        if str(uuid.UUID(backup_id, version=4)) != backup_id:
            fail("Worker returned a non-v4 backupId.")
    except ValueError:
        fail("Worker returned an invalid backupId.")
    if int(created_backup.get("maxChunkBytes", MAX_CHUNK_BYTES)) < archive["chunkSizeBytes"]:
        fail("Worker chunk cap is below the signed descriptor.")
    if int(created_backup.get("maxChunks", DEFAULT_MAX_CHUNKS)) < archive["chunkCount"]:
        fail("Worker chunk-count cap is below the signed descriptor.")
    if int(created_backup.get("maxBackupBytes", DEFAULT_MAX_TOTAL_BYTES)) < archive["sizeBytes"]:
        fail("Worker total-size cap is below the signed descriptor.")
    complete_body["backupId"] = backup_id

    chunk_bytes = archive["chunkSizeBytes"]
    with archive_path.open("rb") as stream:
        for expected in chunks:
            chunk = stream.read(chunk_bytes)
            if len(chunk) != expected["sizeBytes"] \
                    or hashlib.sha256(chunk).hexdigest() != expected["sha256"]:
                fail(f"Local chunk changed at index {expected['index']}.")
            path = f"{API_PREFIX}/{backup_id}/chunks/{expected['index']}"
            status, response_body, _ = api.request(
                "PUT",
                path,
                chunk,
                "application/octet-stream",
            )
            if status != 200:
                fail(f"Chunk upload returned HTTP {status}.")
            payload = json.loads(response_body)
            if payload.get("accepted") is not True \
                    or payload.get("backupId") != backup_id \
                    or int(payload.get("chunkIndex", -1)) != expected["index"]:
                fail(f"Worker chunk response shape is incompatible at index {expected['index']}.")

    _, completed, _ = api.json_request(
        "POST",
        f"{API_PREFIX}/{backup_id}/complete",
        complete_body,
    )
    if completed.get("ok") is not True \
            or completed.get("backup", {}).get("status") != "complete":
        fail("Worker complete response shape is incompatible.")

    _, latest, _ = api.json_request("GET", f"{API_PREFIX}/latest")
    latest_backup = latest.get("backup")
    if not isinstance(latest_backup, dict) \
            or latest_backup.get("backupId") != backup_id \
            or latest_backup.get("status") != "complete":
        fail("Worker latest response does not identify the completed backup.")
    if latest_backup.get("metadata") != manifest \
            or latest_backup.get("archive") != archive \
            or latest_backup.get("chunks") != chunks:
        fail("Worker latest descriptor does not match the signed upload.")

    print(
        f"BACKUP_COMPLETE id={backup_id} chunks={archive['chunkCount']} "
        f"sha256={archive['sha256']} generation={manifest['snapshotGeneration']} "
        f"watermark={manifest['postgresReceiptWatermark']}"
    )


def download(args):
    output_path = Path(args.output)
    manifest_output = Path(args.manifest_output) if args.manifest_output else None
    if output_path.exists():
        fail(f"Restore output already exists: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = output_path.with_suffix(output_path.suffix + ".partial")
    if partial_path.exists():
        partial_path.unlink()

    api = BackupApi()
    _, latest, _ = api.json_request("GET", f"{API_PREFIX}/latest")
    primary = validate_backup_descriptor(
        latest.get("backup"),
        args.expected_archive_format,
    )
    prior = latest.get("priorBackup")
    fallback = None
    if prior is not None:
        fallback = validate_backup_descriptor(
            prior,
            args.expected_archive_format,
        )
    retry_attempts = max(
        1,
        int(os.environ.get(
            "ADG_BACKUP_FETCH_RETRY_ATTEMPTS",
            DEFAULT_FETCH_RETRY_ATTEMPTS,
        )),
    )
    retry_delay_ms = max(
        100,
        int(os.environ.get(
            "ADG_BACKUP_FETCH_RETRY_DELAY_MS",
            DEFAULT_FETCH_RETRY_DELAY_MS,
        )),
    )

    chosen = None
    used_fallback = False
    last_error = None
    for candidate in [primary, fallback]:
        if candidate is None:
            continue
        if partial_path.exists():
            partial_path.unlink()
        available_delay = candidate["available_after"] - int(time.time() * 1000)
        if available_delay > 0:
            sleep_ms(min(available_delay, retry_delay_ms))
        final_digest = hashlib.sha256()
        final_size = 0
        try:
            with partial_path.open("xb") as output:
                for expected_index, expected in enumerate(candidate["chunks"]):
                    if expected.get("index") != expected_index:
                        fail("Latest backup chunk indexes are not contiguous.")
                    chunk = fetch_chunk_with_retry(
                        api,
                        candidate["backup_id"],
                        expected,
                        retry_attempts,
                        retry_delay_ms,
                    )
                    output.write(chunk)
                    final_digest.update(chunk)
                    final_size += len(chunk)

            if final_size != candidate["archive"].get("sizeBytes") \
                    or final_digest.hexdigest() != candidate["archive"].get("sha256"):
                fail("Restored archive final size/SHA-256 does not match the descriptor.")
            with partial_path.open("rb") as stream:
                prefix = stream.read(5)
            if candidate["archive"].get("format") == "postgres-custom" and prefix != b"PGDMP":
                fail("Reconstructed archive is not PostgreSQL custom format.")
            if candidate["archive"].get("format") == "openpgp-aes256-tar" \
                    and (not prefix or prefix[0] & 0x80 == 0):
                fail("Reconstructed archive is not binary OpenPGP.")
            chosen = candidate
            used_fallback = candidate is fallback
            break
        except Exception as exc:
            last_error = exc
            if partial_path.exists():
                partial_path.unlink()
            if candidate is fallback:
                raise

    if chosen is None:
        raise last_error or RuntimeError("No readable backup descriptor was available.")
    if used_fallback:
        print(
            f"RESTORE_FALLBACK priorBackup={chosen['backup_id']} "
            f"generation={chosen['manifest'].get('snapshotGeneration')}"
        )

    recovery = None
    backup = chosen["backup"]
    backup_id = chosen["backup_id"]
    archive = chosen["archive"]
    chunks = chosen["chunks"]
    manifest = chosen["manifest"]
    if args.begin_recovery:
        begin_body = {
            "schema": "adg-cpoly-recovery-begin-v1",
            "backupId": backup_id,
            "snapshotGeneration": int(manifest["snapshotGeneration"]),
            "snapshotWatermark": int(manifest["postgresReceiptWatermark"]),
        }
        _, begin_payload, _ = api.json_request(
            "POST",
            "/api/internal/cpoly-recovery/begin",
            begin_body,
        )
        recovery = begin_payload.get("recovery")
        if not isinstance(recovery, dict) \
                or recovery.get("state") != "recovering" \
                or recovery.get("restoreBackupId") != backup_id:
            fail("Worker recovery-begin response is incompatible.")
        lease_text = recovery.get("restoreLeaseExpiresAtUtc")
        if not lease_text:
            fail("Worker recovery-begin response did not include a restore lease.")
        try:
            lease_expires = datetime.fromisoformat(
                str(lease_text).replace("Z", "+00:00")
            )
        except ValueError:
            fail("Worker restore lease timestamp is invalid.")
        if lease_expires <= datetime.now(timezone.utc):
            fail("Worker restore lease is already expired.")
        if not args.recovery_state:
            fail("--recovery-state is required with --begin-recovery.")
        Path(args.recovery_state).write_bytes(canonical_json({
            "backupId": backup_id,
            "snapshotGeneration": int(manifest["snapshotGeneration"]),
            "snapshotWatermark": int(manifest["postgresReceiptWatermark"]),
            "recovery": recovery,
        }) + b"\n")

    os.replace(partial_path, output_path)
    if manifest_output:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_bytes(canonical_json(backup) + b"\n")

    print(
        f"RESTORE_FETCH_COMPLETE id={backup_id} chunks={len(chunks)} "
        f"sha256={archive['sha256']} generation={manifest.get('snapshotGeneration')} "
        f"watermark={manifest.get('postgresReceiptWatermark')}"
    )


def complete_recovery(args):
    state = load_json(args.recovery_state, "Recovery state")
    recovery = state.get("recovery")
    if not isinstance(recovery, dict):
        fail("Recovery state file is incomplete.")
    recovery_id = str(recovery.get("recoveryId", ""))
    backup_id = str(state.get("backupId", ""))
    target_generation = int(recovery.get("targetGeneration", 0))
    snapshot_generation = int(state.get("snapshotGeneration", 0))
    snapshot_watermark = int(state.get("snapshotWatermark", -1))
    if not recovery_id or target_generation < 1 \
            or snapshot_generation < 1 or snapshot_watermark < 0:
        fail("Recovery state values are invalid.")

    api = BackupApi()
    complete_body = {
        "schema": "adg-cpoly-recovery-complete-v1",
        "recoveryId": recovery_id,
        "backupId": backup_id,
        "snapshotGeneration": snapshot_generation,
        "snapshotWatermark": snapshot_watermark,
    }
    deadline = time.time() + args.timeout_seconds
    last_message = "recovery_not_ready"
    while time.time() < deadline:
        status, payload, _ = api.json_request(
            "POST",
            "/api/internal/cpoly-recovery/complete",
            complete_body,
            allowed_statuses=(409,),
        )
        if status == 200:
            ready = payload.get("recovery")
            replay = payload.get("replay")
            if not isinstance(ready, dict) or ready.get("state") != "ready":
                fail("Worker recovery-complete did not return ready state.")
            if int(ready.get("readyGeneration", 0)) != target_generation:
                fail("Worker ready generation did not match the recovery target.")
            if not isinstance(replay, dict) \
                    or int(replay.get("generation", 0)) != target_generation \
                    or int(replay.get("receiptSeq", -1)) < snapshot_watermark:
                fail("Worker replay receipt verification was incomplete.")
            _, status_payload, _ = api.json_request(
                "GET",
                "/api/internal/cpoly-recovery/status",
            )
            status_recovery = status_payload.get("recovery")
            if not isinstance(status_recovery, dict) \
                    or status_recovery.get("state") != "ready" \
                    or int(status_recovery.get("readyGeneration", 0)) != target_generation:
                fail("Worker recovery status did not remain ready.")
            Path(args.ready_output).write_text(
                "\t".join((
                    recovery_id,
                    str(target_generation),
                    str(snapshot_generation),
                    str(snapshot_watermark),
                    str(int(replay["receiptSeq"])),
                    "ready",
                )) + "\n",
                encoding="utf-8",
            )
            print(
                f"RECOVERY_READY id={recovery_id} generation={target_generation} "
                f"watermark={replay['receiptSeq']}"
            )
            return
        last_message = payload.get("message", "recovery_not_ready")
        time.sleep(args.poll_seconds)
    fail(f"Worker recovery did not become ready before timeout: {last_message}")


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    upload_parser = subparsers.add_parser("upload")
    upload_parser.add_argument("--archive", required=True)
    upload_parser.add_argument("--manifest-base", "--metadata", dest="manifest_base", required=True)
    upload_parser.add_argument("--restore-evidence", required=True)
    upload_parser.add_argument(
        "--archive-format",
        choices=("postgres-custom", "openpgp-aes256-tar"),
        default="postgres-custom",
    )
    upload_parser.add_argument(
        "--encryption-format",
        default="none",
    )
    upload_parser.add_argument("--database", default="adg_adjudication")
    upload_parser.set_defaults(handler=upload)
    download_parser = subparsers.add_parser("download")
    download_parser.add_argument("--output", required=True)
    download_parser.add_argument("--manifest-output")
    download_parser.add_argument("--begin-recovery", action="store_true")
    download_parser.add_argument("--recovery-state")
    download_parser.add_argument(
        "--expected-archive-format",
        choices=("postgres-custom", "openpgp-aes256-tar"),
        default="postgres-custom",
    )
    download_parser.set_defaults(handler=download)
    complete_parser = subparsers.add_parser("recovery-complete")
    complete_parser.add_argument("--recovery-state", required=True)
    complete_parser.add_argument("--ready-output", required=True)
    complete_parser.add_argument("--timeout-seconds", type=int, default=3600)
    complete_parser.add_argument("--poll-seconds", type=int, default=5)
    complete_parser.set_defaults(handler=complete_recovery)
    args = parser.parse_args()
    try:
        args.handler(args)
    except Exception as exc:
        print(f"BACKUP_CLIENT_ERROR {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
