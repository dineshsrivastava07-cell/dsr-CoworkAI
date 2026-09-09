/**
 * Google OAuth (Authorization Code + PKCE) for the Google Workspace connector.
 *
 * Talks directly to Google's REST OAuth endpoints with fetch() — no googleapis/
 * google-auth-library dependency, matching this codebase's existing pattern of
 * calling third-party REST APIs directly (see weather-tools-server.ts).
 *
 * Reuses createOAuthCallbackListener from mcp/mcp-oauth.ts as-is for the loopback
 * redirect catcher — that function has no dependency on the MCP-client-specific
 * types elsewhere in that file, it's a plain node:http/crypto loopback listener.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createOAuthCallbackListener } from '../mcp/mcp-oauth';
import { logWarn } from '../utils/logger';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GoogleTokenResult {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: number; // epoch ms
}

export interface GoogleAccessTokenRefresh {
  accessToken: string;
  expiresAt: number;
}

type OpenExternal = (url: string) => Promise<void> | void;

function base64UrlEncode(input: Buffer): string {
  return input.toString('base64url');
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

function deriveCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
}

async function parseTokenErrorResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; error_description?: string };
    if (body.error) {
      return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
    }
  } catch {
    // fall through to status text below
  }
  return `${response.status} ${response.statusText}`;
}

/**
 * Runs the full authorization-code + PKCE flow: opens the system browser for
 * user consent, catches the redirect on a loopback listener, exchanges the
 * code for tokens. Throws on any failure (denied consent, state mismatch,
 * missing refresh_token, non-2xx token response).
 */
export async function runGoogleOAuthFlow(
  credentials: GoogleClientCredentials,
  openExternal: OpenExternal
): Promise<GoogleTokenResult> {
  const listener = await createOAuthCallbackListener();
  try {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', credentials.clientId);
    authUrl.searchParams.set('redirect_uri', listener.redirectUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    // Must be sent on every authorization request, not just the first — otherwise
    // Google silently omits refresh_token on subsequent consents for the same user.
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    await openExternal(authUrl.toString());

    const callbackParams = await listener.waitForCallback();

    const error = callbackParams.get('error');
    if (error) {
      throw new Error(`Google authorization failed: ${error}`);
    }

    const receivedState = callbackParams.get('state');
    if (!receivedState || receivedState !== state) {
      throw new Error('Google OAuth failed: invalid state parameter');
    }

    const code = callbackParams.get('code');
    if (!code) {
      throw new Error('Google OAuth failed: no authorization code returned');
    }

    return await exchangeCodeForTokens(credentials, code, listener.redirectUrl, codeVerifier);
  } finally {
    await listener.close();
  }
}

async function exchangeCodeForTokens(
  credentials: GoogleClientCredentials,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<GoogleTokenResult> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await parseTokenErrorResponse(response)}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. This usually means consent was already granted ' +
        'without offline access — try disconnecting from https://myaccount.google.com/permissions ' +
        'and connecting again.'
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refreshes an access token using a stored refresh token. Throws with
 * `error: 'invalid_grant'` semantics detectable via message content when the
 * refresh token itself is dead (revoked, expired) —  callers should treat this
 * as "user must reconnect", not a transient failure.
 */
export async function refreshGoogleAccessToken(
  credentials: GoogleClientCredentials,
  refreshToken: string
): Promise<GoogleAccessTokenRefresh> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const message = await parseTokenErrorResponse(response);
    throw new Error(`Google token refresh failed: ${message}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Best-effort revocation — failures (already revoked, network error) are non-fatal. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    const url = new URL(GOOGLE_REVOKE_ENDPOINT);
    url.searchParams.set('token', token);
    await fetch(url.toString(), { method: 'POST' });
  } catch (error) {
    logWarn('[GoogleOAuth] Token revocation failed (non-fatal):', error);
  }
}

/** Fetches the connected account's email using a fresh access token. */
export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google account info: ${response.status} ${response.statusText}`
    );
  }
  const data = (await response.json()) as { email?: string };
  if (!data.email) {
    throw new Error('Google userinfo response did not include an email address');
  }
  return data.email;
}
