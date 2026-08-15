FROM node:22-bookworm-slim

WORKDIR /opt/cpoly-adg-postgres

COPY postgres/provider-contract-placeholder.mjs ./provider-contract-placeholder.mjs

ENV CPOLY_POSTGRES_PROVIDER_PORT=18444

EXPOSE 18444

CMD ["node", "./provider-contract-placeholder.mjs"]
