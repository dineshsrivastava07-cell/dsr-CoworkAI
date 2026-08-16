/**
 * Encrypted storage for the Google Workspace connector's OAuth client
 * credentials and account tokens. Separate from mcp-config-store.ts (which is
 * plaintext) on purpose — refresh tokens are long-lived, high-privilege
 * secrets and must never be written through that store's plaintext env field.
 *
 * Same encrypted-store pattern already used for provider API keys in
 * config-store.ts (createEncryptedStoreWithKeyRotation, keyed by hostname +
 * module path, Electron-only — this store can only be constructed in the main
 * process, never from the bare-Node MCP server child process).
 */
import Store, { type Options as StoreOptions } from 'electron-store';
import { log, logWarn } from '../utils/logger';
import { createEncryptedStoreWithKeyRotation } from '../utils/store-encryption';
import type { GoogleClientCredentials } from './google-oauth';

export interface GoogleAccountTokenRecord {
  accountEmail: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: number; // epoch ms
  obtainedAt: number; // epoch ms, diagnostics only
  lastRefreshError?: { message: string; at: number };
}

interface GoogleTokenStoreSchema {
  clientCredentials?: GoogleClientCredentials;
  account?: GoogleAccountTokenRecord;
}

type GoogleTokenStoreRecord = GoogleTokenStoreSchema & Record<string, unknown>;

class GoogleTokenStore {
  private store: Store<GoogleTokenStoreRecord>;

  constructor() {
    const storeOptions: StoreOptions<GoogleTokenStoreRecord> & { projectName?: string } = {
      name: 'google-tokens',
      projectName: 'open-cowork',
      defaults: {},
    };

    this.store = createEncryptedStoreWithKeyRotation<GoogleTokenStoreRecord>({
      stableKey: 'open-cowork-google-tokens-stable-v1',
      legacyKeys: [],
      storeOptions,
      logPrefix: '[GoogleTokenStore]',
      log,
      warn: logWarn,
    });
  }

  getClientCredentials(): GoogleClientCredentials | undefined {
    return this.store.get('clientCredentials');
  }

  saveClientCredentials(credentials: GoogleClientCredentials): void {
    this.store.set('clientCredentials', credentials);
  }

  hasClientCredentials(): boolean {
    const creds = this.getClientCredentials();
    return Boolean(creds?.clientId?.trim() && creds?.clientSecret?.trim());
  }

  getAccount(): GoogleAccountTokenRecord | undefined {
    return this.store.get('account');
  }

  saveAccount(account: GoogleAccountTokenRecord): void {
    this.store.set('account', account);
  }

  updateAccessToken(accessToken: string, expiresAt: number): void {
    const account = this.getAccount();
    if (!account) return;
    this.store.set('account', {
      ...account,
      accessToken,
      expiresAt,
      lastRefreshError: undefined,
    });
  }

  recordRefreshError(message: string): void {
    const account = this.getAccount();
    if (!account) return;
    this.store.set('account', {
      ...account,
      lastRefreshError: { message, at: Date.now() },
    });
  }

  /** Clears the connected account but keeps client credentials so the user needn't re-paste them. */
  clearAccount(): void {
    this.store.delete('account');
  }
}

export const googleTokenStore = new GoogleTokenStore();
export type { GoogleTokenStore };
