import Store, { type Options as StoreOptions } from 'electron-store';
import { app } from 'electron';
import * as fs from 'fs';
import * as crypto from 'crypto';
import path from 'path';
import type { MCPServerConfig } from './mcp-manager';
import { log, logError } from '../utils/logger';

/**
 * Preset MCP Server Configurations
 * These are common MCP servers that users can quickly add
 */
export const MCP_SERVER_PRESETS: Record<
  string,
  Omit<MCPServerConfig, 'id' | 'enabled'> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
> = {
  chrome: {
    name: 'Chrome',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url', 'http://localhost:9222'],
  },
  notion: {
    name: 'Notion',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      NOTION_TOKEN: '',
    },
    requiresEnv: ['NOTION_TOKEN'],
    envDescription: {
      NOTION_TOKEN: 'Notion Internal Integration Token (get from notion.so/profile/integrations)',
    },
  },
  'software-development': {
    name: 'Software_Development',
    type: 'stdio',
    command: 'node',
    args: ['{SOFTWARE_DEV_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {
      WORKSPACE_DIR: '',
      TEST_ENV: 'development',
    },
    requiresEnv: [],
    envDescription: {
      WORKSPACE_DIR: 'Workspace directory for code development (optional)',
      TEST_ENV: 'Test environment: development, staging, or production (optional)',
    },
  },
  'gui-operate': {
    name: 'GUI_Operate',
    type: 'stdio',
    command: 'node',
    args: ['{GUI_OPERATE_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required
    },
  },
  'office-tools': {
    name: 'Office_Tools',
    type: 'stdio',
    command: 'node',
    args: ['{OFFICE_TOOLS_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required
    },
  },
  'google-workspace': {
    name: 'Google_Workspace',
    type: 'stdio',
    command: 'node',
    args: ['{GOOGLE_WORKSPACE_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required — token broker port/secret are
      // injected transiently at spawn time by mcp-manager.ts, never persisted here.
    },
  },
  'infra-rca': {
    name: 'Infra_RCA',
    type: 'stdio',
    command: 'node',
    args: ['{INFRA_RCA_SERVER_PATH}'], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required — broker port/secret are injected
      // transiently at spawn time by mcp-manager.ts, never persisted here.
      // Target credentials live in infra-rca-store.ts, resolved on demand via
      // infra-rca-broker.ts — never passed to this server as env or config.
    },
  },
};

function isOfficeToolsServerName(name: string): boolean {
  return name === 'Office_Tools' || name === 'Office Tools';
}

/**
 * MCP Server Configuration Store
 */
class MCPConfigStore {
  private store: Store<{ servers: MCPServerConfig[] }>;

  constructor() {
    const storeOptions: StoreOptions<{ servers: MCPServerConfig[] }> & { projectName?: string } = {
      name: 'mcp-config',
      projectName: 'open-cowork',
      defaults: {
        servers: [],
      },
    };

    this.store = new Store<{ servers: MCPServerConfig[] }>(storeOptions);
  }

  /**
   * Get all MCP server configurations
   */
  getServers(): MCPServerConfig[] {
    return this.store.get('servers', []);
  }

  /**
   * Get a specific server configuration
   */
  getServer(serverId: string): MCPServerConfig | undefined {
    const servers = this.getServers();
    return servers.find((s) => s.id === serverId);
  }

  /**
   * Add or update a server configuration
   */
  saveServer(config: MCPServerConfig): void {
    const servers = this.getServers();
    const index = servers.findIndex((s) => s.id === config.id);

    if (index >= 0) {
      servers[index] = config;
    } else {
      servers.push(config);
    }

    this.store.set('servers', servers);
  }

  /**
   * Delete a server configuration
   */
  deleteServer(serverId: string): void {
    const servers = this.getServers();
    const filtered = servers.filter((s) => s.id !== serverId);
    this.store.set('servers', filtered);
  }

  /**
   * Update all server configurations
   */
  setServers(servers: MCPServerConfig[]): void {
    this.store.set('servers', servers);
  }

  /**
   * Get enabled servers only
   */
  getEnabledServers(): MCPServerConfig[] {
    const servers = this.getServers();
    const enabledServers = servers.filter((s) => s.enabled);
    const hasOfficeToolsConfig = servers.some((server) => isOfficeToolsServerName(server.name));

    if (!hasOfficeToolsConfig) {
      enabledServers.push(this.createBuiltinOfficeToolsConfig());
    }

    const hasInfraRcaConfig = servers.some((server) => server.name === 'Infra_RCA');
    if (!hasInfraRcaConfig) {
      enabledServers.push(this.createBuiltinInfraRcaConfig());
    }

    return enabledServers;
  }

  /**
   * Get preset configurations
   */
  getPresets(): Record<string, Omit<MCPServerConfig, 'id' | 'enabled'>> {
    return MCP_SERVER_PRESETS;
  }

