import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrokerRequestHandler } from '../src/main/google/google-token-broker';
import { googleTokenStore } from '../src/main/google/google-token-store';
import * as googleOauth from '../src/main/google/google-oauth';

const SECRET = 'test-secret-value';

function startServer(secret: string): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createBrokerRequestHandler(secret));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('createBrokerRequestHandler', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.spyOn(googleTokenStore, 'getAccount').mockReturnValue(undefined);
    vi.spyOn(googleTokenStore, 'getClientCredentials').mockReturnValue(undefined);
    vi.spyOn(googleTokenStore, 'updateAccessToken').mockImplementation(() => {});
    vi.spyOn(googleTokenStore, 'recordRefreshError').mockImplementation(() => {});
    const started = await startServer(SECRET);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    vi.restoreAllMocks();
  });

  it('rejects requests with no Authorization header', async () => {
    const response = await fetch(`${baseUrl}/google/token`);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });

  it('rejects requests with the wrong bearer secret', async () => {
    const response = await fetch(`${baseUrl}/google/token`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 not_connected when no account is stored', async () => {
    const response = await fetch(`${baseUrl}/google/token`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('not_connected');
  });

  it('returns the cached access token without refreshing when it is not near expiry', async () => {
    vi.spyOn(googleTokenStore, 'getAccount').mockReturnValue({
      accountEmail: 'user@example.com',
      accessToken: 'cached-token',
      refreshToken: 'refresh-token',
      scope: 'openid',
      expiresAt: Date.now() + 60 * 60 * 1000,
      obtainedAt: Date.now(),
    });
    const refreshSpy = vi.spyOn(googleOauth, 'refreshGoogleAccessToken');

    const response = await fetch(`${baseUrl}/google/token`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessToken).toBe('cached-token');
    expect(body.accountEmail).toBe('user@example.com');
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('proactively refreshes when the token is within the skew window of expiry', async () => {
    vi.spyOn(googleTokenStore, 'getAccount').mockReturnValue({
      accountEmail: 'user@example.com',
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
      scope: 'openid',
      expiresAt: Date.now() + 30 * 1000, // within the 2-minute skew window
      obtainedAt: Date.now(),
    });
    vi.spyOn(googleTokenStore, 'getClientCredentials').mockReturnValue({
      clientId: 'id',
      clientSecret: 'secret',
    });
    vi.spyOn(googleOauth, 'refreshGoogleAccessToken').mockResolvedValue({
      accessToken: 'fresh-token',
      expiresAt: Date.now() + 3600 * 1000,
    });

    const response = await fetch(`${baseUrl}/google/token`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessToken).toBe('fresh-token');
    expect(googleTokenStore.updateAccessToken).toHaveBeenCalledWith(
      'fresh-token',
      expect.any(Number)
    );
  });

  it('returns 401 reconnect_required when the refresh token itself is dead', async () => {
    vi.spyOn(googleTokenStore, 'getAccount').mockReturnValue({
      accountEmail: 'user@example.com',
      accessToken: 'stale-token',
      refreshToken: 'dead-refresh-token',
      scope: 'openid',
      expiresAt: Date.now() - 1000, // already expired
      obtainedAt: Date.now(),
    });
    vi.spyOn(googleTokenStore, 'getClientCredentials').mockReturnValue({
      clientId: 'id',
      clientSecret: 'secret',
    });
    vi.spyOn(googleOauth, 'refreshGoogleAccessToken').mockRejectedValue(
      new Error('Google token refresh failed: invalid_grant')
    );

    const response = await fetch(`${baseUrl}/google/token`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('reconnect_required');
    expect(body.accountEmail).toBe('user@example.com');
    expect(googleTokenStore.recordRefreshError).toHaveBeenCalled();
  });

  it('invalidates the cached token on POST /google/token/invalidate', async () => {
    vi.spyOn(googleTokenStore, 'getAccount').mockReturnValue({
      accountEmail: 'user@example.com',
      accessToken: 'cached-token',
      refreshToken: 'refresh-token',
      scope: 'openid',
      expiresAt: Date.now() + 60 * 60 * 1000,
      obtainedAt: Date.now(),
    });

    const response = await fetch(`${baseUrl}/google/token/invalidate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
    });

    expect(response.status).toBe(204);
    expect(googleTokenStore.updateAccessToken).toHaveBeenCalledWith('cached-token', 0);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await fetch(`${baseUrl}/unknown`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.status).toBe(404);
  });
});
