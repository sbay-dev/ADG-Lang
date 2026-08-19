import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const portalRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(portalRoot, "..", "..");
const packageValue = JSON.parse(
  await readFile(resolve(portalRoot, "package.json"), "utf8")
);
const releaseId = `portal-${packageValue.version}`;
const releaseDirectory = resolve(portalRoot, "release");
const outputPath = resolve(releaseDirectory, `${releaseId}.json`);

const repositoryFiles = [
  ".gitignore",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/portal-reviewer-report.yml",
  ".github/workflows/import-msa-adjudication.yml",
  ".github/workflows/msa-adjudication-portal-security.yml",
  ".github/workflows/publish-portal-issue-reports.yml",
  ".github/workflows/sync-msa-adjudication-tasks.yml",
  "EVALUATION-NOTICE.md",
  "README.md",
  "SECURITY.md",
  "examples/arabic-text/msa-adjudication-pilot-v1/README.md",
  "examples/arabic-text/msa-adjudication-pilot-v1/adjudication.synthetic.json",
  "examples/arabic-text/msa-adjudication-pilot-v1/annotation-a.synthetic.json",
  "examples/arabic-text/msa-adjudication-pilot-v1/annotation-b.synthetic.json",
  "examples/arabic-text/msa-adjudication-pilot-v1/human-usability-evaluation.template.json",
  "examples/arabic-text/msa-adjudication-pilot-v1/packet.json",
  "human-evidence/tasks/msa-adjudication-pilot-v1.task.json",
  "human-evidence/tasks/natural-arabic-rule-consumption-v1.task.json",
  "scripts/arabic-text/import-msa-portal-submission.mjs",
  "scripts/arabic-text/render-msa-github-evidence.mjs"
];

const portalFiles = await listPortalFiles(portalRoot);
const paths = [...new Set([
  ...repositoryFiles,
  ...portalFiles.map(path => (
    `tools/msa-adjudication-workbench/${path}`
  ))
])].sort(compareOrdinal);

const files = [];
for (const path of paths) {
  const absolutePath = resolve(repositoryRoot, ...path.split("/"));
  const value = canonicalBytes(path, await readFile(absolutePath));
  files.push({
    path,
    bytes: value.byteLength,
    sha256: createHash("sha256").update(value).digest("hex")
  });
}

const rootInput = files
  .map(file => `${file.sha256} ${file.bytes} ${file.path}\n`)
  .join("");
const releaseRoot = createHash("sha256")
  .update(rootInput, "utf8")
  .digest("hex");
const manifest = {
  schema: "adg-ordinary-software-release-manifest-v1",
  releaseId,
  version: packageValue.version,
  classification: "ordinary-software",
  publicOrigin: "https://adg.sbay.sa",
  repository: "sbay-dev/ADG-Lang",
  canonicalization: {
    pathSeparator: "/",
    pathOrder: "ordinal-ascending",
    textLineEndings: "LF",
    rootRecord: "<sha256> <bytes> <path>\\n"
  },
  integrity: {
    algorithm: "SHA-256 canonical file-list root",
    fileCount: files.length,
    releaseRoot
  },
  exclusions: [
    "release/ (self-referential generated output)",
    "wrangler.jsonc and wrangler.staging.jsonc (private resource bindings)",
    ".dev.vars, .env, node_modules, .wrangler, caches, logs, and databases",
    "participant identity, Azure SAS values, Entra secrets, and Turnstile secrets"
  ],
  claimBoundaries: [
    "This is an ordinary-software portal release, not a CNS model release.",
    "Human submissions remain untrusted until the repository importer and review pass.",
    "Operational tests are assisted, do not occupy consensus roles, and cannot establish readiness.",
    "Portal defect Issues contain sanitized technical reports only; account linkage, profiles, drafts, and linguistic decisions are excluded.",
    "Repository task manifests contain blind packets only; reviewer identities and completed local exports are excluded.",
    "Pilot submissions do not establish unrestricted MSA parser readiness."
  ],
  files
};

await mkdir(releaseDirectory, { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify({
  releaseId,
  fileCount: files.length,
  releaseRoot
}));

async function listPortalFiles(directory) {
  const output = [];
  await walk(directory, "");
  return output.sort(compareOrdinal);

  async function walk(currentDirectory, relativeDirectory) {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true
    });
    entries.sort((left, right) => compareOrdinal(
      left.name,
      right.name
    ));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (excludedPortalPath(relativePath, entry.isDirectory())) {
        continue;
      }
      const absolutePath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        output.push(relativePath);
      }
    }
  }
}

function excludedPortalPath(path, directory) {
  const segments = path.split("/");
  const name = segments.at(-1);
  if (directory && (
    [
    ".wrangler",
    ".migration-work",
    "node_modules",
    "release"
    ].includes(name)
    || name.startsWith(".scratch")
    || name.startsWith(".work")
    || name.startsWith(".wrangler-dry-run")
  )) {
    return true;
  }
  if ([
    ".dev.vars",
    "wrangler.jsonc",
    "wrangler.staging.jsonc"
  ].includes(name)) {
    return true;
  }
  return name.startsWith(".env")
    && !name.endsWith(".example");
}

function canonicalBytes(path, value) {
  if (value.includes(0) || binaryExtension(path)) return value;
  return Buffer.from(
    value.toString("utf8").replace(/\r\n?/g, "\n"),
    "utf8"
  );
}

function binaryExtension(path) {
  return new Set([
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".wasm",
    ".webp",
    ".zip"
  ]).has(extname(path).toLowerCase());
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
