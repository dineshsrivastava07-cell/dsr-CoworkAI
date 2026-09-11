import Store, { type Options as StoreOptions } from 'electron-store';
import { randomUUID } from 'crypto';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import { log, logWarn } from '../utils/logger';
import type { TargetCredentials } from './infra-drivers/types';

interface InfraRcaStoreShape {
  targets: TargetCredentials[];
}

export type PublicTargetInfo = Pick<TargetCredentials, 'id' | 'name' | 'protocol' | 'host'>;

const defaults: InfraRcaStoreShape = { targets: [] };

class InfraRcaStore {
  private store: Store<InfraRcaStoreShape>;

  constructor() {
    const storeOptions: StoreOptions<InfraRcaStoreShape> & { projectName?: string } = {
      name: 'infra-rca-targets',
      projectName: 'open-cowork',
      defaults,
    };

    type InfraRcaStoreRecord = InfraRcaStoreShape & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<InfraRcaStoreRecord>({
      stableKey: 'open-cowork-infra-rca-stable-v1',
      legacyKeys: [
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-infra-rca-stable-v1',
          legacySeed: 'open-cowork-infra-rca-stable-v1',
          salt: 'open-cowork-infra-rca-salt',
        }),
      ],
      storeOptions: storeOptions as StoreOptions<InfraRcaStoreRecord> & { projectName?: string },
      logPrefix: '[InfraRcaStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<InfraRcaStoreShape>;
  }

  /** Names/protocols/hosts only — never secrets. Safe to send to the renderer or the model. */
  listTargets(): PublicTargetInfo[] {
    return this.store
      .get('targets', [])
      .map(({ id, name, protocol, host }) => ({ id, name, protocol, host }));
  }

  /** Full record including secrets — main-process use only (driver dispatch), never sent to the renderer or the model. */
  getTargetByName(name: string): TargetCredentials | undefined {
    return this.store.get('targets', []).find((t) => t.name === name);
  }

  saveTarget(target: Omit<TargetCredentials, 'id'> & { id?: string }): TargetCredentials {
    const targets = this.store.get('targets', []);
    const id = target.id || randomUUID();
    const existingIndex = targets.findIndex((t) => t.id === id);
    const saved: TargetCredentials = { ...target, id };
    if (existingIndex >= 0) {
      targets[existingIndex] = saved;
    } else {
      targets.push(saved);
    }
    this.store.set('targets', targets);
    return saved;
  }

  deleteTarget(id: string): void {
    const targets = this.store.get('targets', []).filter((t) => t.id !== id);
    this.store.set('targets', targets);
  }
}

export const infraRcaStore = new InfraRcaStore();
