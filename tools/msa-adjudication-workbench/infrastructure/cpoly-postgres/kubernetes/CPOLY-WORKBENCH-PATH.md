# Optional CPOLY Kubernetes execution path

## What the Workbench is

The shipped CPOLY Kubernetes Workbench Helm chart installs a `Deployment` into
an existing Kubernetes/AKS cluster. Its default `managedRuntime.mode` is `mock`,
`kubernetesControl.mode` is `disabled`, and RBAC creation is off.

The standalone Kubernetes manifests are a real Kubernetes application, but not
a managed workload data plane: they disable Kubernetes command execution and
do not mount a service-account token. The Cloudflare Container variant is
explicitly mock/control-only (`CPOLY_PROVIDER_MODE=mock`), sleeps when idle, and
has no Kubernetes credential or durable PostgreSQL storage.

The optional shipped Workbench control path is read-only. Its RBAC grants only
`get/list/watch`, and `/api/cpoly/v1/tools/kubectl` rejects `-f`, `-k`,
`--filename`, and `--kustomize`. Therefore there is no supported Workbench API
that can apply this PostgreSQL package. Claiming an API deployment would be
false.

## Executable path

1. Install the Workbench into an existing cluster for observation:

```powershell
helm upgrade --install cpoly-workbench `
  <CpolyKubernetesWorkbench.Commercial>\deploy\helm\cpoly-kubernetes-workbench `
  --namespace cpoly-system `
  --create-namespace `
  --set kubernetesControl.mode=read-only `
  --set rbac.create=true
```

2. Probe a remotely exposed HTTPS Workbench without printing its token:

```powershell
$env:CPOLY_WORKBENCH_URL = "https://<remote-workbench>"
$env:CPOLY_WORKBENCH_TOKEN_FILE = "<external-secret-file>"
.\kubernetes\operations\Test-CpolyWorkbenchTarget.ps1
```

This proves reachability and read-only cluster attachment only.

3. Admit and deploy the database through a separately governed external-cluster
Kubernetes identity:

```powershell
.\kubernetes\operations\Deploy-CpolyPostgres.ps1 `
  -Context <remote-context>

.\kubernetes\operations\Deploy-CpolyPostgres.ps1 `
  -Context <remote-context> `
  -Apply
```

Equivalent raw commands:

```powershell
kubectl --context <remote-context> apply --server-side `
  --dry-run=server -k .\infrastructure\cpoly-postgres

kubectl --context <remote-context> apply --server-side `
  -k .\infrastructure\cpoly-postgres
```

The deployed PostgreSQL StatefulSet, PVC, NetworkPolicy, TLS Service, signed D1
backup CronJob, logical restore jobs, and optional WAL-G resources carry CPOLY
management labels. Workbench read-only mode can then observe StatefulSets,
PVCs, CronJobs, Jobs, Services, and NetworkPolicies.

## Current blocker

No remote Workbench URL/token-file configuration or external Kubernetes context
is supplied by this repository. A remote Kubernetes API endpoint, governed
deployment identity, storage class, referenced secrets, load balancer, DNS/TLS,
and live Worker backup/recovery API remain concrete prerequisites. The
operator migration is checked in and Kustomize-generated. R2 error 10042 does
not block the primary D1 recovery path.
