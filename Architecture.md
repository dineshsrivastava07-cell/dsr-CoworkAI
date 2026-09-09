# V-Coworker — Architecture

> **Developed by DSR AI Lab**

---

## System Overview

V-Coworker is a local-first, autonomous agentic desktop application built on Electron + React. By default, all LLM inference runs on-device via **Ollama + Gemma**, with no cloud API key required. Users can switch to **Gemini, OpenAI (ChatGPT), Anthropic, or OpenRouter** at any time from the chat header or Settings. The architecture is organized into three primary layers — the Electron main process (Node.js), the React renderer (UI), and the model-provider layer — with a permission/autonomy layer and a bundled MCP tool ecosystem sitting between the agent loop and everything it can act on.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph UI["Renderer Process (React + Vite)"]
        WV[WelcomeView]
        CV[ChatView + ModelSwitcher]
        SP[SettingsPanel]
        SB[Sidebar]
        RCP[RemoteControlPanel]
    end

    subgraph MAIN["Main Process (Electron / Node.js)"]
        IDX[index.ts — App Entry]
        AR[AgentRunner + Permission Hook]
        CS[ConfigStore\nautoApproveTools flag]
        MCP[MCP Manager\ntool-result truncation]
        SKL[Skills Registry]
        MEM[Memory Manager\nuntrusted-context guardrails]
        SBX[Sandbox Manager]
        REM[Remote Manager]
        SCH[Scheduler\nfast-deny for unattended runs]
    end

    subgraph PROVIDERS["Model Providers"]
        OLLAMA[Ollama Daemon\nlocalhost:11434]
        GEMMA[Gemma 4\n26b / e4b]
        GEMINI[Gemini API]
        OPENAI[OpenAI / ChatGPT API]
        ANTH[Anthropic API]
        OPENROUTER[OpenRouter API]
    end

    subgraph MCPSERVERS["Bundled MCP Servers"]
        CHROME[Chrome\nbrowser automation]
        GUIOP[GUI_Operate\ndesktop/app RPA]
        OFFICE[Office_Tools\nExcel/Word/PPT]
        GWORK[Google_Workspace\nGmail/Drive/Calendar]
        OCR[OCR_Tools\nTesseract]
        WEATHER[Weather_Tools\nOpen-Meteo]
    end

    subgraph EXT["External Integrations"]
        SLACK[Slack / other channels]
        NGROK[ngrok Tunnel]
        VNC[VNC Remote Desktop]
    end

    UI <-->|IPC / preload bridge| MAIN
    AR -->|OpenAI-compat API| OLLAMA
    OLLAMA --> GEMMA
    AR -->|API key or OAuth| GEMINI
    AR -->|API key| OPENAI
    AR -->|API key| ANTH
    AR -->|API key| OPENROUTER
    AR -->|tool calls, permission-gated| MCP
    MCP --> CHROME & GUIOP & OFFICE & GWORK & OCR & WEATHER
    AR -->|skill execution| SKL
    AR -->|read/write, no-fabrication guardrail| MEM
    AR -->|shell isolation| SBX
    REM --> SLACK
    REM --> NGROK
    REM --> VNC
    SCH -->|scheduled/reactive prompt| AR
