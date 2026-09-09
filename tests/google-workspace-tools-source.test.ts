import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// google-workspace-server.ts calls serveStdio(...) unconditionally at module
// load (standalone MCP stdio server entry to), so it cannot be imported
// directly in a unit test without spinning up a real server process.
// Following the same convention as tests/ocr-weather-tools-source.test.ts,
// these tests assert on the source text itself.
const serverPath = path.resolve(process.cwd(), 'src/main/mcp/google-workspace-server.ts');
const serverContent = readFileSync(serverPath, 'utf8');

describe('Google Workspace MCP server', () => {
  it('exposes all six read-only tools', () => {
    expect(serverContent).toContain("name: 'gmail_list_messages'");
    expect(serverContent).toContain("name: 'gmail_get_message'");
    expect(serverContent).toContain("name: 'drive_list_files'");
    expect(serverContent).toContain("name: 'drive_read_file'");
    expect(serverContent).toContain("name: 'calendar_list_events'");
    expect(serverContent).toContain("name: 'google_connection_status'");
  });

  it('requires message_id for gmail_get_message and file_id for drive_read_file', () => {
    expect(serverContent).toContain("required: ['message_id']");
    expect(serverContent).toContain("required: ['file_id']");
  });

  it('fetches a live access token from the local token broker before every Google API call', () => {
    expect(serverContent).toContain('GOOGLE_TOKEN_BROKER_PORT');
    expect(serverContent).toContain('GOOGLE_TOKEN_BROKER_SECRET');
    expect(serverContent).toContain('/google/token`');
    expect(serverContent).toContain('Authorization: `Bearer ${secret}`');
  });

  it('retries exactly once on a raw 401 from a Google API by invalidating the broker cache', () => {
    const start = serverContent.indexOf('async function callGoogleApi(');
    expect(start).toBeGreaterThan(-1);
    const slice = serverContent.slice(start, start + 900);
    expect(slice).toContain('/google/token/invalidate');
    expect(slice).toContain('callGoogleApi(url, false)');
  });

  it('surfaces not-connected and reconnect-required as clear, actionable tool errors', () => {
    expect(serverContent).toContain('class NotConnectedError extends Error {}');
    expect(serverContent).toContain('class ReconnectRequiredError extends Error');
    expect(serverContent).toContain('Open Settings → Connectors → Google Workspace');
  });

  it('decodes Gmail message bodies as base64url, not plain base64', () => {
    expect(serverContent).toContain("Buffer.from(part.body.data, 'base64url')");
    expect(serverContent).toContain("Buffer.from(message.payload.body.data, 'base64url')");
  });

  it('lists Gmail attachments as metadata only and does not fetch attachment bytes', () => {
    expect(serverContent).toContain('Attachments (not fetched, metadata only)');
  });

  it('caps Gmail message-detail fan-out at a fixed concurrency instead of unbounded Promise.all', () => {
    expect(serverContent).toContain('GMAIL_CONCURRENCY');
    expect(serverContent).toContain('mapWithConcurrency(messages, GMAIL_CONCURRENCY');
  });

  it('branches drive_read_file by Google mimeType: Doc→markdown, Sheet→csv, Slides→text, PDF→pdf-parse', () => {
    const start = serverContent.indexOf('async function driveReadFile(');
    expect(start).toBeGreaterThan(-1);
    const slice = serverContent.slice(start, start + 2500);
    expect(slice).toContain('GOOGLE_DOC_MIME');
    expect(slice).toContain("exportDriveFile(args.file_id, 'text/markdown')");
    expect(slice).toContain('GOOGLE_SHEET_MIME');
    expect(slice).toContain("exportDriveFile(args.file_id, 'text/csv')");
    expect(slice).toContain('GOOGLE_SLIDES_MIME');
    expect(slice).toContain("exportDriveFile(args.file_id, 'text/plain')");
    expect(slice).toContain('PDF_MIME');
  });

  it('notes that Drive export only returns the first sheet, since the export endpoint has no gid parameter', () => {
    expect(serverContent).toContain('only the first sheet is exported');
  });

  it('caps PDF downloads at a fixed size before attempting extraction', () => {
    expect(serverContent).toContain('MAX_PDF_BYTES = 20 * 1024 * 1024');
    expect(serverContent).toContain('sizeBytes > MAX_PDF_BYTES');
  });

  it('dynamically imports pdf-parse rather than a static top-level import (bundling gotcha, see bundle-mcp.js)', () => {
    expect(serverContent).not.toMatch(/^import .*pdf-parse/m);
    expect(serverContent).toContain("await import('pdf-parse')");
  });

  it('expands recurring calendar events into individual instances', () => {
    expect(serverContent).toContain("url.searchParams.set('singleEvents', 'true')");
    expect(serverContent).toContain("url.searchParams.set('orderBy', 'startTime')");
  });

  it('defaults calendar_list_events to the primary calendar', () => {
    expect(serverContent).toContain("args.calendar_id?.trim() || 'primary'");
  });
});

