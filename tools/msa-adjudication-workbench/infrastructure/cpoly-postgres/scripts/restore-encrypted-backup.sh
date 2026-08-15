#!/bin/sh
set -eu
umask 077

: "${BACKUP_ROOT:=/backup}"
: "${ENCRYPTED_ARCHIVE:=$BACKUP_ROOT/cpoly-postgres-backup.tar.gpg}"
: "${RESTORE_MODE:=production}"

passphrase_file=${BACKUP_PASSPHRASE_FILE:-/run/secrets/portal-backup/encryption-passphrase}
plain_dir=$BACKUP_ROOT/restore-plain
bundle=$BACKUP_ROOT/restore-bundle.tar
gnupg_home=$BACKUP_ROOT/restore-gnupg

for required_file in "$ENCRYPTED_ARCHIVE" "$passphrase_file"; do
  if [ ! -s "$required_file" ]; then
    echo "Required encrypted restore input is missing: $required_file" >&2
    exit 1
  fi
done
if find "$plain_dir" -mindepth 1 2>/dev/null | grep -q .; then
  echo "Restore plaintext workspace is not empty." >&2
  exit 1
fi

mkdir -p "$plain_dir" "$gnupg_home"
chmod 0700 "$gnupg_home"
export GNUPGHOME=$gnupg_home

cleanup_plaintext() {
  rm -rf "$plain_dir" "$bundle" "$gnupg_home"
}
trap cleanup_plaintext EXIT INT TERM

gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-file "$passphrase_file" \
  --decrypt \
  --output "$bundle" \
  "$ENCRYPTED_ARCHIVE" 2>/dev/null
test -s "$bundle"
tar -C "$plain_dir" -xf "$bundle"

(
  cd "$plain_dir"
  sha256sum --check --strict plaintext-sha256.txt
)
grep -q '"schema": "cpoly_postgres_backup_v1"' "$plain_dir/backup-manifest.json"
test -s "$plain_dir/globals.sql"
test -s "$plain_dir/inventory.tsv"

case "$RESTORE_MODE" in
  production)
    target_dump=
    while IFS='|' read -r database_oid database_name database_bytes; do
      [ -n "$database_oid" ] || continue
      if [ "$database_name" = "adg_adjudication" ]; then
        target_dump=$plain_dir/database-$database_oid.dump
      fi
    done < "$plain_dir/inventory.tsv"
    if [ -z "$target_dump" ] || [ ! -s "$target_dump" ]; then
      echo "Encrypted bundle does not contain adg_adjudication." >&2
      exit 1
    fi
    RESTORE_ARCHIVE=$target_dump /bin/sh /opt/cpoly/scripts/restore-logical.sh
    ;;
  verify-all)
    : "${PGHOST:=/var/run/postgresql}"
    : "${PGPORT:=5432}"
    : "${PGUSER:=postgres}"
    until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres >/dev/null 2>&1; do
      sleep 2
    done
    verified=0
    inventory_count=$(grep -c '^[0-9][0-9]*|' "$plain_dir/inventory.tsv")
    if [ -n "${RESTORE_EVIDENCE_FILE:-}" ]; then
      printf '{"requested":true,"status":"PASS","databases":[' \
        > "$RESTORE_EVIDENCE_FILE"
    fi
    while IFS='|' read -r database_oid database_name database_bytes; do
      [ -n "$database_oid" ] || continue
      target=verify_$database_oid
      dump=$plain_dir/database-$database_oid.dump
      dropdb --if-exists --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" "$target"
      createdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" "$target"
      pg_restore \
        --host="$PGHOST" \
        --port="$PGPORT" \
        --username="$PGUSER" \
        --dbname="$target" \
        --no-owner \
        --no-privileges \
        --exit-on-error \
        "$dump"
      restored_bytes=$(
        psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
          --dbname=postgres --tuples-only --no-align \
          --command="SELECT pg_database_size('$target')"
      )
      case "$restored_bytes" in *[!0-9]*|'') echo "Restore size invalid." >&2; exit 1;; esac
      echo "RESTORE_VERIFY_PASS source=$database_name target=$target bytes=$restored_bytes"
      if [ -n "${RESTORE_EVIDENCE_FILE:-}" ]; then
        [ "$verified" -eq 0 ] || printf ',' >> "$RESTORE_EVIDENCE_FILE"
        printf '{"source_database":"%s","target_database":"%s","restored_bytes":%s,"status":"PASS"}' \
          "$database_name" "$target" "$restored_bytes" >> "$RESTORE_EVIDENCE_FILE"
      fi
      verified=$((verified + 1))
    done < "$plain_dir/inventory.tsv"
    [ "$verified" -gt 0 ] && [ "$verified" -eq "$inventory_count" ] || {
      echo "Restore evidence did not cover every inventoried database exactly once." >&2
      exit 1
    }
    if [ -n "${RESTORE_EVIDENCE_FILE:-}" ]; then
      printf ']}\n' >> "$RESTORE_EVIDENCE_FILE"
    fi
    if [ -n "${RESTORE_COMPLETE_MARKER:-}" ]; then
      : > "$RESTORE_COMPLETE_MARKER"
    fi
    ;;
  *)
    echo "RESTORE_MODE must be production or verify-all." >&2
    exit 1
    ;;
esac

cleanup_plaintext
trap - EXIT INT TERM
echo "ENCRYPTED_RESTORE_COMPLETE mode=$RESTORE_MODE"
