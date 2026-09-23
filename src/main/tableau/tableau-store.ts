import Store, { type Options as StoreOptions } from 'electron-store';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import { log, logWarn } from '../utils/logger';
import type {
  TableauConfigInput,
  TableauConfigPublic,
  TableauRole,
  TableauRoleSummary,
} from '../../shared/tableau-types';
import { normalizeTableauBaseUrl, type TableauCredentials } from './tableau-client';

interface TableauStoreShape {
  config: TableauCredentials;
  summaries: Partial<Record<TableauRole, TableauRoleSummary>>;
}

const DEFAULT_CONFIG: TableauCredentials = {
  baseUrl: 'http://10.0.0.55:8000',
  username: '',
  password: '',
  siteContentUrl: '',
  apiVersion: '3.27',
};

class TableauStore {
  private store: Store<TableauStoreShape>;

  constructor() {
    const storeOptions: StoreOptions<TableauStoreShape> & { projectName?: string } = {
      name: 'tableau-connector',
      projectName: 'open-cowork',
      defaults: { config: DEFAULT_CONFIG, summaries: {} },
    };
    type ShapeRecord = TableauStoreShape & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<ShapeRecord>({
      stableKey: 'open-cowork-tableau-stable-v1',
      legacyKeys: getLegacyDerivedKeyHexes({
        moduleDirname: __dirname,
        stableSeed: 'open-cowork-tableau-stable-v1',
        legacySeed: 'open-cowork-tableau-stable-v1',
        salt: 'open-cowork-tableau-salt',
      }),
      storeOptions: storeOptions as StoreOptions<ShapeRecord> & { projectName?: string },
      logPrefix: '[TableauStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<TableauStoreShape>;
  }

  getPublicConfig(): TableauConfigPublic {
    const config = this.store.get('config', DEFAULT_CONFIG);
    return {
      baseUrl: config.baseUrl,
      username: config.username,
      siteContentUrl: config.siteContentUrl,
      apiVersion: config.apiVersion,
      hasPassword: Boolean(config.password),
      configured: Boolean(config.baseUrl && config.username && config.password),
    };
  }

  getCredentials(): TableauCredentials | null {
    const config = this.store.get('config', DEFAULT_CONFIG);
    return config.baseUrl && config.username && config.password ? config : null;
  }

  saveConfig(input: TableauConfigInput): TableauConfigPublic {
    const current = this.store.get('config', DEFAULT_CONFIG);
    const apiVersion = (input.apiVersion || current.apiVersion || '3.27').trim();
    if (!/^\d+\.\d+$/.test(apiVersion)) throw new Error('Invalid Tableau REST API version.');
    const next: TableauCredentials = {
      baseUrl: normalizeTableauBaseUrl(input.baseUrl),
      username: input.username.trim(),
      password: input.password?.length ? input.password : current.password,
      siteContentUrl: (input.siteContentUrl ?? current.siteContentUrl).trim(),
      apiVersion,
    };
    if (!next.username) throw new Error('Tableau username is required.');
    if (!next.password) throw new Error('Tableau password is required.');
    this.store.set('config', next);
    return this.getPublicConfig();
  }

  getSummaries(): Partial<Record<TableauRole, TableauRoleSummary>> {
    return this.store.get('summaries', {});
  }

  saveSummaries(summaries: Record<TableauRole, TableauRoleSummary>): void {
    this.store.set('summaries', summaries);
  }
}

export const tableauStore = new TableauStore();
