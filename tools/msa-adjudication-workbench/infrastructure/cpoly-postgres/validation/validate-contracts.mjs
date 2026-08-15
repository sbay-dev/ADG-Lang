import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = readJson("contract/cpoly-adg-postgres.schema.json");
const contract = readJson("contract/cpoly-adg-postgres.json");
const standard = readJson("standard/package.cpoly.json");
const kubernetes = readJson("kubernetes/package.kubernetes.cpoly.json");
const execution = readJson("kubernetes/cpoly-execution.cpoly.json");
const cloudflare = readJson("cloudflare/package.cloudflare.cpoly.json");
const backupApi = readJson("contract/d1-backup-api.v1.json");
const errors = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveRef(reference) {
  if (!reference.startsWith("#/")) {
    throw new Error(`Unsupported non-local schema reference: ${reference}`);
  }
  return reference
    .slice(2)
    .split("/")
    .reduce((value, key) => value[key.replaceAll("~1", "/").replaceAll("~0", "~")], schema);
}

function validate(node, value, location) {
  if (node.$ref) {
    validate(resolveRef(node.$ref), value, location);
    return;
  }

  if (node.const !== undefined && !equal(value, node.const)) {
    errors.push(`${location}: must equal ${JSON.stringify(node.const)}`);
  }
  if (node.enum && !node.enum.some((item) => equal(item, value))) {
    errors.push(`${location}: must be one of ${JSON.stringify(node.enum)}`);
  }
  if (node.type) {
    const validType =
      node.type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : node.type === "array"
          ? Array.isArray(value)
          : node.type === "integer"
            ? Number.isInteger(value)
            : typeof value === node.type;
    if (!validType) {
      errors.push(`${location}: expected ${node.type}`);
      return;
    }
  }
  if (typeof value === "string" && node.minLength && value.length < node.minLength) {
    errors.push(`${location}: shorter than ${node.minLength}`);
  }
  if (typeof value === "string" && node.pattern && !new RegExp(node.pattern).test(value)) {
    errors.push(`${location}: does not match ${node.pattern}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems && value.length < node.minItems) {
      errors.push(`${location}: fewer than ${node.minItems} items`);
    }
    if (node.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${location}: items must be unique`);
    }
    if (node.contains) {
      const containsMatch = value.some((item) => {
        const before = errors.length;
        validate(node.contains, item, `${location}[*]`);
        const matched = errors.length === before;
        errors.splice(before);
        return matched;
      });
      if (!containsMatch) {
        errors.push(`${location}: contains constraint was not met`);
      }
    }
    if (node.items) {
      value.forEach((item, index) => validate(node.items, item, `${location}[${index}]`));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of node.required ?? []) {
      if (!(required in value)) {
        errors.push(`${location}: missing required property ${required}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (node.properties?.[key]) {
        validate(node.properties[key], child, `${location}.${key}`);
      } else if (node.additionalProperties === false) {
        errors.push(`${location}: unexpected property ${key}`);
      }
    }
  }
}

validate(schema, contract, "$");

if (standard.schema !== "cpoly.package.standard.v1") {
  errors.push("standard package schema is incorrect");
}
if (contract.selectedProductionVariant !== "cloudflare-container" ||
    contract.variants?.cloudflare?.productionSelected !== true ||
    contract.variants?.kubernetes?.productionSelected !== false ||
    contract.variants?.standard?.productionSelected !== false) {
  errors.push("Cloudflare Container must be the only selected ADG production variant");
}
if (standard.productionPlacement?.localWorkstationAllowed !== false) {
  errors.push("standard package must exclude the workstation from production");
}
if (standard.databaseAccess?.path !== "direct-postgresql-wire-protocol") {
  errors.push("standard package must use direct PostgreSQL access");
}
if (!standard.image?.includes("@sha256:")) {
  errors.push("standard PostgreSQL image is not digest pinned");
}
if (kubernetes.schema !== "cpoly.package.kubernetes.v1") {
  errors.push("Kubernetes package schema is incorrect");
}
if (kubernetes.workloadKind !== "StatefulSet") {
  errors.push("Kubernetes package must use StatefulSet");
}
if (!equal(kubernetes.deploymentModes, ["external-cluster"])) {
  errors.push("Kubernetes deployment mode must be external-cluster only");
}
if (kubernetes.kubernetesClaims?.highAvailability !== false) {
  errors.push("Kubernetes package must not claim HA");
}
if (cloudflare.selectedProductionRuntime !== true ||
    cloudflare.container?.stableInstanceId !== "standard-1" ||
    cloudflare.container?.instanceType !== "standard-1" ||
    cloudflare.container?.maxInstances !== 1 ||
    cloudflare.container?.defaultPort !== 18444 ||
    cloudflare.container?.postgresTcpExternallyRouted !== false ||
    cloudflare.durability?.chunkObjectStore !== "CPOLY_BACKUPS KV") {
  errors.push("Cloudflare Container contract is missing the stable single-instance KV recovery path");
}
if (kubernetes.execution?.workbenchApiPackageApplySupported !== false) {
  errors.push("Kubernetes contract must not claim Workbench API package apply");
}
if (execution.selectedRuntime !== "external-kubernetes-statefulset") {
  errors.push("CPOLY execution contract must select the external StatefulSet");
}
if (execution.workbenchApi?.packageApplySupported !== false) {
  errors.push("CPOLY execution contract must bound the Workbench API to non-deployment use");
}
if (execution.managementPlane?.cloudflareContainerMode?.isKubernetesDataPlane !== false) {
  errors.push("Cloudflare Workbench mode must not be a Kubernetes data plane");
}
if (execution.dataPlane?.workloadKind !== "StatefulSet" ||
    execution.dataPlane?.persistence !== "PersistentVolumeClaim" ||
    execution.dataPlane?.backupRestore?.primary !== "Worker-private-KV-signed-pg-dump-custom" ||
    execution.dataPlane?.backupRestore?.optionalSecondCopy !== "WAL-G-S3-compatible" ||
    execution.dataPlane?.backupRestore?.maximumChunkBytes !== 524288) {
  errors.push("CPOLY execution contract is missing the StatefulSet/PVC/D1-primary/WAL-G-optional path");
}
const expectedBackupEndpoints = [
  ["POST", "/api/internal/cpoly-backups"],
  ["PUT", "/api/internal/cpoly-backups/{backupId}/chunks/{index}"],
  ["POST", "/api/internal/cpoly-backups/{backupId}/complete"],
  ["GET", "/api/internal/cpoly-backups/latest"],
  ["GET", "/api/internal/cpoly-backups/{backupId}/chunks/{index}"],
  ["POST", "/api/internal/cpoly-recovery/begin"],
  ["POST", "/api/internal/cpoly-recovery/complete"],
  ["GET", "/api/internal/cpoly-recovery/status"]
];
if (backupApi.backupDescriptor?.archive?.maximumChunkBytes !== 524288 ||
    backupApi.backupDescriptor?.archive?.format !== "postgres-custom" ||
    backupApi.backupDescriptor?.archive?.encryptionFormat !== "none" ||
    backupApi.backupDescriptor?.archive?.objectStore !== "CPOLY_BACKUPS KV" ||
    backupApi.backupDescriptor?.archive?.keyPolicy !==
      "immutable versioned object key; never overwrite" ||
    backupApi.backupDescriptor?.schema !== "adg.cpoly-postgres.backup.v1" ||
    !equal(backupApi.backupDescriptor?.sharedBy, ["create", "complete"]) ||
    backupApi.authentication?.algorithm !== "HMAC-SHA256" ||
    backupApi.authentication?.timestamp !== "Unix milliseconds" ||
    backupApi.authentication?.nonce !== "UUIDv4" ||
    backupApi.authentication?.canonicalForm !==
      "UPPERCASE_METHOD\\npath\\ntimestamp_ms\\nuuid_v4_nonce\\nbody_sha256" ||
    !equal(
      backupApi.endpoints?.map((endpoint) => [endpoint.method, endpoint.path]),
      expectedBackupEndpoints
    )) {
  errors.push("Worker D1 backup API contract does not match the fixed signed endpoint set");
}
if (kubernetes.backupRestore?.primary?.transport !== "worker-private-kv-api" ||
    kubernetes.backupRestore?.primary?.archiveFormat !== "postgres-custom" ||
    kubernetes.backupRestore?.primary?.metadataAndJournal !== "cloudflare-d1" ||
    kubernetes.backupRestore?.optionalSecondCopies?.[1]?.r2Required !== false ||
    kubernetes.backupRestore?.pvcAloneIsBackup !== false ||
    kubernetes.backupRestore?.primary?.snapshot?.sameSnapshotAsPgDump !== true ||
    kubernetes.backupRestore?.primary?.recoveryGate?.applicationReadinessDefault !== "closed") {
  errors.push("Kubernetes package must select D1 backup, keep WAL-G optional, and reject PVC-only backup");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("OK contract JSON matches the ADG schema and CPOLY variant bounds");