  /**
   * Get the path to a MCP server file in the mcp directory
   */
  private getMcpServerPath(filename: string): string | null {
    // In development: __dirname points to dist-electron/main
    // In production: appPath points to the app.asar or unpacked app
    if (app.isPackaged) {
      // Production: use compiled JavaScript files from extraResources/mcp
      // Convert .ts extension to .js
      const jsFilename = filename.replace(/\.ts$/, '.js');
      const mcpPath = path.join(process.resourcesPath || '', 'mcp', jsFilename);

      // Check if compiled JS file exists in resources
      try {
        if (fs.existsSync(mcpPath)) {
          return mcpPath;
        }
      } catch {
        // Fall through to development path
      }
    }

    // Vitest can import this TypeScript module directly, where __dirname is already
    // src/main/mcp rather than dist-electron/main.
    const sameDirSourcePath = path.join(__dirname, filename);
    try {
      if (fs.existsSync(sameDirSourcePath)) {
        log(`[MCPConfigStore] MCP Server path resolved (${filename}):`, sameDirSourcePath);
        return sameDirSourcePath;
      }
    } catch {
      // Fall through to dist-electron-style development path.
    }

    // Development: __dirname is dist-electron/main
    // Need to go up 2 levels to get to project root (dist-electron/main -> dist-electron -> project root)
    const projectRoot = path.join(__dirname, '..', '..');

    // Prefer bundled JS from dist-mcp in development.
    // This avoids attempting to run TypeScript directly with `node`.
    const jsFilename = filename.replace(/\.ts$/, '.js');
    const devBundledPath = path.join(projectRoot, 'dist-mcp', jsFilename);
    try {
      if (fs.existsSync(devBundledPath)) {
        return devBundledPath;
      }
    } catch {
      // Fall through to source path
    }

    // Fallback: navigate to src/main/mcp/[filename]
    const sourcePath = path.join(projectRoot, 'src', 'main', 'mcp', filename);

    // Verify file exists and log for debugging
    try {
      if (fs.existsSync(sourcePath)) {
        log(`[MCPConfigStore] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      } else {
        logError(`[MCPConfigStore] File not found at:`, sourcePath);
        logError('[MCPConfigStore] __dirname:', __dirname);
        logError('[MCPConfigStore] projectRoot:', projectRoot);
      }
    } catch (error) {
      logError('[MCPConfigStore] Error checking file:', error);
    }

    return null;
  }

  /**
   * Get the path to the Software Development MCP server file
   */
  private getSoftwareDevServerPath(): string | null {
    return this.getMcpServerPath('software-dev-server-example.ts');
  }

  /**
   * Get the path to the GUI Operate MCP server file
   */
  private getGuiOperateServerPath(): string | null {
    return this.getMcpServerPath('gui-operate-server.ts');
  }

  /**
   * Get the path to the Office Tools MCP server file
   */
  private getOfficeToolsServerPath(): string | null {
    return this.getMcpServerPath('office-tools-server.ts');
  }

  /**
   * Get the path to the Google Workspace MCP server file
   */
  private getGoogleWorkspaceServerPath(): string | null {
    return this.getMcpServerPath('google-workspace-server.ts');
  }

  /**
   * Get the path to the Infra RCA MCP server file
   */
  private getInfraRcaServerPath(): string | null {
    return this.getMcpServerPath('infra-rca-server.ts');
  }

  private createBuiltinOfficeToolsConfig(): MCPServerConfig {
    const preset = MCP_SERVER_PRESETS['office-tools'];
    return {
      ...preset,
      args: preset.args?.map((arg) =>
        arg === '{OFFICE_TOOLS_SERVER_PATH}' ? this.getOfficeToolsServerPath() || arg : arg
      ),
      id: 'mcp-office-tools-builtin',
      enabled: true,
    };
  }

  private createBuiltinInfraRcaConfig(): MCPServerConfig {
    const preset = MCP_SERVER_PRESETS['infra-rca'];
    return {
      ...preset,
      args: preset.args?.map((arg) =>
        arg === '{INFRA_RCA_SERVER_PATH}' ? this.getInfraRcaServerPath() || arg : arg
      ),
      id: 'mcp-infra-rca-builtin',
      enabled: true,
    };
  }

  /**
   * Create a server config from a preset
   */
  createFromPreset(presetKey: string, enabled: boolean = false): MCPServerConfig | null {
    const preset = MCP_SERVER_PRESETS[presetKey];
    if (!preset) {
      return null;
    }

    // Resolve path placeholders for presets
    let resolvedPreset = { ...preset };

    if (preset.args) {
      resolvedPreset = {
        ...preset,
        args: preset.args.map((arg) => {
          // Software Development server path
          if (arg === '{SOFTWARE_DEV_SERVER_PATH}') {
            return this.getSoftwareDevServerPath() || arg;
          }
          // GUI Operate server path
          if (arg === '{GUI_OPERATE_SERVER_PATH}') {
            return this.getGuiOperateServerPath() || arg;
          }
          if (arg === '{OFFICE_TOOLS_SERVER_PATH}') {
            return this.getOfficeToolsServerPath() || arg;
          }
          if (arg === '{GOOGLE_WORKSPACE_SERVER_PATH}') {
            return this.getGoogleWorkspaceServerPath() || arg;
          }
          if (arg === '{INFRA_RCA_SERVER_PATH}') {
            return this.getInfraRcaServerPath() || arg;
          }
          return arg;
        }),
      };
    }

    return {
      ...resolvedPreset,
      id: `mcp-${presetKey}-${crypto.randomUUID()}`,
      enabled,
    };
  }
}

// Singleton instance
export const mcpConfigStore = new MCPConfigStore();
