# FixForward

**Diagnoses failed Salesforce deployments, fixes them in source and re-validates, without ever touching production.**

Built for the Copado Agentia Headless Virtual Hackathon. FixForward is a standalone, zero-dependency Node.js CLI that works alongside the Agentia CLI.

```
fixforward run --org uat

▶ Validation 1…
✘ Validation failed. Diagnosis:
  1. Custom field missing from the deployment [auto-fixable]
     Component: CustomField:Account.Priority_Score__c
  ✔ MISSING_FIELD: added CustomField:Account.Priority_Score__c to package.xml
▶ Validation 2…
✘ Validation failed. Diagnosis:
  1. Apex test coverage below 75% [auto-fixable]
  ✔ LOW_COVERAGE: generated DiscountCalculatorTest; added it to package.xml
▶ Validation 3…
✔ Validation passed.
```

## Why

When a validation or promotion fails, developers read hundreds of log lines, find the cause, fix it and validate again, often several times. The most common causes are predictable: components left out of the deployment, coverage below 75%, API version mismatches. FixForward handles these automatically. Agentia Expert helps with code-quality gate findings; FixForward complements it by handling deployment failures.

## How it works

1. **Validate:** runs a check-only `sf project deploy validate` against the target org.
2. **Diagnose:** deterministic rules classify each error (same input, same answer, safe in CI). Only unrecognised errors and test failures go to an LLM for a plain-English explanation.
3. **Fix:** in source only: adds missing fields, classes or objects to the manifest, generates Apex test classes for uncovered code, aligns API versions. Asks before changing anything unless `--yes` is passed.
4. **Re-validate:** repeats until green, a fix can't be applied, or `--max-rounds` is reached. It never loops on a fix that changed nothing.
5. **Learn:** every run is recorded; `fixforward insights` shows recurring errors and time-to-green.

**Governed by design:** FixForward never deploys and never holds production credentials. Fixes go into Git and reach production only through Copado's pipeline, quality gates and approvals (`--commit --push` hands the fix to `agentia cicd work push`).

| Rule | Detects | Auto-fix |
|---|---|---|
| MISSING_FIELD | `Field does not exist`, `No such column`, `no CustomField named` | Adds the field to the manifest (or retrieves it with `--source-org`) |
| MISSING_TYPE | `Invalid type: X` | Adds the class or object to the manifest |
| LOW_COVERAGE | Coverage below 75% | Generates a test class with the LLM |
| API_VERSION | API version errors | Sets apiVersion to the project's sourceApiVersion |
| TEST_FAILURE | Failing Apex tests | Explains; needs a human |
| UNKNOWN | Anything else | LLM explanation; needs a human |

## Install

Requires Node.js 18+ and the Salesforce CLI (`sf`).

```
cd fixforward
npm link
fixforward --help
```

Optional LLM (Groq free tier; any OpenAI-compatible API works via `FIXFORWARD_LLM_URL`):

```
set GROQ_API_KEY=your_key            (Command Prompt, current window)
set GROQ_MODEL=llama-3.3-70b-versatile   (optional; pick any model listed in your Groq console)
```

## Commands

```
fixforward run --org <alias> [--yes] [--commit] [--push] [--source-org <alias>] [--max-rounds 3]
fixforward diagnose --org <alias>              validate + diagnose, no changes
fixforward diagnose --file failed-deploy.json  diagnose a saved sf or Agentia log
fixforward diagnose --agentia "<agentia command that prints job logs>"
fixforward insights
```

Add `--json` to any command for machine-readable output (progress goes to stderr, JSON to stdout).

## Try the demo

The `demo/` folder holds a deliberately broken change: `AccountScorer` uses a custom field that is missing from `manifest/package.xml`, and `DiscountCalculator` has no test.

```
sf org login web --alias ffuat
xcopy /E /I /Y demo\force-app <your-project>\force-app
xcopy /E /I /Y demo\manifest <your-project>\manifest
cd <your-project>
fixforward run --org ffuat
fixforward insights
```

To reset: `git checkout -- manifest/package.xml` and delete `force-app/main/default/classes/DiscountCalculatorTest.cls*`.

## Use from an AI agent

`skills/fixforward/SKILL.md` teaches any coding agent (alongside `agentia mcp start` and Agentia Skills) when and how to call FixForward. Copy it into your agent's skills folder.

## Tests

```
npm test
```

## Limitations

- Fixes are applied to the manifest and source; generated tests must be reviewed before committing.
- Agentia job log formats may change during the beta; `diagnose --agentia` falls back to text parsing.
- Rules cover the most common errors; everything else is explained, not fixed.
