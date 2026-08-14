/**
 * Default global core memory, shown when no core-memory file exists yet
 * (first run). Used as the fallback value passed to loadJsonFile() in
 * CoreMemoryStore, so it's what the agent starts with — not something
 * written to disk — and is fully replaced the moment the user saves any
 * real core memory (including an explicit "Clear core memory").
 *
 * Keys use the `skills.<name>` combined-key format (see parseCoreCombinedKey
 * in memory-utils.ts) so they surface under the "skills" category and are
 * rendered into the agent's system prompt via coreMemoryToPromptBlock().
 */
export const DEFAULT_CORE_MEMORY_SEED: Record<string, string> = {
  'skills.office_documents':
    'Can generate Excel (.xlsx), Word (.docx), and PowerPoint (.pptx) files with AI-drafted content via local Ollama models, including native charts and data-bar visuals, not just static templates.',
  'skills.desktop_automation':
    'Can control the desktop directly (click, type, drag, scroll, screenshot) across macOS and Windows via the GUI Operate tool, with built-in safety checks: post-action verification, confirmation before irreversible actions, and an app denylist.',
  'skills.local_first_ai':
    'Runs primarily on local Ollama models (e.g. gemma4) for privacy and offline use, with cloud providers available as an alternative.',
  'skills.mcp_tooling':
    'Connects to Model Context Protocol (MCP) servers for extensible tool access (filesystem, browser, GitHub, and custom servers) and can be extended with new MCP integrations.',
  'skills.scheduling':
    'Can run one-time, daily, weekly, and recurring scheduled tasks, plus reactive watch tasks that only trigger when a monitored HTTP endpoint or command output actually changes.',
  'skills.sandboxed_execution':
    'Can execute shell commands in an isolated sandbox (Lima VM on macOS, WSL2 on Windows) to contain the blast radius of agent actions.',
  'skills.remote_control':
    'Can be operated remotely via Slack and other remote-control channels, not just the desktop app.',
  'skills.memory':
    'Maintains long-term core memory (durable facts and preferences) and per-workspace experience memory (session summaries and decisions) to stay consistent across sessions.',
};
