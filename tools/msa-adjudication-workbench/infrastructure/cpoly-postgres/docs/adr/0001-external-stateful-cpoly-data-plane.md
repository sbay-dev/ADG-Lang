# ADR 0001: External stateful CPOLY PostgreSQL data plane

- Status: Accepted
- Date: 2026-08-14

## Decision

Run the ADG production PostgreSQL data plane on a real external Kubernetes
cluster as a CPOLY-managed StatefulSet with durable PVC storage and independent
signed Worker/D1 backup/restore. Retain WAL-G as an optional second copy and the
remote-host contract only as a qualified
fallback package, not the selected production runtime.
Cloudflare Workers remain the public application/API and Graph mail path, and
reach PostgreSQL directly through Hyperdrive with TLS.

A CPOLY Cloudflare Container may provide a control or workbench surface only.
It must not host the production PostgreSQL data plane or proxy SQL through
generic HTTP/gRPC provider endpoints.

The shipped Workbench API is not a package deployment authority: disabled and
read-only modes cannot mutate workloads, its read-only RBAC grants only
`get/list/watch`, and its kubectl bridge blocks file/Kustomize apply arguments.
Deployment therefore uses a separately governed external-cluster Kubernetes
credential, after which Workbench can observe the managed resources.

## Rationale

Cloudflare Container disks are ephemeral across stops/restarts and inbound
container requests are mediated by Workers over HTTP. That does not provide the
durable block-storage, snapshot, recovery, or direct PostgreSQL-origin semantics
required by PostgreSQL and Hyperdrive. The CPOLY PostgreSQL package also bounds
data-plane claims to an external real cluster for stateful storage,
backup, and restore.

## Consequences

- A remote endpoint, DNS name, firewall, storage class/volume, certificates,
  secret manager, and backup bucket are mandatory deployment prerequisites.
- No deployment is claimed while those prerequisites and a real cluster/host
  are absent.
- The provided Kubernetes topology is single-primary, not HA.
- This decision may be revisited only after Cloudflare offers and verifies
  PostgreSQL-grade durable block storage/snapshots plus compatible PostgreSQL
  ingress and recovery semantics.
