import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireMatch(name, text, pattern) {
  if (!pattern.test(text)) failures.push(`${name}: required pattern missing: ${pattern}`);
}

function rejectMatch(name, text, pattern) {
  if (pattern.test(text)) failures.push(`${name}: forbidden pattern matched: ${pattern}`);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".validation-") || entry.name === "validation") return [];
      return walk(full);
    }
    return [full];
  });
}

const files = walk(root);
const textFiles = files.filter((file) => !/\.(png|jpg|jpeg|gif|zip)$/i.test(file));
for (const file of textFiles) {
  const relative = path.relative(root, file);
  const content = fs.readFileSync(file, "utf8");
  rejectMatch(relative, content, /[A-Za-z]:\\(?:Users|source|repos)\\/i);
  if (/\.(?:ya?ml|json)$/i.test(file)) {
    rejectMatch(relative, content, /^\s*hostPath\s*:/im);
  }
  if (/kubernetes[\\/].*\.ya?ml$/i.test(relative)) {
    rejectMatch(relative, content, /^\s*kind:\s*Secret\s*$/im);
    rejectMatch(relative, content, /^\s*kind:\s*Deployment\s*$/im);
  }
}

const sensitiveFiles = files.filter((file) => {
  const relative = path.relative(root, file);
  return /\.(?:pem|key|pfx|p12|crt)$/i.test(relative) ||
    /(?:^|[\\/])\.env$/i.test(relative);
});
if (sensitiveFiles.length) {
  failures.push(`credential/certificate files present: ${sensitiveFiles.map((file) => path.relative(root, file)).join(", ")}`);
}

const deployFiles = [
  "standard/docker-compose.yml",
  "kubernetes/manifests/statefulset.yaml",
  "kubernetes/manifests/backup-cronjob.yaml",
  "kubernetes/operations/migrate-job.yaml",
  "kubernetes/operations/d1-restore-job.yaml",
  "kubernetes/operations/restore-drill.yaml",
  "kubernetes/optional/qdrant-gpg/backup-job.yaml",
  "kubernetes/optional/walg/backup-cronjob.yaml",
  "kubernetes/optional/walg/restore-approval-job.yaml",
  "kubernetes/optional/walg/restore-job.yaml"
];
for (const relative of deployFiles) {
  const content = read(relative);
  rejectMatch(relative, content, /sslmode\s*[:=]\s*(?:disable|allow|prefer|require)\b/i);
  rejectMatch(relative, content, /PGSSLMODE\s*:\s*(?:disable|allow|prefer|require)\b/i);
  rejectMatch(relative, content, /ssl\s*=\s*off\b/i);
  rejectMatch(relative, content, /^\s*(?:POSTGRES_PASSWORD|PGPASSWORD|AWS_SECRET_ACCESS_KEY)\s*:\s*\S+/im);
  for (const line of content.split(/\r?\n/)) {
    const image = line.match(/^\s*image:\s*(.+?)\s*$/)?.[1];
    if (image && !image.startsWith("*") && !/@sha256:[0-9a-f]{64}$/i.test(image.replaceAll('"', ""))) {
      failures.push(`${relative}: mutable or unpinned image ${image}`);
    }
  }
}

const compose = read("standard/docker-compose.yml");
requireMatch("Compose", compose, /\$\{CPOLY_POSTGRES_BIND_ADDRESS:-127\.0\.0\.1\}/);
requireMatch("Compose", compose, /postgres-data:\/var\/lib\/postgresql\/data/);
requireMatch("Compose", compose, /restart:\s*unless-stopped/);
requireMatch("Compose", compose, /password_encryption=scram-sha-256/);
requireMatch("Compose", compose, /ssl_min_protocol_version=TLSv1\.2/);
requireMatch("Compose", compose, /healthcheck:/);
requireMatch("Compose", compose, /mem_limit:/);
requireMatch("Compose", compose, /postgres:16-bookworm@sha256:[0-9a-f]{64}/);
requireMatch("Compose", compose, /chekkan\/wal-g:v3\.0\.7@sha256:[0-9a-f]{64}/);

const statefulSet = read("kubernetes/manifests/statefulset.yaml");
requireMatch("StatefulSet", statefulSet, /^kind:\s*StatefulSet$/m);
requireMatch("StatefulSet", statefulSet, /volumeClaimTemplates:/);
requireMatch("StatefulSet", statefulSet, /storageClassName:\s*cpoly-postgres-retain/);
requireMatch("StatefulSet", statefulSet, /whenDeleted:\s*Retain/);
requireMatch("StatefulSet", statefulSet, /readinessProbe:/);
requireMatch("StatefulSet", statefulSet, /livenessProbe:/);
requireMatch("StatefulSet", statefulSet, /podAntiAffinity:/);
requireMatch("StatefulSet", statefulSet, /requests:\s*\n\s*cpu:/);
requireMatch("StatefulSet", statefulSet, /limits:\s*\n\s*cpu:/);

