# Infra RCA and RPA operating guide

For the complete operator procedures, troubleshooting tables and test records, see the [step-by-step IT user guide](IT-USER-GUIDE.md). This page remains the shorter operating overview.

## Configure a large infrastructure inventory

1. Open **Settings → MCP Connectors → Infra RCA**.
2. If it shows **Disabled**, choose **Enable Infra RCA** and wait for **Connected**. Targets and connector enablement are separate: importing systems does not enable a disabled connector.
3. Expand **Bulk import systems (CSV / JSON)** and choose **Download CSV template**.
4. Fill the inventory in Excel or another editor. Export as **CSV UTF-8**; `.xlsx` is not an import format. JSON arrays are also accepted. Maximum per batch: 10,000 systems and 5 MB.
5. Enter shared credentials for that batch. For different credentials or sites, import a separate batch or supply non-empty values on individual rows.
6. Choose **Skip existing targets** for safe repeated onboarding, or **Update existing targets** when updating groups or credentials for the same endpoints.
7. Select **Validate inventory**. Review counts, public fields and record errors. Correct errors and validate again. The preview shows up to 100 valid records and the first 50 errors; it does not return credential fields.
8. Select **Import validated systems**. The entire batch is revalidated and saved with one encrypted write. No partial batch is saved when validation fails.

Example inventory without credentials:

```csv
name,protocol,host,port,username,group,dbEngine,dbName
mum-linux-001,ssh,10.10.1.11,22,svc_diagnostics,Mumbai-Production,,
mum-linux-002,ssh,10.10.1.12,22,svc_diagnostics,Mumbai-Production,,
del-win-001,winrm,10.20.1.11,5985,DOMAIN\svc_diagnostics,Delhi-Production,,
mum-switch-001,snmp,10.10.2.1,161,,Mumbai-Network,,
mum-db-001,db,10.10.3.11,5432,svc_readonly,Mumbai-Databases,postgres,operations
```

This mixed example requires suitable per-row credentials or separate credential batches. Do not assign one shared account indiscriminately across unrelated systems.

Supported columns/JSON fields:

| Field                      | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `name`                     | Unique target name used in chat; matching ignores case during import |
| `host`                     | Hostname or IP address; no URL scheme or path                        |
| `protocol`                 | `ssh`, `winrm`, `snmp`, or `db`                                      |
| `port`                     | Optional integer 1–65535; protocol default when omitted              |
| `group`                    | Optional site, environment or operational group                      |
| `username`                 | SSH, WinRM or database account                                       |
| `secret`                   | Password; preferably enter using the shared password control         |
| `privateKey`, `passphrase` | SSH private-key contents and optional passphrase                     |
| `community`                | SNMP v2c community; there is no SNMPv3 setup in this driver          |
| `dbEngine`, `dbName`       | `postgres` / `mysql`, and database name                              |

Non-empty row values override shared values. For updates, omitted/blank optional values preserve saved fields unless a shared value replaces them. Shared credentials are copied into each target record; this is not a central reusable credential-profile/vault feature. Updating credentials for a group means reimporting those names with **Update existing targets** selected. Imports preserve target IDs. A host/protocol change requires a new name so credentials are not silently redirected to another endpoint. Duplicate names in one file are rejected.

## Use Infra RCA after import

Use the search field to filter the inventory by name, host, protocol or group; the UI displays 50 entries per page. The **Test** button checks TCP reachability for SSH, WinRM and databases, without verifying login or diagnostic privileges. For SNMP it sends a read-only request and requires a response.

Failed checks show the error category, tested port and corrective steps. WinRM results include expandable read-only Windows checks and the adapter's authentication limits. The chat tool `infra_ping_check` shares the same protocol-aware check and marks failed readiness as a tool error. See [WinRM troubleshooting](IT-USER-GUIDE.md#winrm-host-unreachable-timeout-or-connection-refused) for host-down, timeout and refused-connection procedures.

Example chat requests:

> List the Mumbai-Production systems, continuing through every page. Do not run diagnostics yet.

> Diagnose disk health on mum-linux-001 and mum-linux-002. Report findings and proposed actions. Ask before applying any fix.

`infra_list_targets` supports `query`, exact `group`, `offset`, and `limit` (1–100; default 50). Its result includes `total` and `nextOffset`; continue until `nextOffset` is null. Importing an inventory does not test connectivity, grant privileges, deploy agents or continuously monitor the fleet. Real diagnostics require network/VPN access and authorized accounts. Fleet-wide throughput has not been established by the import test.

## Configure RPA for a business process

**Enable RPA makes tools available. It does not configure every application or create a validated automation.**

