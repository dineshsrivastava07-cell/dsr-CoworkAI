/**
 * Loopback HTTP broker that hands the infra-rca-server stdio MCP child
 * process a target's real credentials on demand, by name only. Modeled
 * directly on google-token-broker.ts: the MCP server is a bare Node child
 * process with no Electron access, so it cannot own the encrypted
 * infra-rca-store.ts file itself — this broker (running in the main
 * process, which does own the store) is the only thing it talks to.
 * Ephemeral port + a random bearer secret generated fresh each app launch,
 * passed to the child only via env var — secrets never appear in any MCP
 * tool's input/output schema or in the model's context.
 */
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { log, logError } from '../utils/logger';
import { infraRcaStore } from './infra-rca-store';

interface BrokerState {
  server: http.Server;
  port: number;
  secret: string;
}

let brokerState: BrokerState | null = null;

function json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isAuthorized(req: http.IncomingMessage, secret: string): boolean {
  const header = req.headers.authorization;
  return header === `Bearer ${secret}`;
}

export function createInfraRcaBrokerRequestHandler(
  secret: string
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    try {
      if (!isAuthorized(req, secret)) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/infra-rca/targets') {
        json(res, 200, { targets: infraRcaStore.listTargets() });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/infra-rca/target') {
        const name = url.searchParams.get('name');
        if (!name) {
          json(res, 400, { error: 'missing_name' });
          return;
        }
        const target = infraRcaStore.getTargetByName(name);
        if (!target) {
          json(res, 404, { error: 'target_not_found' });
          return;
        }
        json(res, 200, { target });
        return;
      }

      json(res, 404, { error: 'not_found' });
    } catch (error) {
      logError('[InfraRcaBroker] Unexpected error:', error);
      if (!res.headersSent) {
        json(res, 500, { error: 'internal_error' });
      }
    }
  };
}

export async function startInfraRcaBroker(): Promise<{ port: number }> {
  if (brokerState) {
    return { port: brokerState.port };
  }

  const secret = randomBytes(32).toString('hex');
  const server = http.createServer(createInfraRcaBrokerRequestHandler(secret));

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
    throw new Error('Could not determine infra-rca broker address');
  }

  const port = (address as AddressInfo).port;
  brokerState = { server, port, secret };
  server.unref();

  log(`[InfraRcaBroker] Listening on http://127.0.0.1:${port}`);
  return { port };
}

export function getInfraRcaBrokerConnectionInfo(): { port: number; secret: string } | null {
  if (!brokerState) return null;
  return { port: brokerState.port, secret: brokerState.secret };
}

export async function stopInfraRcaBroker(): Promise<void> {
  if (!brokerState) return;
  const { server } = brokerState;
  brokerState = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
