# RPA workflow brief

Complete an approved local copy. Do not enter passwords, private keys, API keys, OTPs or session tokens.

## Ownership and environment

- Workflow name and revision:
- Process owner / technical owner:
- Application and version:
- Surface: local desktop / website / Remote Desktop or Citrix
- Test URL, tenant or remote host:
- Account role (no credentials):
- V-Coworker build and provider/model:
- Execution workstation, display and local timezone:
- Working/output directory:

## Starting state and inputs

- Required login and application state:
- Required connectors and permissions:
- Input file/source and approved sample:
- Parameter names, example values and required validation:
- Unique business key used to detect duplicates:
- Actions needing human approval:

## Ordered process steps

| Step | Application/screen | Action and semantic target | Input   | Expected state after action | Action on failure |
| ---- | ------------------ | -------------------------- | ------- | --------------------------- | ----------------- |
| 1    | Fill in            | Fill in                    | Fill in | Fill in                     | Stop and report   |

## Independent success checks

- Saved record/file to reopen:
- Expected IDs, dates, counts, totals or status:
- Baseline source and evidence location:
- How to detect missing, duplicate or partial outputs:
- How to reconcile uncertain submissions before retrying:

## Recipe and operation

- Desktop recipe name, if applicable:
- Supported desktop actions recorded:
- Browser/API actions kept outside the desktop recipe:
- Required replay starting state and parameters:
- Stop and recovery procedure:
- Proposed schedule and timezone (only after acceptance):
- Expected duration and collision-free execution window:
- Failure reporting destination/process:

## Acceptance

| Test/date | Input case                                                        | Actual result | Evidence | Status  | Reviewer |
| --------- | ----------------------------------------------------------------- | ------------- | -------- | ------- | -------- |
| Not run   | Normal / moved window / missing input / duplicate / expired login | Pending       | Pending  | Not run | Pending  |

- Unresolved failures and excluded environments:
- Approved dataset/volume range:
- Application owner sign-off/date:
- Technical owner sign-off/date:
- Next review trigger (app, model, credentials or process change):
