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

### Ollama Custom Models

Edit **Settings -> API -> Ollama** and set any model tag pulled via `ollama pull <model>`.

---

## Architecture

See [Architecture.md](./Architecture.md) for the full system design with flow diagrams.

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
