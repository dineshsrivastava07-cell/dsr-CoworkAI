/**
 * Barrel + OAuth orchestration for the Google Workspace connector. This is
 * what the `google.*` IPC handlers in main/index.ts call for the
 * OAuth/token side of things. Enabling/disabling the Google_Workspace MCP
 * server config is deliberately NOT done here — that requires `sessionManager`
 * and `mcpConfigStore`, both of which only exist as module-level state in
 * main/index.ts (mirroring exactly how the existing `mcp.saveServer` IPC
 * handler there already does it) — so main/index.ts's `google.connectAccount`/
 * `google.disconnectAccount` handlers call `connectGoogleAccount()`/
 * `disconnectGoogleAccount()` here first, then do the MCP-server enable/
 * disable step themselves with their own already-in-scope references.
 */
import { shell } from 'electron';
import { log, logWarn } from '../utils/logger';
import {
  fetchGoogleAccountEmail,
  revokeGoogleToken,
  runGoogleOAuthFlow,
  type GoogleClientCredentials,
} from './google-oauth';
import { googleTokenStore } from './google-token-store';
import { getBundledCredentials } from './google-bundled-credentials';

export { startGoogleTokenBroker, stopGoogleTokenBroker } from './google-token-broker';

export interface GoogleConnectionStatus {
  connected: boolean;
  accountEmail: string | null;
  needsReconnect: boolean;
  lastErrorMessage: string | null;
  hasClientCredentials: boolean;
  /** True when credentials came from bundled env vars — UI hides the credential form. */
  credentialsAreBundled: boolean;
}

export function getGoogleConnectionStatus(): GoogleConnectionStatus {
  const account = googleTokenStore.getAccount();
  return {
    connected: Boolean(account),
    accountEmail: account?.accountEmail ?? null,
    needsReconnect: Boolean(account?.lastRefreshError),
    lastErrorMessage: account?.lastRefreshError?.message ?? null,
    hasClientCredentials: googleTokenStore.hasClientCredentials(),
    credentialsAreBundled: getBundledCredentials() !== null,
  };
}

/**
 * Auto-saves bundled credentials from environment variables if present and not
 * already stored. Called once at app startup so users get the one-click
 * "Sign in with Google" experience without ever entering a Client ID/Secret.
 */
export function initializeBundledCredentials(): void {
  const bundled = getBundledCredentials();
  if (!bundled) return; // no env vars configured
  if (googleTokenStore.hasClientCredentials()) return; // already saved
  googleTokenStore.saveClientCredentials(bundled);
  log('[Google] Bundled OAuth credentials auto-initialized from environment.');
}

export function saveGoogleClientCredentials(credentials: GoogleClientCredentials): {
  success: boolean;
  error?: string;
} {
  const clientId = credentials.clientId?.trim();
  const clientSecret = credentials.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return { success: false, error: 'Client ID and Client Secret are both required.' };
  }
  googleTokenStore.saveClientCredentials({ clientId, clientSecret });
  return { success: true };
}

export async function connectGoogleAccount(): Promise<{
  success: boolean;
  accountEmail?: string;
  error?: string;
}> {
  const credentials = googleTokenStore.getClientCredentials();
  if (!credentials) {
    return {
      success: false,
      error: 'Save your Google OAuth Client ID and Client Secret first.',
    };
  }

  try {
    const tokens = await runGoogleOAuthFlow(credentials, async (url) => {
      await shell.openExternal(url);
    });
    const accountEmail = await fetchGoogleAccountEmail(tokens.accessToken);

    googleTokenStore.saveAccount({
      accountEmail,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
      obtainedAt: Date.now(),
    });

    log('[Google] Account connected:', accountEmail);
    return { success: true, accountEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn('[Google] Connect failed:', message);
    return { success: false, error: message };
  }
}

export async function disconnectGoogleAccount(): Promise<{ success: boolean; error?: string }> {
  const account = googleTokenStore.getAccount();
  if (account) {
    await revokeGoogleToken(account.refreshToken);
  }
  googleTokenStore.clearAccount();
  return { success: true };
}
