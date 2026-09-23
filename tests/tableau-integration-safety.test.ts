import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mcpSource = readFileSync(
  path.resolve(process.cwd(), 'src/main/mcp/tableau-server.ts'),
  'utf8'
);
const brokerSource = readFileSync(
  path.resolve(process.cwd(), 'src/main/tableau/tableau-broker.ts'),
  'utf8'
);
const mainSource = readFileSync(path.resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
const preloadSource = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8');

describe('Tableau MCP security boundaries', () => {
  it('keeps Tableau credentials out of MCP tool inputs and uses only the loopback broker', () => {
    expect(mcpSource).toContain('TABLEAU_BROKER_PORT');
    expect(mcpSource).toContain('TABLEAU_BROKER_SECRET');
    expect(mcpSource).not.toContain("name: 'password'");
    expect(mcpSource).not.toContain("name: 'username'");
    expect(mcpSource).toContain('http://127.0.0.1:');
  });

  it('protects every broker route with an ephemeral bearer secret', () => {
    expect(brokerSource).toContain('randomBytes(32)');
    expect(brokerSource).toContain('if (!isAuthorized(req, secret))');
    expect(brokerSource).toContain("json(res, 401, { error: 'unauthorized' })");
  });

  it('exposes analysis tools only and no workbook mutation tools', () => {
    expect(mcpSource).toContain("name: 'tableau_get_view_data'");
    expect(mcpSource).toContain("name: 'tableau_get_role_summary'");
    expect(mcpSource).not.toMatch(/tableau_(create|update|delete|publish)_/);
  });

  it('wires bounded multi-dashboard data through main-process IPC and the preload bridge', () => {
    expect(mainSource).toContain("ipcMain.handle('tableau.getViewsData'");
    expect(mainSource).toContain('tableauService.getViewsData');
    expect(preloadSource).toContain("ipcRenderer.invoke('tableau.getViewsData'");
  });
});
