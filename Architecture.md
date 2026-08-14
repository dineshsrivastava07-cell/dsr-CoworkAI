# V-Coworker — Architecture

> **Developed by DSR AI Lab**

---

## System Overview

V-Coworker is a local-shell AI agent desktop application built on Electron + React. All LLM inference runs on-device via **Ollama + Gemma**. Authentication uses **Gemini OAuth** (Google). The architecture is organized into three primary layers: the Electron main process (Node.js), the React renderer (UI), and the local AI infrastructure.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph UI["Renderer Process (React + Vite)"]
        WV[WelcomeView]
        CV[ChatView]
        SP[SettingsPanel]
        SB[Sidebar]
        RCP[RemoteControlPanel]
    end

    subgraph MAIN["Main Process (Electron / Node.js)"]
        IDX[index.ts — App Entry]
        AR[AgentRunner]
        CS[ConfigStore]
        MCP[MCP Manager]
        SKL[Skills Registry]
        MEM[Memory Manager]
        SBX[Sandbox Manager]
        REM[Remote Manager]
        SCH[Scheduler]
    end

    subgraph LOCAL["Local AI Stack"]
        OLLAMA[Ollama Daemon\nlocalhost:11434]
        GEMMA[Gemma 4\n27b / e4b]
    end

    subgraph AUTH["Authentication"]
        GOAUTH[Gemini OAuth\nGoogle Identity]
        GAPI[Gemini API\nCloud fallback]
    end

    subgraph EXT["External Integrations"]
        SLACK[Slack Bot]
        NGROK[ngrok Tunnel]
    end

    UI <-->|IPC / preload bridge| MAIN
    AR -->|OpenAI-compat API| OLLAMA
    OLLAMA --> GEMMA
    CS -->|OAuth token| GOAUTH
    GOAUTH -->|access token| GAPI
    AR -->|tool calls| MCP
    AR -->|skill execution| SKL
    AR -->|read/write| MEM
    AR -->|shell isolation| SBX
    REM --> SLACK
    REM --> NGROK
    SCH --> AR
```

---

## Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant App as V-Coworker
    participant OS as macOS Keychain
    participant Google as Google OAuth 2.0
    participant Gemini as Gemini API

    User->>App: Click "Sign in with Google"
    App->>Google: Open OAuth consent screen (browser)
    Google-->>App: Authorization code (redirect)
    App->>Google: Exchange code for access + refresh tokens
    Google-->>App: tokens
    App->>OS: Store tokens securely (electron-store encrypted)
    Note over App: Provider = gemini, token stored

    User->>App: Send prompt
    App->>OS: Read token
    App->>Gemini: API request with Bearer token
    Gemini-->>App: Response
    App-->>User: Display output
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
    G -- Ollama/Gemma --> H[POST localhost:11434/v1/chat/completions\ngemma4:27b]
    G -- Gemini OAuth --> I[Gemini API\nBearer token]

    H --> J[Stream response]
    I --> J

    J --> K{Tool call?}
    K -- Yes --> L[MCP Tool Dispatch]
    L --> M[Execute tool\nfile/shell/browser]
    M --> J
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
    Reg --> FS[Filesystem tools]
    Reg --> SH[Shell / Bash]
    Reg --> BR[Browser / Puppeteer]
    Reg --> GH[GitHub MCP]
    Reg --> OT[Office Tools MCP\ncreate_excel\ncreate_word_document\ncreate_presentation]
    Reg --> CUS[Custom MCP servers]
    FS & SH & BR & GH & OT & CUS -->|result| AR
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

    EXJ -->|styled headers\nzebra rows\nSUM totals\nfrozen panes| XLSX[.xlsx file]
    DCX -->|headings H1-H3\nbullet lists\ntables\npage breaks| DOCX[.docx file]
    PPT -->|cover slide\nDSR master theme\nspeaker notes| PPTX[.pptx file]

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

    S001 --> FIND[Find all .node addons\nin node_modules]
    FIND --> SIGN[/usr/bin/codesign\n--sign - \n--entitlements electron-entitlements.plist]
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
    CONFIG_SET ||--o{ PROVIDER_PROFILE : "has profiles"
    SESSION ||--o{ MEMORY_ENTRY : "stores"
```

---

## Technology Stack

| Layer               | Technology                                           |
| ------------------- | ---------------------------------------------------- |
| Desktop shell       | Electron 41                                          |
| UI framework        | React 18 + Vite 7                                    |
| Styling             | Tailwind CSS 3                                       |
| State               | Zustand                                              |
| Local LLM           | Ollama + Gemma 4 (27b / e4b)                         |
| Auth                | Gemini OAuth (Google Identity)                       |
| IPC                 | Electron contextBridge (preload)                     |
| Persistence         | electron-store (encrypted) + SQLite (better-sqlite3) |
| MCP                 | @modelcontextprotocol/client + server                |
| Office — Excel      | ExcelJS 4.4                                          |
| Office — Word       | docx 9.7                                             |
| Office — PowerPoint | PptxGenJS 4.0                                        |
| Sandbox (macOS)     | Lima VM                                              |
| Sandbox (Windows)   | WSL2                                                 |
| Remote              | Slack Bolt SDK + ngrok                               |
| Code signing        | /usr/bin/codesign (ad-hoc, entitlements plist)       |
| Language            | TypeScript 5                                         |

---

## Directory Map

```
src/
├── main/
│   ├── agent/          AgentRunner — streams LLM, dispatches tools
│   ├── config/         ConfigStore, auth-utils (Ollama + Gemini OAuth)
│   ├── mcp/            MCP server lifecycle, tool registry
│   │   ├── mcp-manager.ts          Server lifecycle + tool dispatch
│   │   ├── gui-operate-server.ts   GUI automation (29 tools)
│   │   └── office-tools-server.ts  Office doc generation (3 tools)
│   ├── memory/         SQLite-backed memory (short + long term)
│   ├── remote/         Slack channel, ngrok tunnel
│   ├── sandbox/        Lima agent (macOS), WSL agent (Windows)
│   ├── skills/         Skill protocol loader & executor
│   ├── schedule/       Cron-based scheduled agent runs
│   └── tools/          Tool executor wrappers
├── renderer/
│   ├── components/     All React UI components
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
