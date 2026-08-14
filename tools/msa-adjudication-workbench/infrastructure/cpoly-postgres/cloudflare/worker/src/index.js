import { Container, getContainer } from "@cloudflare/containers";

const INSTANCE_ID = "standard-1";

export class CpolyAdgPostgresContainer extends Container {
  defaultPort = 18444;
  requiredPorts = [18444];
  sleepAfter = "24h";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: "18444",
      CPOLY_POSTGRES_PROVIDER_PORT: "18444",
      CPOLY_POSTGRES_INSTANCE_ID: INSTANCE_ID,
      CPOLY_POSTGRES_INTERNAL_TOKEN: required(
        env.CPOLY_POSTGRES_INTERNAL_TOKEN,
        "CPOLY_POSTGRES_INTERNAL_TOKEN"
      ),
      CPOLY_BACKUP_HMAC_KEY: required(env.CPOLY_BACKUP_HMAC_KEY, "CPOLY_BACKUP_HMAC_KEY"),
      CPOLY_BACKUP_BASE_URL: required(env.CPOLY_BACKUP_BASE_URL, "CPOLY_BACKUP_BASE_URL"),
      ADG_MIGRATOR_PASSWORD: required(env.ADG_MIGRATOR_PASSWORD, "ADG_MIGRATOR_PASSWORD"),
      ADG_RUNTIME_PASSWORD: required(env.ADG_RUNTIME_PASSWORD, "ADG_RUNTIME_PASSWORD"),
      ADG_BACKUP_PASSWORD: required(env.ADG_BACKUP_PASSWORD, "ADG_BACKUP_PASSWORD"),
      POSTGRES_SUPERUSER_PASSWORD: String(env.POSTGRES_SUPERUSER_PASSWORD || ""),
      CPOLY_ALLOW_FRESH_BOOTSTRAP: String(env.CPOLY_ALLOW_FRESH_BOOTSTRAP || "false"),
      CPOLY_RESUME_RECOVERY: String(env.CPOLY_RESUME_RECOVERY || "false"),
      CPOLY_BACKUP_ON_SIGTERM: "true"
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/internal/postgres/v1/")) {
      return new Response("Not Found", { status: 404 });
    }
    const container = getContainer(env.ADG_CPOLY_POSTGRES, INSTANCE_ID);
    await container.startAndWaitForPorts(18444, {
      instanceGetTimeoutMS: 300_000,
      portReadyTimeoutMS: 300_000
    });
    return container.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    const container = getContainer(env.ADG_CPOLY_POSTGRES, INSTANCE_ID);
    ctx.waitUntil((async () => {
      await container.startAndWaitForPorts(18444, {
        instanceGetTimeoutMS: 300_000,
        portReadyTimeoutMS: 300_000
      });
      const response = await container.fetch(new Request(
        "http://container.internal/api/internal/postgres/v1/backups/trigger",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${required(
              env.CPOLY_POSTGRES_INTERNAL_TOKEN,
              "CPOLY_POSTGRES_INTERNAL_TOKEN"
            )}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            schema: "adg.cpoly-postgres.backup-trigger.v1",
            reason: "scheduled",
            requestedAt: Date.now()
          })
        }
      ));
      if (!response.ok && response.status !== 409) {
        throw new Error(`Scheduled CPOLY backup failed with HTTP ${response.status}.`);
      }
    })());
  }
};

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}