const services = read("kubernetes/manifests/services.yaml");
requireMatch("External Service", services, /type:\s*LoadBalancer/);
requireMatch("External Service", services, /loadBalancerSourceRanges:/);
requireMatch("External Service", services, /externalTrafficPolicy:\s*Local/);

const networkPolicy = read("kubernetes/manifests/networkpolicy.yaml");
requireMatch("NetworkPolicy", networkPolicy, /^kind:\s*NetworkPolicy$/m);
requireMatch("NetworkPolicy", networkPolicy, /port:\s*5432/);

const backup = read("kubernetes/manifests/backup-cronjob.yaml");
requireMatch("Backup", backup, /^kind:\s*CronJob$/m);
requireMatch("Backup", backup, /create-kv-binary-backup\.sh/);
requireMatch("Backup", backup, /verify-binary-backup-job\.sh/);
requireMatch("Backup", backup, /d1_backup_client\.py/);
requireMatch("Backup", backup, /ADG_BACKUP_HMAC_KEY_FILE/);
requireMatch("Backup", backup, /adg-postgres-portal-backup-secrets/);
requireMatch("Backup", backup, /python:3\.13-slim-bookworm@sha256:[0-9a-f]{64}/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /MAX_CHUNK_BYTES = 512 \* 1024/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /x-adg-signature/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /adg-cpoly-postgres-backup\/1\.0/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /time\.time\(\) \* 1000/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /str\(uuid\.uuid4\(\)\)/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /"\/api\/internal\/cpoly-recovery\/begin"/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /"\/api\/internal\/cpoly-recovery\/complete"/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /BACKUP_COMPLETE/);
requireMatch("Backup API", read("scripts/d1_backup_client.py"), /RESTORE_FETCH_COMPLETE/);
requireMatch("KV fallback", read("scripts/d1_backup_client.py"), /priorBackup/);
requireMatch("KV fallback", read("scripts/d1_backup_client.py"), /ADG_BACKUP_FETCH_RETRY_ATTEMPTS/);
requireMatch("KV fallback", read("scripts/d1_backup_client.py"), /RESTORE_FALLBACK/);
requireMatch("KV fallback harness", read("validation/real-worker-backup-harness.mjs"), /delay-latest/);
requireMatch("Backup API", read("contract/d1-backup-api.v1.json"), /canonicalForm/);
requireMatch("KV binary backup", read("scripts/create-kv-binary-backup.sh"), /pg_export_snapshot/);
requireMatch("KV binary backup", read("scripts/create-kv-binary-backup.sh"), /--format=custom/);
requireMatch("KV binary backup", read("scripts/create-kv-binary-backup.sh"), /protected_columns_entitycrypt/);
requireMatch("KV binary backup", read("scripts/create-kv-binary-backup.sh"), /role_password_material_excluded/);
requireMatch("KV binary restore", read("scripts/restore-binary-backup.sh"), /restore-logical\.sh/);
requireMatch("Optional encrypted backup", read("scripts/create-encrypted-backup.sh"), /pg_dumpall/);
requireMatch("Encrypted backup", read("scripts/create-encrypted-backup.sh"), /--format=custom/);
requireMatch("Encrypted backup", read("scripts/create-encrypted-backup.sh"), /--cipher-algo AES256/);
requireMatch("Encrypted backup", read("scripts/create-encrypted-backup.sh"), /plaintext-sha256\.txt/);
requireMatch("Encrypted backup", read("scripts/create-encrypted-backup.sh"), /cleanup_plaintext/);
requireMatch("Snapshot watermark", read("scripts/create-kv-binary-backup.sh"), /--snapshot="\$snapshot_id"/);
requireMatch("Snapshot watermark", read("scripts/create-kv-binary-backup.sh"), /MAX\(receipt_seq\)/);
requireMatch("Snapshot watermark", read("scripts/create-kv-binary-backup.sh"), /current_generation/);
requireMatch("Encrypted restore", read("scripts/restore-encrypted-backup.sh"), /sha256sum --check --strict/);
requireMatch("Encrypted restore", read("scripts/restore-encrypted-backup.sh"), /RESTORE_MODE/);
requireMatch("Restore verification Job", read("kubernetes/operations/restore-drill.yaml"), /^kind:\s*Job$/m);
requireMatch("Restore verification Job", read("kubernetes/operations/restore-drill.yaml"), /verify-binary-backup-job\.sh/);
requireMatch("Recovery readiness", read("kubernetes/manifests/statefulset.yaml"), /cpoly_recovery_state/);
requireMatch("Recovery readiness", read("kubernetes/operations/d1-restore-job.yaml"), /recovery-begin-download/);
requireMatch("Recovery readiness", read("kubernetes/operations/d1-restore-job.yaml"), /recovery-complete-status/);
requireMatch("Recovery readiness", read("kubernetes/operations/d1-restore-job.yaml"), /mark-recovery-ready\.sh/);
requireMatch("Real Worker conformance", read("validation/real-worker-backup-harness.mjs"), /routeCpolyBackupRequest/);
requireMatch("Real Worker KV conformance", read("validation/real-worker-backup-harness.mjs"), /CPOLY_BACKUPS/);
requireMatch("Provenance", read("docs/QDRANT-BACKUP-PROVENANCE.md"), /099003fbdab520a02ff1d47ad6417127cc52000c8dfb806bf5b7ec8209c12159/);

