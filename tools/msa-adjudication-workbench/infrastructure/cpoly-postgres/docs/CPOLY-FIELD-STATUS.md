# CPOLY field observation

Observed publicly on 2026-08-15:

```text
https://cpoly-kubernets-field-dev.2sa.workers.dev/
```

The public root responded as **CPOLY Field** and exposed the fixed policy Merkle
root:

```text
89983d2a24fa2ae3ef842d3ba0b836e45fb2576f6a01cbe8e647ff20651c5809
```

Unauthenticated requests to `/healthz` and `/api/cpoly/v1/status` returned
HTTP 401. No credential was supplied or invented. Therefore this package can
track only the public field URL/policy identity; it cannot inspect a private
session, container ID, Kubernetes target, or deployment state.

This observation is not deployment evidence and does not establish that the
field supplies a real Kubernetes cluster or a PostgreSQL data plane.

The user supplied the following active control-plane inventory:

```text
CPOLY Field app a033613d-c3cf-45d8-b1d3-2de9447d7012
  7 instances, standard-3, private network, 2 Gbps, zero failed

CPOLY Workbench app a03397c9-f19f-49ad-9f80-28ec719a38bb
  16 instances, 15 active, 1 healthy
```

These values are tracked as user-verified inventory. The public endpoint did
not expose authenticated session/container details, and this work did not
modify or deploy either application.
