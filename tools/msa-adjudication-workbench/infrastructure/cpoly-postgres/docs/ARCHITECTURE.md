# Architecture and claim boundary

```text
Public users
    |
    v
Cloudflare Workers (portal/API and Graph mail)
    |
    | private bearer-authenticated HTTP provider
    |
    v
stable Cloudflare Container "standard-1" (max_instances=1)
    |
    +-- HTTP provider :18444 (routed)
    |
    `-- PostgreSQL 16 Unix socket (TCP 5432 not routed)
             |
             v
        raw PostgreSQL custom-format archive
             |
             v
        signed <=512 KiB chunks to CPOLY_BACKUPS KV
             |
             +-- descriptors/journal/lease/gate in D1
             `-- optional Kubernetes, GPG, WAL-G, and remote-host variants
```

The selected ADG production data plane is the stable Cloudflare Container. Its
disk is ephemeral; durability is supplied only by KV+D1 recovery. Kubernetes
and remote-host packages remain qualified optional contracts.

The CPOLY package standard is preserved through
`cpoly.package.standard.v1` and `cpoly.package.kubernetes.v1` contracts, while
the ADG aggregate contract narrows production placement:

- standard means an always-on non-local remote container host;
- Cloudflare Container means one stable `standard-1` provider instance;
- Kubernetes means an optional external real cluster and StatefulSet;
- Cloudflare Container is selected for ADG production;
- standalone workbench and workstation placement are excluded;
- generic PostgresServer HTTP/gRPC SQL proxy transports are excluded;
- the Worker uses the exact internal container provider contract.

The optional Kubernetes package is single-primary. A StatefulSet, retained PVC,
anti-affinity against other CPOLY PostgreSQL data-plane pods, probes, resource
bounds, NetworkPolicy, scheduled backup, and restore procedure improve
operability but do not create HA. No failover or zero-downtime claim is made.

R2 is currently unavailable and is not a prerequisite. The primary drill uses
the Worker backup API; WAL-G remains optional defense in depth. A PVC alone is
never backup evidence.

The active CPOLY Field/Workbench apps establish the intended Container field,
but these artifacts do not modify or deploy those apps.
