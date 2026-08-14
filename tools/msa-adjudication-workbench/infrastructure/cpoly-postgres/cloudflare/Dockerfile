FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS bridge-dependencies

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM postgres:16-bookworm@sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      tini=0.19.0-1+b3 \
      python3=3.11.2-1+b1 \
      ca-certificates=20250419~deb12u1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bridge-dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/cpoly
COPY --from=bridge-dependencies /build/node_modules ./node_modules
COPY bridge ./bridge
COPY runtime/scripts ./scripts
COPY runtime/migrations ./migrations
COPY scripts/entrypoint.sh /opt/cpoly/bin/entrypoint.sh
COPY scripts/backup-now.sh /opt/cpoly/bin/backup-now.sh

RUN install -d -m 0700 -o postgres -g postgres \
      /opt/cpoly/bin \
      /run/cpoly/secrets \
      /run/secrets/roles \
      /var/lib/postgresql/cpoly-backup-work \
    && chmod 0755 /opt/cpoly/bin/*.sh /opt/cpoly/scripts/*.sh \
    && chmod 0644 /opt/cpoly/scripts/*.py /opt/cpoly/migrations/*.sql \
    && ln -s /opt/cpoly/scripts/bootstrap-roles.sh \
      /docker-entrypoint-initdb.d/10-bootstrap-roles.sh \
    && chown -R postgres:postgres /opt/cpoly /run/cpoly /run/secrets/roles

ENV PORT=18444 \
    CPOLY_POSTGRES_PROVIDER_PORT=18444 \
    PGDATA=/var/lib/postgresql/data/pgdata \
    PGHOST=/var/run/postgresql \
    PGDATABASE=adg_adjudication \
    PGUSER=adg_runtime \
    CPOLY_BACKUP_ON_SIGTERM=true \
    CPOLY_ALLOW_FRESH_BOOTSTRAP=false

EXPOSE 18444

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=8 \
  CMD python3 -c "import socket; s=socket.create_connection(('127.0.0.1',18444),3); s.close()" || exit 1

USER root
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/cpoly/bin/entrypoint.sh"]
