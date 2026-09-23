import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }
  }

  return {
    default: MockStore,
  };
});

import { mcpConfigStore } from '../src/main/mcp/mcp-config-store';

describe('MCPConfigStore Office Tools defaults', () => {
  beforeEach(() => {
    mcpConfigStore.setServers([]);
  });

  it('includes Office Tools as an implicit enabled built-in server', () => {
    const servers = mcpConfigStore.getEnabledServers();
    const officeTools = servers.find((server) => server.name === 'Office_Tools');

    expect(officeTools).toBeDefined();
    expect(officeTools?.id).toBe('mcp-office-tools-builtin');
    expect(officeTools?.enabled).toBe(true);
    expect(officeTools?.command).toBe('node');
    expect(officeTools?.args?.[0]).toContain('office-tools-server');
    expect(officeTools?.args?.[0]).not.toBe('{OFFICE_TOOLS_SERVER_PATH}');
  });

  it('does not re-enable Office Tools when the user has an explicit disabled config', () => {
    mcpConfigStore.setServers([
      {
        id: 'office-disabled',
        name: 'Office_Tools',
        type: 'stdio',
        command: 'node',
        args: ['{OFFICE_TOOLS_SERVER_PATH}'],
        enabled: false,
      },
    ]);

    const servers = mcpConfigStore.getEnabledServers();
    expect(servers.find((server) => server.name === 'Office_Tools')).toBeUndefined();
  });

  it('includes Infra RCA as an implicit enabled built-in server', () => {
    const servers = mcpConfigStore.getEnabledServers();
    const infraRca = servers.find((server) => server.name === 'Infra_RCA');

    expect(infraRca).toBeDefined();
    expect(infraRca?.id).toBe('mcp-infra-rca-builtin');
    expect(infraRca?.enabled).toBe(true);
    expect(infraRca?.command).toBe('node');
    expect(infraRca?.args?.[0]).toContain('infra-rca-server');
    expect(infraRca?.args?.[0]).not.toBe('{INFRA_RCA_SERVER_PATH}');
  });

  it('shows the same implicit Infra connector in Settings that is enabled at runtime', () => {
    const shown = mcpConfigStore.getServersForSettings().find((s) => s.name === 'Infra_RCA');
    expect(shown).toEqual(mcpConfigStore.getEnabledServers().find((s) => s.name === 'Infra_RCA'));
    expect(mcpConfigStore.getServers()).toEqual([]);
  });

  it('keeps a disabled Infra configuration visible without creating a second enabled one', () => {
    const server = mcpConfigStore.createFromPreset('infra-rca', false)!;
    mcpConfigStore.saveServer(server);
    expect(mcpConfigStore.getServersForSettings().filter((s) => s.name === 'Infra_RCA')).toEqual([
      server,
    ]);
    expect(mcpConfigStore.getEnabledServers().some((s) => s.name === 'Infra_RCA')).toBe(false);
    mcpConfigStore.saveServer({ ...server, enabled: true });
    expect(mcpConfigStore.getEnabledServers().filter((s) => s.name === 'Infra_RCA')).toEqual([
      { ...server, enabled: true },
    ]);
  });

  it('includes Tableau as an implicit built-in MCP server', () => {
    const tableau = mcpConfigStore.getEnabledServers().find((server) => server.name === 'Tableau');
    expect(tableau).toBeDefined();
    expect(tableau?.id).toBe('mcp-tableau-builtin');
    expect(tableau?.enabled).toBe(true);
    expect(tableau?.args?.[0]).toContain('tableau-server');
    expect(tableau?.args?.[0]).not.toBe('{TABLEAU_SERVER_PATH}');
  });
});
