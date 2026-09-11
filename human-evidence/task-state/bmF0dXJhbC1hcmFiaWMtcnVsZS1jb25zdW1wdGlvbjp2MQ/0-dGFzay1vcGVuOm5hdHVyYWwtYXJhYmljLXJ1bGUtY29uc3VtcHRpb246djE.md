# سجل حالة مهمة موثّق / Bound task-state record

> [!WARNING]
> هذه المادة مستوردة تقنيًا فقط، وتبقى غير موثوقة حتى تراجعها الصيانة العلمية والأمنية وسلامة الادعاء.
> This imported record is untrusted until maintainers review provenance, integrity, and claim boundaries.

## بيانات تقنية / Technical metadata

| الحقل / Field | القيمة / Value |
| --- | --- |
| النوع / Type | task-state |
| الحدث / Event | `task-open:natural-arabic-rule-consumption:v1` |
| نسخة المهمة / Task version | `natural-arabic-rule-consumption:v1` |
| الحزمة / Packet | `natural-arabic-rule-consumption-v1` |
| الحالة / State | `open` |
| رقم الحالة / State version | `0` |
| الجولة / Round | `1` |
| وقت الانتقال / Transitioned at | `2026-08-19T18:13:23.633Z` |

## حدود الادعاء / Claim boundaries

- This is a signed workflow-state event, not linguistic gold by itself.
- Participant identity and contact data are excluded.
- Published status requires a separately authenticated repository receipt.

## الربط الآلي / Machine binding

```json
{
  "schema": "adg-msa-task-state-v1",
  "eventId": "task-open:natural-arabic-rule-consumption:v1",
  "taskVersionId": "natural-arabic-rule-consumption:v1",
  "taskId": "natural-arabic-rule-consumption",
  "taskVersion": 1,
  "packetId": "natural-arabic-rule-consumption-v1",
  "packetMerkleRoot": "faf0b42513f015015612dffc83fb71f37b904f322692e927bdb2eae8ef49214c",
  "protocolVersion": "adg-quranic-source-rule-transfer-adjudication-v0",
  "state": "open",
  "stateVersion": 0,
  "round": 1,
  "activeFinalReceiptId": null,
  "eventType": "task-opened",
  "fromState": "draft",
  "toState": "open",
  "reasonCode": "task-version-registered",
  "evidence": {
    "taskVersionId": "natural-arabic-rule-consumption:v1",
    "taskBinding": {
      "id": "natural-arabic-rule-consumption:v1",
      "taskId": "natural-arabic-rule-consumption",
      "taskVersion": 1,
      "packetId": "natural-arabic-rule-consumption-v1",
      "holdoutId": "authored-natural-arabic-rule-consumption-v1-not-final",
      "packetMerkleRoot": "faf0b42513f015015612dffc83fb71f37b904f322692e927bdb2eae8ef49214c",
      "guidelineVersion": "natural-arabic-rule-consumption-guidelines-v1",
      "dataVersion": "natural-arabic-rule-consumption-data-v1",
      "protocolVersion": "adg-quranic-source-rule-transfer-adjudication-v0"
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
  "eventHash": "81cdfd19edbf61c81552351befe3d2f3c343e54beb31a0715f0914e0c4a5380e"
}
```
