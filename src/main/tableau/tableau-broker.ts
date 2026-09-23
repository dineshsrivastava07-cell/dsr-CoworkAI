import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import { log, logError } from '../utils/logger';
import { tableauService } from './tableau-service';
import type { TableauRole } from '../../shared/tableau-types';

interface BrokerState {
  server: http.Server;
  port: number;
  secret: string;
}

let brokerState: BrokerState | null = null;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function isAuthorized(req: http.IncomingMessage, secret: string): boolean {
  return req.headers.authorization === `Bearer ${secret}`;
}

function roleFrom(value: string | null): TableauRole | null {
  return value === 'retail' || value === 'merchandiser' || value === 'planner' ? value : null;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error('Request body exceeds the 64 KB limit.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function createTableauBrokerRequestHandler(
  secret: string
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      if (!isAuthorized(req, secret)) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/tableau/status') {
        json(res, 200, await tableauService.getConnectionStatus());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tableau/views') {
        json(res, 200, { views: await tableauService.listViews() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tableau/view-data') {
        const viewId = url.searchParams.get('view_id')?.trim();
        if (!viewId) {
          json(res, 400, { error: 'view_id is required' });
          return;
        }
        const maxRows = Number(url.searchParams.get('max_rows') || '200');
        if (!Number.isFinite(maxRows) || maxRows < 1 || maxRows > 2_000) {
          json(res, 400, { error: 'max_rows must be a number from 1 to 2000' });
          return;
        }
        json(res, 200, await tableauService.getViewData(viewId, maxRows));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tableau/summary') {
        const role = roleFrom(url.searchParams.get('role'));
        if (!role) {
          json(res, 400, { error: 'role must be retail, merchandiser, or planner' });
          return;
        }
        const state = await tableauService.getDashboardState(false);
        json(res, 200, { connection: state.connection, summary: state.summaries[role] });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/tableau/refresh') {
        json(res, 200, { summaries: await tableauService.refreshSummaries() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/tableau/analyze') {
        const body = await readJsonBody(req);
        if (typeof body.question !== 'string' || !body.question.trim()) {
          json(res, 400, { error: 'question is required' });
          return;
        }
        const role = typeof body.role === 'string' ? roleFrom(body.role) || undefined : undefined;
        const domain = typeof body.domain === 'string' ? body.domain : undefined;
        const maxRows = typeof body.max_rows === 'number' ? body.max_rows : undefined;
        json(
          res,
          200,
          await tableauService.analyzeQuestion({
            question: body.question,
            role,
            domain,
            maxRows,
          })
        );
        return;
      }
      json(res, 404, { error: 'not_found' });
    })().catch((error) => {
      logError('[TableauBroker] Request failed:', error);
      if (!res.headersSent) {
        json(res, 502, {
          error: error instanceof Error ? error.message : 'Tableau request failed',
        });
      }
    });
  };
}

export async function startTableauBroker(): Promise<{ port: number }> {
  if (brokerState) return { port: brokerState.port };
  const secret = randomBytes(32).toString('hex');
  const server = http.createServer(createTableauBrokerRequestHandler(secret));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine Tableau broker address.');
  }
  const port = (address as AddressInfo).port;
  brokerState = { server, port, secret };
  server.unref();
  log(`[TableauBroker] Listening on http://127.0.0.1:${port}`);
  return { port };
}

export function getTableauBrokerConnectionInfo(): { port: number; secret: string } | null {
  return brokerState ? { port: brokerState.port, secret: brokerState.secret } : null;
}

export async function stopTableauBroker(): Promise<void> {
  if (!brokerState) return;
  const { server } = brokerState;
  brokerState = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
