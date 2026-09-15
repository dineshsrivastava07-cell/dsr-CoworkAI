# V-Coworker

> **Local-first Autonomous Agentic Desktop App** — powered by Ollama + Gemma, with optional Gemini, ChatGPT, Anthropic, and OpenRouter cloud models.
> Developed by **DSR AI Lab**

---

## What is V-Coworker?

**V-Coworker** is an open-source, privacy-first autonomous AI agent desktop application for macOS and Windows. It runs your AI workloads entirely on your local machine using [Ollama](https://ollama.com) and [Gemma](https://ai.google.dev/gemma) models by default — no cloud API keys required for inference — while letting you switch to Gemini, ChatGPT (OpenAI), Anthropic, or OpenRouter at any time, right from the chat window.

V-Coworker is built to act as a genuine autonomous agent for desktop and knowledge work, not a single-purpose chatbot. It plans and executes multi-step tasks end-to-end using real tools — browser automation, desktop app control, document/spreadsheet/presentation generation, Google Workspace access, scheduled recurring tasks — and is designed so that reliability fixes (permission handling, oversized tool output, memory correctness) apply generically across every task type rather than being special-cased to one example.

Built on top of the Electron + React stack, V-Coworker gives you:

- **Chief Orchestrator model** — a single agent that operates across six domains (desktop/RPA, IT infrastructure, project planning, financial analysis, corporate communications, web navigation), each backed by its own real tool, plus `spawn_subagent` for delegating an isolated sub-task to a domain-specific persona
- **Autonomous Mode** — opt-in auto-approval of tool calls so scheduled/unattended tasks don't stall waiting for a click, without ever overriding explicit deny rules or irreversible-action confirmations
- In-chat model switcher — change provider/model (Ollama, Gemini, OpenAI, Anthropic, OpenRouter) without leaving the conversation
- One-click MCP (Model Context Protocol) tool integration, plus six bundled first-party MCP servers (see below)
- RPA recipes — record a sequence of desktop actions once, replay it reliably against any app/ERP for recurring daily tasks
- Remote infrastructure RCA — diagnose Linux/Windows servers, network gear, printers, UPS, and databases over SSH/WinRM/SNMP/DB, run read-only lookup queries, and get a proposed fix that auto-verifies itself once you approve and it runs
- Roadmap & Gantt generation — from an existing workbook, or from a plain-language description alone
- Skill protocols — reusable AI workflows
- Sandbox isolation (Lima on macOS, WSL on Windows)
- Persistent memory across sessions, with guardrails against treating past failures as a reason to skip the current attempt
- Scheduled & reactive (watch-condition) recurring tasks, with fast-fail permission handling for unattended runs
- Remote control via Slack (or other channel adapters) plus VNC-based remote desktop
- Full TypeScript codebase — hackable and extendable

### Reliability and security boundaries

The execution path includes explicit controls for organizational use:

- Delegated workers run inside the parent workspace, inherit the parent permission policy, and preserve MCP image/error results.
- Deny rules override remembered grants; changing permission rules invalidates session grants.
- Database lookup tools accept one bounded read-only statement and execute it inside a read-only transaction with timeout and cancellation handling.
- Infrastructure fixes require a proposal, a trusted approval recorded by the main process, a single-use execution claim, and post-fix verification.
- Office shortcuts reject multi-artifact/research requests, validate artifact responses, and support multiple source files and common Office/PDF inputs.
- RPA recipe replay fails when semantic relocation cannot find the target instead of clicking stale coordinates.

MCP Docker and clickhouse-cloud are intentionally outside this project scope and are not bundled, configured, or required.

---

## Features

| Feature                  | Details                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator**         | One agent operating across 6 domains (RPA/desktop, IT infra, project planning, financial analysis, corporate comms, web navigation), each mapped to a real tool; `spawn_subagent` delegates a sub-task to a domain-specific persona                                     |
| **Local LLM**            | Ollama + Gemma 4 (26b / e4b) — runs 100% on your machine                                                                                                                                                                                                                |
| **Multi-provider**       | Switch between Ollama, Gemini, OpenAI (ChatGPT), Anthropic, and OpenRouter from the chat window                                                                                                                                                                         |
| **Autonomous Mode**      | Auto-approve tool calls that would otherwise wait on a permission dialog — for unattended/scheduled work                                                                                                                                                                |
| **MCP Tools**            | 1-click install of Model Context Protocol servers, plus 6 bundled first-party servers                                                                                                                                                                                   |
| **Browser Automation**   | Full page navigation, click, type, snapshot via the Chrome MCP server                                                                                                                                                                                                   |
| **Desktop / App RPA**    | Click, type, drag, scroll, screenshot, vision-based element location, app tracking, and an emergency-stop safety switch via GUI_Operate                                                                                                                                 |
| **RPA Recipes**          | Record a sequence of desktop actions once, replay it reliably against any app/ERP for recurring daily tasks — replay re-locates targets semantically instead of trusting stale coordinates                                                                              |
| **Infra RCA**            | Remote diagnostics for Linux/Windows servers, network gear, printers, UPS, and databases (SSH/WinRM/SNMP/DB), plus read-only ad-hoc DB queries — proposes fixes but never auto-executes one without your explicit approval, and auto-verifies a fix worked once it runs |
| **Office Documents**     | Create Excel (.xlsx, with live formulas — NPV/IRR/STDEV/growth-rate), Word (.docx), and PowerPoint (.pptx, with native charts) via Office_Tools                                                                                                                         |
| **Project Roadmaps/WBS** | WBS/Gantt-chart generation — source-driven from an existing workbook, or built from scratch off a plain-language description (Excel and PPTX output)                                                                                                                    |
| **Google Workspace**     | Gmail, Drive, and Calendar access with bundled OAuth                                                                                                                                                                                                                    |
| **OCR**                  | Text extraction from images via Tesseract                                                                                                                                                                                                                               |
| **Weather**              | Live weather data via Open-Meteo                                                                                                                                                                                                                                        |
| **Skills**               | Reusable agent skill protocols stored locally                                                                                                                                                                                                                           |
| **Sandbox**              | Lima (macOS) / WSL (Windows) process isolation                                                                                                                                                                                                                          |
| **Memory**               | Long-term and short-term persistent memory, with untrusted-context and no-fabrication guardrails                                                                                                                                                                        |
| **Scheduled Tasks**      | Daily/recurring and reactive watch-condition tasks; unattended runs fail fast instead of stalling on a permission dialog                                                                                                                                                |
| **Remote**               | Control sessions remotely via Slack or other channels, plus VNC-based remote desktop                                                                                                                                                                                    |
| **Multi-session**        | Parallel agent sessions with context tracking                                                                                                                                                                                                                           |
| **Themes**               | Dark / Light / System                                                                                                                                                                                                                                                   |
| **macOS Signing**        | Auto ad-hoc code signing of native addons on install (macOS 26 Tahoe compatible)                                                                                                                                                                                        |

---

## Quick Start

### Prerequisites

- **macOS** (Apple Silicon recommended) or **Windows 10/11**
- **Node.js >= 22**
- **[Ollama](https://ollama.com)** installed and running
- Gemma model pulled: `ollama pull gemma4:26b` (or the smaller/faster `gemma4:e4b`)

### Install & Run

```bash
git clone https://github.com/dineshsrivastava07-cell/dsr-CoworkAI.git
cd dsr-CoworkAI
npm install
npm run dev
```

### Build for macOS

```bash
npm run build
# Output: release/dsr-CoworkAI-*.dmg
```

### Build for Windows

```bash
npm run build:win
```

---

## Configuration

On first launch, V-Coworker defaults to **Ollama** with **gemma4:26b**. No configuration needed if Ollama is running at `http://localhost:11434`.

### Switching Providers/Models

Use the model switcher in the chat header, or go to **Settings -> API**, to pick between:

- **Ollama** — any locally pulled model, no API key needed
- **Gemini** — via API key (Settings -> API), including the free-tier-eligible models
- **OpenAI (ChatGPT)** — via API key
- **Anthropic** — via API key
- **OpenRouter** — via API key

A provider without a saved API key shows as disabled in the switcher with a prompt to add one in Settings.

### Autonomous Mode

Go to **Settings -> General -> Autonomous Mode** to auto-approve tool calls that would otherwise show a permission dialog and wait up to 60 seconds for a click. This is most useful for scheduled/unattended tasks. It never overrides an explicit "deny" permission rule, and never bypasses tool-level irreversible-action confirmations (e.g. GUI_Operate's click-intent check before send/delete/purchase/pay/confirm actions).

### Enable RPA / desktop automation

1. Open **Settings → MCP Connectors → RPA / Desktop automation** and click **Enable RPA**. The bundled connector connects immediately; no API token is needed to enable it.
2. Wait for **Connected** and the available tool count. On macOS, grant the app **Accessibility** and **Screen Recording** access in **System Settings → Privacy & Security** when prompted. Desktop automation supports macOS and Windows; vision-based actions require a configured vision-capable provider.
3. Start a chat and ask **“List my saved RPA recipes.”** To create a workflow, ask the agent to record the steps while it performs them, then save the recipe under a name.

Use **Disable RPA** in the same card to disconnect it. The choice persists across app restarts. If connection fails, the error is shown and the connector returns to disabled so you can correct the problem and retry. Existing tool permission rules still apply.

Expand **Configure a business workflow** to enter the application type, application/URL, inputs, business steps and expected result. **Prepare instructions** creates a reviewable brief; **Review setup in chat** starts a conversation to plan and supervise setup. This does not itself create an executable recipe or validate a business process. Desktop recipes are recorded and replayed through the existing chat tools. Web applications should use configured browser tools when available; desktop recipes do not capture browser-tool/API calls.

### Bulk infrastructure configuration

Open **Settings → MCP Connectors → Infra RCA**. Its Enable/Disable control and connection state now match the saved connector configuration, including implicit built-ins. A previously saved disabled connector remains disabled until you enable it.

Expand **Bulk import systems (CSV / JSON)**, download the CSV template, and upload an inventory of up to **10,000 systems / 5 MB per batch**. Export Excel workbooks as **CSV UTF-8** first. Enter shared credentials once per batch, choose whether to skip or update matching names, then **Validate inventory → Import validated systems**. Any invalid row prevents the entire batch from being saved. Credentials go into the existing encrypted target store; previews and model-facing lists contain no credential fields.

Search and page through systems by name, host, protocol or group/site. The agent's `infra_list_targets` tool also supports `query`, `group`, `offset` and `limit` so large inventories are not silently truncated. Import registers targets; it does not run a fleet-wide network scan.

See the [Infra RCA and RPA operating guide](INFRA-RPA-OPERATIONS.md) for templates, credential updates, setup steps, accuracy checks and current execution limits.

### Ollama Custom Models

Edit **Settings -> API -> Ollama** and set any model tag pulled via `ollama pull <model>`.

---

## Architecture

See [Architecture.md](./Architecture.md) for the full system design with flow diagrams.

## Verification

For IT administrators and operators, start with the [step-by-step IT user guide](IT-USER-GUIDE.md). It covers RPA and Infra RCA settings, bulk inventories, troubleshooting, 23 acceptance tests, and [downloadable templates](user-guide-templates/).

Run the local checks before publishing a build:

```bash
npm run typecheck
npm run lint
npm test -- --run
```

Focused safety and workflow suites cover permissions, delegated agents, read-only database queries, encrypted-store migration, infrastructure proposal safety, Office/Gantt behavior, and RPA recipe storage. Live provider, database, desktop, browser, spreadsheet-engine, packaging, and stakeholder acceptance require their corresponding fixtures and are reported separately from local unit-test evidence.

---

## Project Structure

```
dsr-CoworkAI/
├── src/
│   ├── main/          # Electron main process
│   │   ├── agent/     # Agent runner, permission hook, session loop
│   │   ├── config/    # Config store + Ollama/Gemini/OpenAI/Anthropic auth
│   │   ├── mcp/       # MCP manager + bundled servers (gui-operate, office-tools,
│   │   │              #   google-workspace, ocr-tools, weather-tools, infra-rca)
│   │   ├── remote/    # Slack (and other channel) + VNC remote control
│   │   ├── sandbox/   # Lima / WSL isolation
│   │   ├── skills/    # Skill protocol registry
│   │   ├── schedule/  # Scheduled + reactive watch tasks
│   │   └── memory/    # Persistent memory store
│   ├── renderer/      # React UI (Vite + Tailwind)
│   │   ├── components/  # incl. ModelSwitcher (in-chat provider/model picker)
│   │   ├── store/     # Zustand state
│   │   └── i18n/      # English locale
│   └── shared/        # Shared types & utilities
├── resources/         # App icons, entitlements
├── scripts/           # Build & packaging scripts
└── electron-builder.yml
```

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Office Document Generation

V-Coworker can create fully formatted office documents on demand via the built-in **Office Tools MCP server**:

| Command example                                          | Output                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Create a sales report Excel with Q1-Q4 data"            | `.xlsx` — styled headers, zebra rows, SUM totals, frozen panes                              |
| "Build a financial model with NPV, IRR, and growth rate" | `.xlsx` — live formula cells (any Excel formula, custom number formats)                     |
| "Write a project proposal Word document"                 | `.docx` — H1-H3 headings, bullet lists, numbered lists, tables                              |
| "Make a 5-slide pitch deck with a revenue chart"         | `.pptx` — title/content/two-column/table slides plus native bar/pie/line charts             |
| "Turn this roadmap workbook into a detailed WBS"         | `.xlsx`/`.pptx` — source-driven WBS/roadmap generated from an attached workbook             |
| "Create a Gantt chart roadmap for launching our new app" | `.xlsx` — WBS + day-by-day Gantt chart built from the description alone, no workbook needed |

Files are saved to your Desktop (or `WORKSPACE_DIR` env var) by default.

## Other Bundled MCP Servers

| Server               | Capability                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome**           | Full browser automation — navigate, click, type, snapshot, form-fill                                                                                                                                                                                                  |
| **GUI_Operate**      | Desktop/app RPA — click, type, drag, scroll, screenshot, vision-based element location, app-launch tracking, emergency stop/resume, plus record/replay recipes for recurring tasks                                                                                    |
| **Google_Workspace** | Gmail, Drive, and Calendar, with bundled OAuth (no manual credential setup)                                                                                                                                                                                           |
| **OCR_Tools**        | Text extraction from images via Tesseract                                                                                                                                                                                                                             |
| **Weather_Tools**    | Live weather data via Open-Meteo                                                                                                                                                                                                                                      |
| **Infra_RCA**        | Remote diagnostics over SSH/WinRM/SNMP/DB — diagnoses OS/disk/RAM/network/DB/printer/power health, runs read-only DB lookups, and proposes a fix that auto-verifies itself after execution, but never executes one without your explicit approval in the conversation |

Additional servers (Notion, Software_Development, or any custom MCP server) can be added from **Settings -> MCP Servers**.

---

## macOS Compatibility (Tahoe / macOS 26)

macOS 26 (Tahoe) enforces strict code-signing on all native Mach-O addons loaded via `dlopen`. On `npm install`, the `sign-native.sh` postinstall script automatically ad-hoc signs all `.node` native addons (better-sqlite3, clipboard, keytar, etc.) with the required entitlements:

- `cs.allow-jit`
- `cs.allow-unsigned-executable-memory`
- `cs.disable-library-validation`
- `cs.allow-dyld-environment-variables`

No manual signing step is required.

---

## Developed by

**DSR AI Lab**
[github.com/dineshsrivastava07-cell](https://github.com/dineshsrivastava07-cell)
