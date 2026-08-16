/**
 * Loopback HTTP broker that hands the Google_Workspace stdio MCP server a
 * live access token on demand. The MCP server is a bare Node child process
 * with no Electron access, so it cannot own the encrypted token store or
 * perform its own OAuth refresh — this broker (running in the main process,
 * which does own the store) is the only thing it talks to.
 *
 * Modeled on nav-server.ts's loopback-HTTP-server pattern, but with two
 * differences that matter because this endpoint hands out live access to the
 * user's Gmail/Drive/Calendar data rather than UI navigation commands:
 *  - ephemeral port (`.listen(0, ...)`), not a fixed/discoverable one
 *  - bearer-secret auth, generated fresh in memory each app launch and only
 *    ever passed to the one Google_Workspace child process via env var
 */
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { log, logError, logWarn } from '../utils/logger';
import { googleTokenStore } from './google-token-store';
import { refreshGoogleAccessToken } from './google-oauth';

const REFRESH_SKEW_MS = 2 * 60 * 1000; // refresh if within 2 minutes of expiry

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

async function ensureFreshAccessToken(): Promise<
  | { ok: true; accessToken: string; accountEmail: string; expiresAt: number }
  | { ok: false; status: number; error: string; accountEmail?: string }
> {
  const account = googleTokenStore.getAccount();
  if (!account) {
    return { ok: false, status: 404, error: 'not_connected' };
  }

  if (Date.now() < account.expiresAt - REFRESH_SKEW_MS) {
    return {
      ok: true,
      accessToken: account.accessToken,
      accountEmail: account.accountEmail,
      expiresAt: account.expiresAt,
    };
  }

  const credentials = googleTokenStore.getClientCredentials();
  if (!credentials) {
    return { ok: false, status: 404, error: 'not_connected' };
  }

  try {
    const refreshed = await refreshGoogleAccessToken(credentials, account.refreshToken);
    googleTokenStore.updateAccessToken(refreshed.accessToken, refreshed.expiresAt);
    return {
      ok: true,
      accessToken: refreshed.accessToken,
      accountEmail: account.accountEmail,
      expiresAt: refreshed.expiresAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    googleTokenStore.recordRefreshError(message);
    logWarn('[GoogleTokenBroker] Token refresh failed:', message);
    return {
      ok: false,
      status: 401,
      error: 'reconnect_required',
      accountEmail: account.accountEmail,
    };
  }
}

/**
 * Pure request handler, separated from the .listen() wiring so it can be unit
 * tested over a real ephemeral loopback socket without going through the
 * module-level singleton state.
 */
export function createBrokerRequestHandler(
  secret: string
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      try {
        if (!isAuthorized(req, secret)) {
          json(res, 401, { error: 'unauthorized' });
          return;
        }

        const url = new URL(req.url ?? '/', 'http://127.0.0.1');

        if (req.method === 'GET' && url.pathname === '/google/token') {
          const result = await ensureFreshAccessToken();
          if (!result.ok) {
            json(res, result.status, { error: result.error, accountEmail: result.accountEmail });
            return;
          }
          json(res, 200, {
            accessToken: result.accessToken,
            accountEmail: result.accountEmail,
            expiresAt: result.expiresAt,
          });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/google/token/invalidate') {
          const account = googleTokenStore.getAccount();
          if (account) {
            // Force the next /google/token call to refresh regardless of the
            // clock-based expiry check, in case of out-of-band revocation.
            googleTokenStore.updateAccessToken(account.accessToken, 0);
          }
          res.writeHead(204);
          res.end();
          return;
        }

        json(res, 404, { error: 'not_found' });
      } catch (error) {
        logError('[GoogleTokenBroker] Unexpected error:', error);
        if (!res.headersSent) {
          json(res, 500, { error: 'internal_error' });
        }
      }
    })();
  };
}

export async function startGoogleTokenBroker(): Promise<{ port: number }> {
  if (brokerState) {
    return { port: brokerState.port };
  }

  const secret = randomBytes(32).toString('hex');
  const server = http.createServer(createBrokerRequestHandler(secret));

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
    throw new Error('Could not determine Google token broker address');
  }

  const port = (address as AddressInfo).port;
  brokerState = { server, port, secret };
  server.unref();

  log(`[GoogleTokenBroker] Listening on http://127.0.0.1:${port}`);
  return { port };
}

export function getGoogleTokenBrokerConnectionInfo(): { port: number; secret: string } | null {
  if (!brokerState) return null;
  return { port: brokerState.port, secret: brokerState.secret };
}

export async function stopGoogleTokenBroker(): Promise<void> {
  if (!brokerState) return;
  const { server } = brokerState;
  brokerState = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
