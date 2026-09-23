import * as http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'stdio-broker-secret';
let broker: http.Server;
let brokerPort: number;
let bundlePath: string;
let tempRoot: string;
const requests: Array<{ method?: string; url?: string; authorization?: string }> = [];

function json(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tableau-mcp-e2e-'));
  bundlePath = path.join(tempRoot, 'tableau-server.js');
  await build({
    bundle: true,
    entryPoints: [path.resolve(process.cwd(), 'src/main/mcp/tableau-server.ts')],
    format: 'cjs',
    outfile: bundlePath,
    platform: 'node',
    target: 'node20',
  });

  broker = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/tableau/status') {
      json(res, { configured: true, reachable: true, authenticated: true, checkedAt: 1 });
    } else if (url.pathname === '/tableau/views') {
      json(res, { views: [{ id: 'view-1', name: 'Live Sales' }] });
    } else if (url.pathname === '/tableau/view-data') {
      json(res, {
        view: { id: url.searchParams.get('view_id'), name: 'Live Sales' },
        columns: ['Net Sales'],
        rows: [{ 'Net Sales': '100' }],
        totalRows: 1,
        truncated: false,
        requestedRows: Number(url.searchParams.get('max_rows')),
      });
    } else if (url.pathname === '/tableau/summary') {
      json(res, { summary: { role: url.searchParams.get('role'), status: 'ready' } });
    } else if (url.pathname === '/tableau/refresh' && req.method === 'POST') {
      json(res, { summaries: { retail: { status: 'ready' } } });
    } else if (url.pathname === '/tableau/analyze' && req.method === 'POST') {
      json(res, {
        selectedViews: [{ id: 'view-1', name: 'Live Sales' }],
        dimensionCoverage: [{ level: 'state', available: true }],
        datasets: [
          {
            view: { id: 'view-1', name: 'Live Sales' },
            columns: ['Store Name', 'Net Sales'],
            rows: Array.from({ length: 120 }, (_, index) => ({
              'Store Name': `Store ${index + 1}`,
              'Net Sales': String((index + 1) * 100),
            })),
            totalRows: 120,
            truncated: false,
          },
        ],
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    broker.once('error', reject);
    broker.listen(0, '127.0.0.1', () => resolve());
  });
  brokerPort = (broker.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => broker.close(() => resolve()));
  fs.rmSync(tempRoot, { force: true, recursive: true });
});

function parseTextResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const text = result.content.find((item) => item.type === 'text');
  if (!text || text.type !== 'text') throw new Error('MCP tool did not return text');
  return JSON.parse(text.text);
}

describe('Tableau MCP stdio to broker round-trip', () => {
  it('discovers and executes all six read-only Tableau tools over real stdio', async () => {
    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
    const client = new Client({ name: 'tableau-e2e-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundlePath],
      env: {
        ...inheritedEnvironment,
        TABLEAU_BROKER_PORT: String(brokerPort),
        TABLEAU_BROKER_SECRET: SECRET,
      },
      stderr: 'pipe',
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'tableau_analyze_question',
        'tableau_connection_status',
        'tableau_list_views',
        'tableau_get_view_data',
        'tableau_get_role_summary',
        'tableau_refresh_role_summaries',
      ]);

      const analysis = parseTextResult(
        await client.callTool({
          name: 'tableau_analyze_question',
          arguments: { question: 'Compare store sales by state and region' },
        })
      ) as {
        datasets: Array<{
          rows: unknown[];
          analysisRowsLoaded: number;
          modelRowsReturned: number;
          modelSampleTruncated: boolean;
        }>;
        modelPacket: { rowsPerViewLimit: number };
      };
      expect(analysis).toMatchObject({
        selectedViews: [{ id: 'view-1' }],
        dimensionCoverage: [{ level: 'state', available: true }],
      });
      expect(analysis.datasets[0]).toMatchObject({
        analysisRowsLoaded: 120,
        modelRowsReturned: 60,
        modelSampleTruncated: true,
      });
      expect(analysis.datasets[0].rows).toHaveLength(60);
      expect(analysis.modelPacket.rowsPerViewLimit).toBe(60);

      expect(
        parseTextResult(await client.callTool({ name: 'tableau_connection_status' }))
      ).toMatchObject({ authenticated: true });
      expect(parseTextResult(await client.callTool({ name: 'tableau_list_views' }))).toMatchObject({
        views: [{ id: 'view-1' }],
      });
      expect(
        parseTextResult(
          await client.callTool({
            name: 'tableau_get_view_data',
            arguments: { view_id: 'view-1', max_rows: 25 },
          })
        )
      ).toMatchObject({ requestedRows: 25, rows: [{ 'Net Sales': '100' }] });
      expect(
        parseTextResult(
          await client.callTool({
            name: 'tableau_get_role_summary',
            arguments: { role: 'retail' },
          })
        )
      ).toMatchObject({ summary: { role: 'retail', status: 'ready' } });
      expect(
        parseTextResult(await client.callTool({ name: 'tableau_refresh_role_summaries' }))
      ).toMatchObject({ summaries: { retail: { status: 'ready' } } });
    } finally {
      await client.close();
    }

    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.authorization === `Bearer ${SECRET}`)).toBe(true);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/tableau/refresh' });
  });
});
