# dsr-CoworkAI

> **Local-first AI Agent Desktop App** — powered by Ollama + Gemma, with Gemini OAuth sign-in.
> Developed by **D1SR AI Lab**

---

## What is dsr-CoworkAI?

**dsr-CoworkAI** is an open-source, privacy-first AI agent desktop application for macOS and Windows. It runs your AI workloads entirely on your local machine using [Ollama](https://ollama.com) and [Gemma](https://ai.google.dev/gemma) models — no cloud API keys required for inference. Sign in securely with your Google/Gemini account via OAuth.

Built on top of the Electron + React stack, dsr-CoworkAI gives you:

- One-click MCP (Model Context Protocol) tool integration
- Skill protocols — reusable AI workflows
- Sandbox isolation (Lima on macOS, WSL on Windows)
- Persistent memory across sessions
- Remote control via Slack integration
- Full TypeScript codebase — hackable and extendable

---

## Features

| Feature           | Details                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| **Local LLM**     | Ollama + Gemma 4 (27b / e4b) — runs 100% on your machine                         |
| **Gemini OAuth**  | Sign in with Google/Gemini — no raw API key needed                               |
| **MCP Tools**     | 1-click install of Model Context Protocol servers                                |
| **Skills**        | Reusable agent skill protocols stored locally                                    |
| **Sandbox**       | Lima (macOS) / WSL (Windows) process isolation                                   |
| **Memory**        | Long-term and short-term persistent memory                                       |
| **Remote**        | Control sessions remotely via Slack                                              |
| **Multi-session** | Parallel agent sessions with context tracking                                    |
| **Themes**        | Dark / Light / System                                                            |
| **Office Tools**  | Create Excel (.xlsx), Word (.docx), and PowerPoint (.pptx) via MCP               |
| **macOS Signing** | Auto ad-hoc code signing of native addons on install (macOS 26 Tahoe compatible) |

---

## Quick Start

### Prerequisites

- **macOS** (Apple Silicon recommended) or **Windows 10/11**
- **Node.js >= 22**
- **[Ollama](https://ollama.com)** installed and running
- Gemma model pulled: `ollama pull gemma4:27b`

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

On first launch, dsr-CoworkAI defaults to **Ollama** with **gemma4:27b**. No configuration needed if Ollama is running at `http://localhost:11434`.

### Gemini OAuth Sign-In

1. Open **Settings -> API**
2. Select **Gemini** as provider
3. Click **Sign in with Google** — OAuth flow opens in browser
4. Your Gemini credentials are updated securely in the system keychain

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
│   │   ├── agent/     # Agent runner & session management
│   │   ├── config/    # Config store + Ollama/Gemini auth
│   │   ├── mcp/       # MCP server manager
│   │   ├── remote/    # Slack remote control
│   │   ├── sandbox/   # Lima / WSL isolation
│   │   ├── skills/    # Skill protocol registry
│   │   └── memory/    # Persistent memory store
│   ├── renderer/      # React UI (Vite + Tailwind)
│   │   ├── components/
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

dsr-CoworkAI can create fully formatted office documents on demand via the built-in **Office Tools MCP server**:

| Command example                               | Output                                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| "Create a sales report Excel with Q1-Q4 data" | `.xlsx` — styled headers, zebra rows, SUM totals, frozen panes |
| "Write a project proposal Word document"      | `.docx` — H1-H3 headings, bullet lists, tables                 |
| "Make a 5-slide pitch deck presentation"      | `.pptx` — cover slide, DSR master theme, speaker notes         |

Files are saved to your Desktop (or `WORKSPACE_DIR` env var) by default.

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
