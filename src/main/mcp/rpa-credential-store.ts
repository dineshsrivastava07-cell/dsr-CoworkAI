import Store from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';

export interface RpaCredentialProfile {
  name: string;
  appName?: string;
  username: string;
  password: string;
  updatedAt: number;
}

interface RpaCredentialStoreShape {
  profiles: RpaCredentialProfile[];
}

class RpaCredentialStore {
  private readonly store: Store<RpaCredentialStoreShape>;

  constructor() {
    type RecordShape = RpaCredentialStoreShape & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<RecordShape>({
      stableKey: 'open-cowork-rpa-credentials-stable-v1',
      legacyKeys: getLegacyDerivedKeyHexes({
        moduleDirname: __dirname,
        stableSeed: 'open-cowork-rpa-credentials-stable-v1',
        legacySeed: 'open-cowork-rpa-credentials-stable-v1',
        salt: 'open-cowork-rpa-credentials-salt',
      }),
      storeOptions: {
        name: 'rpa-credentials',
        projectName: 'open-cowork',
        defaults: { profiles: [] },
      },
      logPrefix: '[RpaCredentialStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<RpaCredentialStoreShape>;
  }

  list(): Pick<RpaCredentialProfile, 'name' | 'appName' | 'username' | 'updatedAt'>[] {
    return this.store.get('profiles', []).map(({ name, appName, username, updatedAt }) => ({
      name,
      appName,
      username,
      updatedAt,
    }));
  }

  save(input: { name: string; appName?: string; username: string; password: string }): void {
    const name = input.name.trim();
    const username = input.username.trim();
    if (!name || name.length > 200) throw new Error('Credential profile name is required.');
    if (!username) throw new Error('Credential username is required.');
    if (!input.password) throw new Error('Credential password is required.');
    const profiles = this.store.get('profiles', []);
    const existing = profiles.find((profile) => profile.name.toLowerCase() === name.toLowerCase());
    const saved = {
      name,
      appName: input.appName?.trim() || undefined,
      username,
      password: input.password,
      updatedAt: Date.now(),
    };
    if (existing) Object.assign(existing, saved);
    else profiles.push(saved);
    this.store.set('profiles', profiles);
  }

  delete(name: string): void {
    const normalizedName = name.trim().toLowerCase();
    this.store.set(
      'profiles',
      this.store
        .get('profiles', [])
        .filter((profile) => profile.name.trim().toLowerCase() !== normalizedName)
    );
  }

  /** Main-process-only plaintext lookup for the transient MCP child bootstrap. */
  getForBroker(): RpaCredentialProfile[] {
    return this.store.get('profiles', []);
  }
}

export const rpaCredentialStore = new RpaCredentialStore();
