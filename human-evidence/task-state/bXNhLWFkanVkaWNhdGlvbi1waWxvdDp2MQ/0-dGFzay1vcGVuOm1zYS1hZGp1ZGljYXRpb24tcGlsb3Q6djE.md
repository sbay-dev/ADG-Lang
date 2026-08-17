# سجل حالة مهمة موثّق / Bound task-state record

> [!WARNING]
> هذه المادة مستوردة تقنيًا فقط، وتبقى غير موثوقة حتى تراجعها الصيانة العلمية والأمنية وسلامة الادعاء.
> This imported record is untrusted until maintainers review provenance, integrity, and claim boundaries.

## بيانات تقنية / Technical metadata

| الحقل / Field | القيمة / Value |
| --- | --- |
| النوع / Type | task-state |
| الحدث / Event | `task-open:msa-adjudication-pilot:v1` |
| نسخة المهمة / Task version | `msa-adjudication-pilot:v1` |
| الحزمة / Packet | `msa-adjudication-pilot-v1` |
| الحالة / State | `open` |
| رقم الحالة / State version | `0` |
| الجولة / Round | `1` |
| وقت الانتقال / Transitioned at | `2026-08-15T16:36:58.119Z` |

## حدود الادعاء / Claim boundaries

- This is a signed workflow-state event, not linguistic gold by itself.
- Participant identity and contact data are excluded.
- Published status requires a separately authenticated repository receipt.

## الربط الآلي / Machine binding

```json
{
  "schema": "adg-msa-task-state-v1",
  "eventId": "task-open:msa-adjudication-pilot:v1",
  "taskVersionId": "msa-adjudication-pilot:v1",
  "taskId": "msa-adjudication-pilot",
  "taskVersion": 1,
  "packetId": "msa-adjudication-pilot-v1",
  "packetMerkleRoot": "3a06e94d7b53f3f4938c074511836bc4a19c95c724b18d8276530b02bfb7b8e5",
  "protocolVersion": "adg-consensus-policy-v1",
  "state": "open",
  "stateVersion": 0,
  "round": 1,
  "activeFinalReceiptId": null,
  "eventType": "task-opened",
  "fromState": "draft",
  "toState": "open",
  "reasonCode": "task-version-registered",
  "evidence": {
    "taskVersionId": "msa-adjudication-pilot:v1",
    "identity": {
      "id": "msa-adjudication-pilot:v1",
      "taskId": "msa-adjudication-pilot",
      "taskVersion": 1,
      "packetId": "msa-adjudication-pilot-v1",
      "holdoutId": "pilot-authored-msa-not-final",
      "packetMerkleRoot": "3a06e94d7b53f3f4938c074511836bc4a19c95c724b18d8276530b02bfb7b8e5",
      "guidelineVersion": "msa-human-guidelines-v1",
      "dataVersion": "pilot-authored-msa-v1",
      "protocolVersion": "adg-consensus-policy-v1"
    },
    "metricPolicy": {
      "schema": "adg-iaa-policy-v1",
      "policyVersion": "adg-consensus-policy-v1",
      "metrics": [
        "raw-agreement",
        "cohen-kappa"
      ],
      "minimumRawAgreement": 0.9,
      "minimumDefinedKappa": 0.8,
      "undefinedKappaFallback": "raw-agreement",
      "automaticFinalization": false,
      "claimBoundary": "Task-specific policy; no universal IAA threshold is claimed."
    }
  },
  "priorStateHash": null,
  "eventHash": "18ee7e5861da5e34af6629bef118704e91cd5b797ca1f9bbab10e2dc838fa199"
}
```