1. Open **Settings → MCP Connectors → RPA / Desktop automation → Enable RPA**. Confirm **Connected**. Configure a working vision-capable provider for visual operations.
2. Open the intended app, account and tenant. Sign in manually. On macOS grant Accessibility and Screen Recording permissions when prompted. Ensure the execution desktop is available and unlocked.
3. Expand **Configure a business workflow**. Give the task a unique name and select local desktop, website, or Remote Desktop/Citrix.
4. Enter the application/URL/remote host, input parameters, ordered business steps and a concrete success check. Do not place passwords or OTPs in the form or recipe.
5. Choose **Prepare instructions** to inspect/copy the brief, or **Review setup in chat** to start a planning conversation. Review the proposed plan before application operations.
6. Run a small sample against a test account. For desktop primitives, ask the agent to record each supported step and save a named recipe. Recording is agent-mediated; the connector is not a passive global recorder of everything you do with the mouse.
7. Replay with representative inputs and after moving the window. Re-open the resulting record/file and compare business values with the expected result.
8. Schedule only a verified process. Use **Settings → Schedule** with the recipe name, parameters, expected checks and an error-reporting instruction. Interactive login/MFA or required approvals may prevent unattended execution. Run one UI automation per interactive desktop to avoid conflicting focus, keyboard and mouse actions.

Example workflow brief:

```text
Name: HRMS attendance export
Application type: Website
Application: HRMS test tenant at your organization's URL
Inputs: report_date, department, output_folder
Steps: open attendance report; choose date/department; export CSV
Success check: reopen CSV; verify report date, department, unique employee IDs,
expected employee count and absence of duplicate rows; report the saved path
```

Use a separate named workflow for attendance export, employee onboarding, ERP invoice entry, reconciliation or other distinct tasks. Desktop recipes currently record `click`, `type_text`, `key_press`, `scroll`, `drag` and `wait`. `{{parameter}}` placeholders support changing business values. `list_recipes` lists saved recipes and `run_recipe` requests replay. Browser-tool/API calls are not stored as desktop recipe steps.

## Choose the route and verify accuracy

| Application             | Practical route                                                                             | Verify the business result                                            |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Web ERP / HRMS          | Configured browser connector using page elements; authorized application API when available | Reopen the record/report; check ID, status, date and totals           |
| Native desktop app      | GUI_Operate with app context, semantic target descriptions and visual checks                | Read the resulting screen/record and reopen exported files            |
| Remote Desktop / Citrix | Operate the visible client session after confirming the remote host                         | Confirm remote identity, record ID, final state and output location   |
| Spreadsheet/file task   | Prefer the applicable file/Office tool for structured work                                  | Reopen the artifact; verify formulas, counts and totals independently |

For websites, user-facing locators are re-resolved against the current page, and state-based waiting handles elements becoming visible/enabled; this supports more resilient automation than depending on saved pixel positions. See [Playwright locators](https://playwright.dev/docs/locators) and [actionability checks](https://playwright.dev/docs/actionability). Those references describe the approach; they do not imply every configured browser connector exposes Playwright. Windows also has a structured [UI Automation API](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview); the current GUI_Operate connector is not a full UIA-based process designer.

Before trusting a workflow, test expected and exceptional conditions: slow loading, moved windows, unexpected dialogs, missing inputs, expired login, duplicate records and an operation whose result is uncertain. Stop on ambiguity. Read back the application state before retrying a submission. A click or generic screen change is not proof of correct business data. Use `emergency_stop` to stop further GUI actions and inspect the result before resuming.

The workflow form creates planning instructions, not enforced business postconditions. Recipe replay stops when semantic click relocation fails, but application-specific verification still needs the actual workflow, tools and live acceptance evidence. It does not deploy distributed RPA workers to the imported Infra RCA systems. A successful local test does not establish an accuracy percentage for your ERP or HRMS.

## Verification for this change

The isolated Electron acceptance journey imported 1,200 synthetic systems through the rendered Settings UI into the real encrypted target store, reopened that store, rejected an invalid batch without changing saved targets, enabled the real Infra RCA MCP server through fixture IPC, and read a filtered inventory page through its real authenticated broker. RPA workflow fields reached the setup-chat handoff; the model/provider call was stubbed. Production application startup and external systems were not exercised by this fixture.

Unit tests cover parsing, validation, duplicate handling, credential preservation/redaction, fleet pagination, built-in connector visibility, SNMP probe behavior and the RPA setup brief. Real fleet authentication, ERP/HRMS execution and unattended acceptance require your inventory, credentials, test account and a specific process.
