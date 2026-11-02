---
name: fixforward
description: Diagnose and fix failed Salesforce deployments or validations in a Copado Agentia project. Use when `sf project deploy validate`, a Copado promotion or an Agentia job fails with deployment errors (missing fields or classes, test coverage below 75%, API version errors, failing tests).
---

# FixForward

FixForward validates a deployment, classifies each error with deterministic rules, applies safe fixes in source, and re-validates.

## When to use
- A validation, promotion or Agentia CI/CD job failed and you need to know why.
- You changed Salesforce metadata and want to confirm it deploys before pushing the user story.

## Commands (always pass --json)
1. Diagnose only, no changes:
   `fixforward diagnose --org <target-alias> --json`
   For a failed Agentia job, pass the Agentia command that prints its logs:
   `fixforward diagnose --agentia "<agentia cicd job ... command>" --json`
2. Fix and re-validate after the user approves:
   `fixforward run --org <target-alias> --yes --json`
3. Hand the verified fix to Copado, only when the user asks:
   `fixforward run --org <target-alias> --yes --commit --push --json`

## Reading results
- `result: "passed"` means validation is green.
- `result: "needs-human"` means the remaining errors have no safe automatic fix; show the user each diagnosis and its `aiExplanation`.
- `result: "max-rounds"` means fixes kept producing new errors; stop and report.

## Guardrails
- Never run `fixforward run --yes` without the user's approval of the diagnosis.
- Never use `--push` unless the user asked to push to the user story.
- Never validate against a production org alias; validate against the next pipeline stage.
- Generated test classes must be shown to the user for review before committing.
- FixForward never deploys. Releases go through Copado promotions and approvals only.
