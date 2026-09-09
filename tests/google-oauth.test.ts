import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  fetchGoogleAccountEmail,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  runGoogleOAuthFlow,
} from '../src/main/google/google-oauth';

const credentials = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };
const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stubs global fetch so calls to Google's endpoints are faked, while calls to
 * the real loopback OAuth callback listener (127.0.0.1, started internally by
 * runGoogleOAuthFlow) pass through to the real network — the openExternal
 * callback below needs to actually reach that listener to simulate the
 * browser completing consent.
 */
function stubGoogleFetch(
  handleGoogleRequest: (url: string, init?: RequestInit) => Promise<Response>
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.startsWith('http://127.0.0.1')) {
        return realFetch(url as string, init);
      }
      return handleGoogleRequest(urlStr, init);
    })
  );
}

/** Simulates the system browser hitting the loopback redirect after consent. */
function simulateConsentRedirect(extraParams: Record<string, string> = {}) {
  return vi.fn(async (url: string) => {
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get('redirect_uri')!;
    const state = parsed.searchParams.get('state')!;
    const callback = new URL(redirectUri);
    callback.searchParams.set('state', state);
    for (const [key, value] of Object.entries(extraParams)) {
      callback.searchParams.set(key, value);
    }
    await realFetch(callback.toString());
    return { authUrl: parsed };
  });
}

describe('runGoogleOAuthFlow', () => {
  it('completes the PKCE flow: opens the real authorization URL, catches the loopback callback, and exchanges the code', async () => {
    let capturedTokenRequestBody: URLSearchParams | undefined;
    stubGoogleFetch(async (urlStr, init) => {
      if (urlStr.startsWith('https://oauth2.googleapis.com/token')) {
        capturedTokenRequestBody = init?.body as URLSearchParams;
        return new Response(
          JSON.stringify({
            access_token: 'access-123',
            refresh_token: 'refresh-456',
            expires_in: 3600,
            scope: 'openid email',
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    });

    let capturedAuthUrl: URL | undefined;
    const openExternal = vi.fn(async (url: string) => {
      capturedAuthUrl = new URL(url);
      const state = capturedAuthUrl.searchParams.get('state');
      const redirectUri = capturedAuthUrl.searchParams.get('redirect_uri')!;
      await realFetch(`${redirectUri}?code=auth-code-abc&state=${state}`);
    });

    const result = await runGoogleOAuthFlow(credentials, openExternal);

    expect(capturedAuthUrl).toBeDefined();
    expect(capturedAuthUrl!.origin + capturedAuthUrl!.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(capturedAuthUrl!.searchParams.get('client_id')).toBe(credentials.clientId);
    expect(capturedAuthUrl!.searchParams.get('response_type')).toBe('code');
    expect(capturedAuthUrl!.searchParams.get('access_type')).toBe('offline');
    expect(capturedAuthUrl!.searchParams.get('prompt')).toBe('consent');
    expect(capturedAuthUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(capturedAuthUrl!.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/gmail.readonly'
    );
    expect(capturedAuthUrl!.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/drive.readonly'
    );
    expect(capturedAuthUrl!.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/calendar.readonly'
    );

    // PKCE: the code_challenge sent in the auth URL must equal
    // base64url(sha256(code_verifier)) sent in the token exchange body.
    const codeChallenge = capturedAuthUrl!.searchParams.get('code_challenge')!;
    const codeVerifier = capturedTokenRequestBody!.get('code_verifier')!;
    const recomputedChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(recomputedChallenge);

    expect(capturedTokenRequestBody!.get('client_id')).toBe(credentials.clientId);
    expect(capturedTokenRequestBody!.get('client_secret')).toBe(credentials.clientSecret);
    expect(capturedTokenRequestBody!.get('grant_type')).toBe('authorization_code');
    expect(capturedTokenRequestBody!.get('code')).toBe('auth-code-abc');

    expect(result.accessToken).toBe('access-123');
    expect(result.refreshToken).toBe('refresh-456');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws a clear error when Google omits refresh_token', async () => {
    stubGoogleFetch(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'access-123', expires_in: 3600, scope: 'openid' }),
          { status: 200 }
        )
    );

    const openExternal = simulateConsentRedirect({ code: 'auth-code' });

    await expect(runGoogleOAuthFlow(credentials, openExternal)).rejects.toThrow(
      'did not return a refresh token'
    );
  });

  it('rejects when the callback state does not match the authorization request', async () => {
    stubGoogleFetch(async (urlStr) => {
      throw new Error(`Unexpected fetch: ${urlStr}`);
    });

    const openExternal = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      await realFetch(`${redirectUri}?code=auth-code&state=wrong-state`);
    });

    await expect(runGoogleOAuthFlow(credentials, openExternal)).rejects.toThrow(
      'invalid state parameter'
    );
  });

  it('rejects when the user denies consent', async () => {
    stubGoogleFetch(async (urlStr) => {
      throw new Error(`Unexpected fetch: ${urlStr}`);
    });

    const openExternal = simulateConsentRedirect({ error: 'access_denied' });

    await expect(runGoogleOAuthFlow(credentials, openExternal)).rejects.toThrow('access_denied');
  });
});

describe('refreshGoogleAccessToken', () => {
  it('sends client_secret and refresh_token, returns the new access token and expiry', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as URLSearchParams;
        return new Response(JSON.stringify({ access_token: 'new-access', expires_in: 1800 }), {
          status: 200,
        });
      })
    );

    const result = await refreshGoogleAccessToken(credentials, 'refresh-456');

    expect(capturedBody!.get('grant_type')).toBe('refresh_token');
    expect(capturedBody!.get('refresh_token')).toBe('refresh-456');
    expect(capturedBody!.get('client_secret')).toBe(credentials.clientSecret);
    expect(result.accessToken).toBe('new-access');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws with the Google error body when refresh fails (e.g. revoked/expired refresh token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            statusText: 'Bad Request',
          })
      )
    );

    await expect(refreshGoogleAccessToken(credentials, 'dead-refresh-token')).rejects.toThrow(
      'invalid_grant'
    );
  });
});

describe('revokeGoogleToken', () => {
  it('is best-effort and never throws, even on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await expect(revokeGoogleToken('some-token')).resolves.toBeUndefined();
  });
});

describe('fetchGoogleAccountEmail', () => {
  it('returns the email from the userinfo endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ email: 'user@example.com' }), { status: 200 })
      )
    );
    await expect(fetchGoogleAccountEmail('token')).resolves.toBe('user@example.com');
  });

  it('throws if the userinfo response has no email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    );
    await expect(fetchGoogleAccountEmail('token')).rejects.toThrow('did not include an email');
  });
});
