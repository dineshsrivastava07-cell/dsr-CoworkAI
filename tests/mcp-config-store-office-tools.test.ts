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

    expect(mcpConfigStore.getEnabledServers()).toEqual([]);
  });
});
