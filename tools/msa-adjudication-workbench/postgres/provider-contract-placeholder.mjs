import http from "node:http";

const port = Number(process.env.CPOLY_POSTGRES_PROVIDER_PORT || 18444);
const body = JSON.stringify({
  ok: false,
  schema: "adg.cpoly-postgres.status.v1",
  error: {
    code: "provider_contract_placeholder",
    message:
      "Replace postgres/Dockerfile with the infra-owned CPOLY PostgreSQL provider image before deployment.",
    retryable: false
  },
  status: {
    instanceId: process.env.CPOLY_POSTGRES_INSTANCE_ID || null,
    state: "starting",
    ready: false,
    currentGeneration: null,
    receiptWatermark: null,
    restoreBackupId: null,
    restoreSnapshotGeneration: null,
    restoreSnapshotWatermark: null,
    lastBackupId: null,
    backupInProgress: false,
    lastError: "contract_placeholder"
  }
});

http.createServer((_request, response) => {
  response.writeHead(503, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body))
  });
  response.end(body);
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(`cpoly-provider-contract-placeholder listening on ${port}\n`);
});