const portalMigration = read("migrations/postgresql/0001_portal_v15.sql");
rejectMatch("Portal migration", portalMigration, /^BEGIN;|^COMMIT;/m);
rejectMatch("Portal migration", portalMigration, /CREATE TABLE IF NOT EXISTS adjudication\.schema_migrations/);
rejectMatch("Portal migration", portalMigration, /schema_migrations\s*\(version/);
rejectMatch("Portal migration", portalMigration, /CREATE TABLE IF NOT EXISTS (?!adjudication\.)/);
rejectMatch("Portal migration", portalMigration, /\bREFERENCES (?!adjudication\.)[a-z]/);
rejectMatch("Portal migration", portalMigration, /\bON (?!adjudication\.)[a-z][a-z0-9_]*\(/);
rejectMatch("Portal migration", portalMigration, /^(?:INSERT INTO|UPDATE|DELETE FROM) (?!adjudication\.)/m);
requireMatch("Portal migration", portalMigration, /adjudication\.cpoly_write_receipts/);
requireMatch("Portal migration", portalMigration, /receipt_seq BIGSERIAL PRIMARY KEY/);
requireMatch("Portal migration", portalMigration, /adjudication\.cpoly_runtime_state/);
requireMatch("Portal migration", read("kustomization.yaml"), /adg-postgres-migrations/);
requireMatch("Backup", read("scripts/load-walg-env.sh"), /https:\/\/\*/);
requireMatch("Backup", read("scripts/load-walg-env.sh"), /WALG_LIBSODIUM_KEY/);
requireMatch("Backup", read("scripts/load-walg-env.sh"), /WALG_RETENTION_FULL/);
requireMatch("Optional WAL-G", read("kubernetes/optional/walg/backup-cronjob.yaml"), /walg-backup\.sh/);
requireMatch("Optional Qdrant GPG", read("kubernetes/optional/qdrant-gpg/backup-job.yaml"), /create-encrypted-backup\.sh/);

for (const required of [
  "operations/BACKUP-RESTORE.md",
  "operations/restore-new-volume.sh",
  "operations/verify-restore.sh",
  "kubernetes/operations/restore-drill.yaml",
  "kubernetes/operations/d1-restore-job.yaml",
  "kubernetes/optional/walg/restore-job.yaml",
  "kubernetes/optional/qdrant-gpg/backup-job.yaml",
  "validation/real-worker-backup-harness.mjs",
  "validation/smoke-d1-recovery.ps1",
  "validation/smoke-cloudflare-container.ps1",
  "cloudflare/contract/database-bridge.v1.json"
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`missing backup/restore artifact: ${required}`);
}

const standardContract = JSON.parse(read("standard/package.cpoly.json"));
const kubernetesContract = JSON.parse(read("kubernetes/package.kubernetes.cpoly.json"));
if (standardContract.productionPlacement?.localWorkstationAllowed !== false) {
  failures.push("standard production contract permits a local workstation");
}
if (standardContract.databaseAccess?.genericProviderProxyAllowed !== false) {
  failures.push("standard contract permits a generic SQL proxy");
}
if (kubernetesContract.deploymentModes?.includes("standalone-workbench")) {
  failures.push("Kubernetes contract permits a standalone workbench data plane");
}
if (kubernetesContract.kubernetesClaims?.requiresExternalClusterForDataPlane !== true) {
  failures.push("Kubernetes contract does not require an external cluster");
}
if (kubernetesContract.execution?.selectedProductionRuntime !== false) {
  failures.push("Kubernetes must remain optional after the Cloudflare pivot");
}

const cloudflareContract = JSON.parse(read("cloudflare/package.cloudflare.cpoly.json"));
if (cloudflareContract.selectedProductionRuntime !== true ||
    cloudflareContract.container?.stableInstanceId !== "standard-1" ||
    cloudflareContract.container?.maxInstances !== 1 ||
    cloudflareContract.container?.postgresTcpExternallyRouted !== false) {
  failures.push("Cloudflare Container production contract is invalid");
}

const cloudflareDockerfile = read("cloudflare/Dockerfile");
requireMatch("Cloudflare Dockerfile", cloudflareDockerfile, /postgres:16-bookworm@sha256:[0-9a-f]{64}/);
requireMatch("Cloudflare Dockerfile", cloudflareDockerfile, /node:22-bookworm-slim@sha256:[0-9a-f]{64}/);
requireMatch("Cloudflare Dockerfile", cloudflareDockerfile, /tini=0\.19\.0-1\+b3/);
requireMatch("Cloudflare Dockerfile", cloudflareDockerfile, /EXPOSE 18444/);
rejectMatch("Cloudflare Dockerfile", cloudflareDockerfile, /EXPOSE[^\n]*5432/);
requireMatch("Cloudflare Worker", read("cloudflare/worker/wrangler.toml.example"), /max_instances = 1/);
requireMatch("Cloudflare Worker", read("cloudflare/worker/wrangler.toml.example"), /instance_type = "standard-1"/);
requireMatch("Cloudflare Worker", read("cloudflare/worker/src/index.js"), /INSTANCE_ID = "standard-1"/);
requireMatch("Cloudflare bridge", read("cloudflare/bridge/server.mjs"), /adg\.cpoly-postgres\.execute\.v1/);
requireMatch("Cloudflare bridge", read("cloudflare/bridge/server.mjs"), /cpoly_write_receipts/);
for (const runtimeFile of [
  "bootstrap-roles.sh",
  "apply-migrations.sh",
  "create-kv-binary-backup.sh",
  "verify-binary-backup-job.sh",
  "d1_backup_client.py",
  "restore-binary-backup.sh",
  "restore-logical.sh",
  "mark-recovery-ready.sh"
]) {
  if (read(`scripts/${runtimeFile}`) !==
      read(`cloudflare/runtime/scripts/${runtimeFile}`)) {
    failures.push(`Cloudflare runtime copy is stale: ${runtimeFile}`);
  }
}
if (read("migrations/postgresql/0001_portal_v15.sql") !==
    read("cloudflare/runtime/migrations/0001_portal_v15.sql")) {
  failures.push("Cloudflare runtime migration copy is stale");
}

const cpolyExecution = JSON.parse(read("kubernetes/cpoly-execution.cpoly.json"));
if (cpolyExecution.workbenchApi?.packageApplySupported !== false) {
  failures.push("CPOLY execution contract falsely permits Workbench API package apply");
}
if (cpolyExecution.managementPlane?.standaloneKubernetesMode?.isKubernetesDataPlane !== false ||
    cpolyExecution.managementPlane?.cloudflareContainerMode?.isKubernetesDataPlane !== false) {
  failures.push("CPOLY execution contract falsely treats a Workbench mode as the data plane");
}
if (cpolyExecution.dataPlane?.workloadKind !== "StatefulSet" ||
    cpolyExecution.dataPlane?.persistence !== "PersistentVolumeClaim" ||
    cpolyExecution.dataPlane?.backupRestore?.primary !== "Worker-private-KV-signed-pg-dump-custom" ||
    cpolyExecution.dataPlane?.backupRestore?.optionalSecondCopy !== "WAL-G-S3-compatible") {
  failures.push("CPOLY execution contract lacks StatefulSet/PVC/D1-primary/WAL-G-optional");
}
for (const required of [
  "kubernetes/CPOLY-WORKBENCH-PATH.md",
  "kubernetes/operations/Deploy-CpolyPostgres.ps1",
  "kubernetes/operations/Test-CpolyWorkbenchTarget.ps1"
]) {
  if (!fs.existsSync(path.join(root, required))) failures.push(`missing CPOLY execution artifact: ${required}`);
}

const hyperdrive = read("docs/HYPERDRIVE-ORIGIN-SECURITY.md");
requireMatch("Hyperdrive", hyperdrive, /sslmode=verify-full/);
requireMatch("Hyperdrive", hyperdrive, /Cloudflare Tunnel is intentionally not recommended or used/);
requireMatch("Hyperdrive", hyperdrive, /adg_runtime/);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("OK security policy rejects credentials, hostPath, mutable images, local production, missing persistence/restore, and insecure TLS");