describe('bundle-mcp.js registers google-workspace-server and externalizes pdf-parse', () => {
  const bundleScriptPath = path.resolve(process.cwd(), 'scripts/bundle-mcp.js');
  const bundleScriptContent = readFileSync(bundleScriptPath, 'utf8');

  it('includes a google-workspace-server entry', () => {
    expect(bundleScriptContent).toContain("name: 'google-workspace-server'");
    expect(bundleScriptContent).toContain("entry: 'google-workspace-server.ts'");
  });

  it('marks pdf-parse as extraExternals', () => {
    const entryStart = bundleScriptContent.indexOf("name: 'google-workspace-server'");
    expect(entryStart).toBeGreaterThan(-1);
    const slice = bundleScriptContent.slice(entryStart, entryStart + 500);
    expect(slice).toContain("extraExternals: ['pdf-parse']");
  });
});

describe('mcp-manager.ts registers Google_Workspace as a built-in server', () => {
  const mcpManagerPath = path.resolve(process.cwd(), 'src/main/mcp/mcp-manager.ts');
  const mcpManagerContent = readFileSync(mcpManagerPath, 'utf8');

  it('resolves the Google Workspace server file path', () => {
    expect(mcpManagerContent).toContain('getGoogleWorkspaceServerPath');
    expect(mcpManagerContent).toContain("this.getMcpServerPath('google-workspace-server.ts')");
  });

  it('resolves the {GOOGLE_WORKSPACE_SERVER_PATH} placeholder', () => {
    expect(mcpManagerContent).toContain("arg === '{GOOGLE_WORKSPACE_SERVER_PATH}'");
  });

  it('includes Google_Workspace in the built-in server allowlist', () => {
    const isBuiltinStart = mcpManagerContent.indexOf('const isBuiltinServer =');
    expect(isBuiltinStart).toBeGreaterThan(-1);
    const slice = mcpManagerContent.slice(isBuiltinStart, isBuiltinStart + 700);
    expect(slice).toContain("config.name === 'Google_Workspace'");
  });

  it('injects the token broker port/secret as env overrides, never a static credential', () => {
    expect(mcpManagerContent).toContain('getGoogleWorkspaceEnvOverrides');
    expect(mcpManagerContent).toContain('GOOGLE_TOKEN_BROKER_PORT: String(info.port)');
    expect(mcpManagerContent).toContain('GOOGLE_TOKEN_BROKER_SECRET: info.secret');
  });

  it('redacts the broker secret in the auth env summary log (never logs the raw value)', () => {
    const logStart = mcpManagerContent.indexOf("log('[MCPManager] Server auth env summary'");
    expect(logStart).toBeGreaterThan(-1);
    const slice = mcpManagerContent.slice(logStart, logStart + 700);
    expect(slice).toContain(
      "GOOGLE_TOKEN_BROKER_SECRET: env.GOOGLE_TOKEN_BROKER_SECRET?.trim() ? 'set' : 'unset'"
    );
  });
});

describe('mcp-config-store.ts has a google-workspace preset', () => {
  const configStorePath = path.resolve(process.cwd(), 'src/main/mcp/mcp-config-store.ts');
  const configStoreContent = readFileSync(configStorePath, 'utf8');

  it('defines the preset with the correct server name and no static credentials', () => {
    const presetStart = configStoreContent.indexOf("'google-workspace': {");
    expect(presetStart).toBeGreaterThan(-1);
    const slice = configStoreContent.slice(presetStart, presetStart + 400);
    expect(slice).toContain("name: 'Google_Workspace'");
    expect(slice).toContain("args: ['{GOOGLE_WORKSPACE_SERVER_PATH}']");
  });

  it('resolves the {GOOGLE_WORKSPACE_SERVER_PATH} placeholder in createFromPreset', () => {
    expect(configStoreContent).toContain('getGoogleWorkspaceServerPath');
    expect(configStoreContent).toContain("arg === '{GOOGLE_WORKSPACE_SERVER_PATH}'");
  });
});