```

---

## Authentication Flows

Model providers (Gemini, OpenAI, Anthropic, OpenRouter) are authenticated via a plain **API key**, entered once in Settings -> API and stored encrypted (electron-store). Ollama needs no authentication at all. The one real OAuth flow in the app is for **Google Workspace** (Gmail/Drive/Calendar), which is separate from model access:

```mermaid
sequenceDiagram
    actor User
    participant App as V-Coworker
    participant Broker as Bundled OAuth Token Broker
    participant Google as Google OAuth 2.0
    participant GW as Gmail / Drive / Calendar APIs

    User->>App: Settings -> Connectors -> Google Workspace -> Connect
    App->>Broker: Start local token-broker (transient port + secret)
    Broker->>Google: Open OAuth consent screen (browser)
    Google-->>Broker: Authorization code (redirect)
    Broker->>Google: Exchange code for access + refresh tokens
    Google-->>Broker: tokens
    Broker-->>App: tokens (never persisted in plaintext config)
    Note over App: Google_Workspace MCP server env receives\ntokens transiently at spawn time only

    User->>App: "Create morning brief from Gmail/Drive/Calendar"
    App->>GW: Gmail/Drive/Calendar API calls via Google_Workspace MCP server
    GW-->>App: Real data (messages, files, events)
    App-->>User: Synthesized result

    Note over App,Google: If the connection expires (Google's Testing-mode\n7-day limit) or a call fails, AgentRunner's circuit\nbreaker stops the turn and asks the user to reconnect\ninstead of fabricating a workaround.
```

---

## Agent Execution Flow

```mermaid
flowchart TD
    A([User sends prompt]) --> B[WelcomeView / ChatView]
    B --> C{Session exists?}
    C -- No --> D[Create new session\nsession-manager.ts]
    C -- Yes --> E[Resume session]
    D --> F[AgentRunner.run]
    E --> F

    F --> G{Provider?}
    G -- Ollama/Gemma --> H[POST localhost:11434/v1/chat/completions\ngemma4:26b or e4b]
    G -- Gemini/OpenAI/Anthropic/OpenRouter --> I[Provider API\nAPI key auth]

    H --> J[Stream response]
    I --> J

    J --> K{Tool call?}
    K -- Yes --> PERM{Permission check\ndecidePermission}
    PERM -- deny rule --> BLOCK[Block tool call\nreturn denial reason]
    PERM -- allow rule --> L
    PERM -- ask + Autonomous Mode off --> DLG[Show permission dialog\nwait up to 60s]
    PERM -- ask + Autonomous Mode on --> L
    DLG -- approved --> L[MCP Tool Dispatch]
    DLG -- denied / timed out --> BLOCK
    L --> TR[Truncate oversized results\n>20,000 chars capped]
    TR --> M[Execute tool\nbrowser/desktop/office/workspace/...]
    M --> J
    BLOCK --> J
    K -- No --> N[Render message\nMessageCard.tsx]

    N --> O{Memory?}
    O -- Yes --> P[Write to memory store\nbetter-sqlite3]
    O -- No --> Q([Done])
    P --> Q
```

---

## MCP Tool Flow

```mermaid
flowchart LR
    AR[AgentRunner] -->|tool_use block| MCPMgr[MCP Manager]
    MCPMgr --> Reg{Tool Registry}
    Reg --> FS[Built-in: read/write/edit/glob/grep/bash]
    Reg --> BR[Chrome\nbrowser automation]
    Reg --> RPA[GUI_Operate\ndesktop/app RPA, 19 tools]
    Reg --> OT[Office_Tools\ncreate_excel / create_word_document\ncreate_presentation]
    Reg --> GW[Google_Workspace\nGmail/Drive/Calendar]
    Reg --> OCR[OCR_Tools]
    Reg --> WX[Weather_Tools]
    Reg --> CUS[Optional presets:\nNotion, Software_Development,\nany custom MCP server]
    FS & BR & RPA & OT & GW & OCR & WX & CUS -->|result, truncated if >20,000 chars| MCPMgr
    MCPMgr -->|result| AR
```

---

## Office Document Generation Flow

```mermaid
flowchart TD
    U([User request]) --> AR[AgentRunner]
    AR -->|tool_use: create_excel\ncreate_word_document\ncreate_presentation| OTS[Office Tools MCP Server\noffice-tools-server.ts]

    OTS --> XL{Tool?}
    XL -- create_excel --> EXJ[ExcelJS\nWorkbook builder]
    XL -- create_word_document --> DCX[docx library\nDocument builder]
    XL -- create_presentation --> PPT[PptxGenJS\nPresentation builder]
    XL -- source_file set --> WBS[Workbook reader\nsource-driven WBS/roadmap]

    EXJ -->|styled headers, zebra rows, SUM totals,\nfrozen panes, live formula cells:\nNPV/IRR/STDEV/growth-rate/any formula| XLSX[.xlsx file]
    DCX -->|headings H1-H3, bullet/numbered lists,\ntables, page breaks - type inferred if omitted| DOCX[.docx file]
    PPT -->|title/content/two-column/table slides\n+ native bar/pie/line/doughnut charts| PPTX[.pptx file]
    WBS -->|WBS Summary, Detailed WBS,\nRoadmap Packs, Wave Summary| XLSX

    XLSX & DOCX & PPTX -->|saved to Desktop\nor WORKSPACE_DIR| FS[(Filesystem)]
    FS -->|file path returned| AR
    AR --> U
```

---

## macOS Native Addon Signing Flow

```mermaid
flowchart TD
    NI([npm install]) --> PI[postinstall hook]
    PI --> DLN[download-node.js]
    PI --> REB[npm rebuild\nbetter-sqlite3]
    PI --> SGN[sign-native.sh]

    SGN --> FIND[Find all .node addons\nin node_modules]
    FIND --> SIGN["usr/bin/codesign --sign - --entitlements electron-entitlements.plist"]
    SIGN --> ADDON1[better-sqlite3.node]
    SIGN --> ADDON2[clipboard.darwin-universal.node]
    SIGN --> ADDON3[keytar.node]
    SIGN --> ADDONN[... all .node files]

    SGN --> EAPP[Sign Electron.app\ninside-out order]
    EAPP --> DY[Dylibs & Frameworks]
    DY --> HLP[Helper apps\nEtEXT Renderer\nEtEXT GPU]
    HLP --> MAIN2[Electron.app main bundle]

    ADDON1 & ADDON2 & ADDON3 & ADDONN & MAIN2 -->|ad-hoc signed\nJIT + memory entitlements| OK([App launches on macOS 26 Tahoe])
```

---

## Sandbox Isolation

```mermaid
flowchart TD
    AR[AgentRunner] --> SBX{Sandbox enabled?}
    SBX -- macOS --> LIMA[Lima VM\n/Users shared]
    SBX -- Windows --> WSL[WSL2 instance]
    SBX -- Disabled --> HOST[Host process]
    LIMA --> EXEC[Execute shell commands]
    WSL --> EXEC
    HOST --> EXEC
    EXEC -->|stdout/stderr| AR
```

---

## Scheduled & Reactive Tasks

```mermaid
flowchart TD
    CRON[ScheduledTaskManager\ndaily/recurring or reactive watch-condition] -->|time or condition met| START[Start new session\nmarkSessionScheduled]
    START --> RUN[AgentRunner.run]
    RUN --> TOOL{Tool needs permission?}
    TOOL -- deny rule --> BLOCKED[Blocked]
    TOOL -- ask, no one to click --> FASTDENY[Fast-deny after 500ms\ninstead of the normal 60s wait]
    TOOL -- ask + Autonomous Mode on --> ALLOW[Auto-approved]
    TOOL -- allow rule --> ALLOW
    FASTDENY --> BLOCKED
    ALLOW --> EXEC[Execute tool]
    EXEC --> RUN
    BLOCKED --> RUN
    RUN --> DONE{Google Workspace tool failed\nwith reconnect-needed error?}
    DONE -- yes --> STOP[Stop turn, tell the user to\nreconnect - never fabricate a\nworkaround script instead]
    DONE -- no --> COMPLETE([Task completes normally])
```

Unattended/scheduled sessions previously stalled on the same 60-second permission-dialog timeout designed for interactive clicks — nobody was present to answer, so every gated tool call silently failed after a full minute. Scheduled sessions now fail fast (500ms) instead, and Autonomous Mode lets a user opt in to skip the wait entirely for a given workflow, without ever touching the separate `deny` path.

---

## Memory & Tool-Result Reliability Guardrails

Two related, previously-diagnosed failure modes and their fixes:

1. **Oversized tool results derailing the model.** A single MCP tool call (e.g. a full-page browser snapshot) could return 100,000+ characters of low-signal content in one turn. Landing that much noise right before the model's next decision reliably caused it to lose track of the actual task, regardless of which model or provider was used. `MCPManager.callTool()` now truncates any text block over 20,000 characters, generically, for every tool from every server — not special-cased to any one tool.
2. **Memory of past failures causing the model to skip trying.** If earlier sessions recorded a recurring task failing (e.g. an expired Google connection), the model would sometimes treat that history as still true and skip attempting the real tools this time — occasionally going as far as claiming to have completed an action it never took. The memory prompt now explicitly instructs the agent that past-failure entries are historical context only: it must still attempt the current request's real tools, and must never claim an action succeeded without actually invoking the corresponding tool and observing its result.

```mermaid
flowchart LR
    TOOLRES[Any MCP tool result] --> CHECK{Text block\n> 20,000 chars?}
    CHECK -- yes --> TRUNC[Truncate + append\ntruncation notice]
    CHECK -- no --> PASS[Pass through unchanged]
    TRUNC --> AGENT[Agent's next turn]
    PASS --> AGENT

    MEMCTX[Memory context injected\ninto prompt] --> GUARD["Guardrail: past failures ≠\ncurrent state. Attempt real\ntools. Never claim an\nuninvoked action succeeded."]
    GUARD --> AGENT
```

---

## Data & State

```mermaid
erDiagram
    CONFIG_SET {
        string id PK
        string name
        string provider
        string activeProfileKey
        bool enableThinking
    }
    PROVIDER_PROFILE {
        string key PK
        string apiKey
        string baseUrl
        string model
    }
    SESSION {
        string id PK
        string title
        string workingDir
        datetime createdAt
    }
    MEMORY_ENTRY {
        string id PK
        string sessionId FK
        string type
        text content
        datetime createdAt
    }
    SCHEDULED_TASK {
        string id PK
        string prompt
        string scheduleConfig
        bool enabled
        datetime nextRunAt
        datetime lastRunAt
        string lastRunSessionId FK
        string lastError
    }
    CONFIG_SET ||--o{ PROVIDER_PROFILE : "has profiles"
    SESSION ||--o{ MEMORY_ENTRY : "stores"
    SCHEDULED_TASK ||--o| SESSION : "starts"
```

---

## Technology Stack

| Layer                 | Technology                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| Desktop shell         | Electron 41                                                                |
| UI framework          | React 18 + Vite 7                                                          |
| Styling               | Tailwind CSS 3                                                             |
| State                 | Zustand                                                                    |
| Local LLM             | Ollama + Gemma 4 (26b / e4b)                                               |
| Cloud model providers | Gemini, OpenAI (ChatGPT), Anthropic, OpenRouter — API key auth             |
| Google Workspace auth | Bundled OAuth token broker (Gmail/Drive/Calendar only, not model access)   |
| IPC                   | Electron contextBridge (preload)                                           |
| Persistence           | electron-store (encrypted) + SQLite (better-sqlite3, WAL mode)             |
| MCP                   | @modelcontextprotocol/client + server                                      |
| Office — Excel        | ExcelJS 4.4 (incl. live formula cells)                                     |
| Office — Word         | docx 9.7                                                                   |
| Office — PowerPoint   | PptxGenJS 4.0 (incl. native charts)                                        |
| Desktop RPA           | GUI_Operate (custom, 19 tools: click/type/drag/scroll/vision/app-tracking) |
| Browser automation    | chrome-devtools-mcp                                                        |
| OCR                   | Tesseract (via OCR_Tools MCP server)                                       |
| Weather               | Open-Meteo (via Weather_Tools MCP server)                                  |
| Sandbox (macOS)       | Lima VM                                                                    |
| Sandbox (Windows)     | WSL2                                                                       |
| Remote                | Slack Bolt SDK (+ other channel adapters) + ngrok + VNC                    |
| Code signing          | /usr/bin/codesign (ad-hoc, entitlements plist)                             |
| Language              | TypeScript 5                                                               |

---

## Directory Map

```
src/
├── main/
│   ├── agent/          AgentRunner — streams LLM, dispatches tools,
│   │                   permission hook (Autonomous Mode aware)
│   ├── config/         ConfigStore, auth-utils (Ollama + Gemini/OpenAI/
│   │                   Anthropic/OpenRouter API keys)
│   ├── google/         Google Workspace OAuth token broker
│   ├── mcp/            MCP server lifecycle, tool registry
│   │   ├── mcp-manager.ts          Server lifecycle, tool dispatch,
│   │   │                           oversized-result truncation
│   │   ├── gui-operate-server.ts   Desktop/app RPA (19 tools)
│   │   ├── office-tools-server.ts  Excel/Word/PPT generation (3 tools,
│   │   │                           incl. live Excel formulas)
│   │   ├── google-workspace-server.ts  Gmail/Drive/Calendar
│   │   ├── ocr-tools-server.ts     Tesseract OCR
│   │   └── weather-tools-server.ts Open-Meteo weather
│   ├── memory/         SQLite-backed memory (short + long term),
│   │                   untrusted-context + no-fabrication guardrails
│   ├── remote/         Slack (+ other channels), ngrok tunnel, VNC config
│   ├── sandbox/        Lima agent (macOS), WSL agent (Windows)
│   ├── skills/         Skill protocol loader & executor
│   ├── schedule/       Scheduled + reactive watch-condition agent runs
│   └── tools/          Tool executor wrappers
├── renderer/
│   ├── components/     All React UI components, incl. ModelSwitcher
│   ├── store/          Zustand app state
│   ├── hooks/          Custom React hooks
│   └── i18n/           English locale (en.json)
└── shared/
    ├── ipc-types.ts    IPC channel type contracts
    └── api-model-presets.ts  Provider/model definitions

scripts/
├── bundle-mcp.js               esbuild bundles for MCP servers
├── sign-native.sh              Ad-hoc signing of .node addons (macOS 26)
└── electron-entitlements.plist JIT + memory entitlements for Electron
```

---

_V-Coworker — Developed by DSR AI Lab_
_github.com/dineshsrivastava07-cell/dsr-CoworkAI_
