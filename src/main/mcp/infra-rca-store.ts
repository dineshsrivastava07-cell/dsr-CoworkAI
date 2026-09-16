import Store, { type Options as StoreOptions } from 'electron-store';
import { randomUUID } from 'crypto';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import { log, logWarn } from '../utils/logger';
import type { TargetCredentials } from './infra-drivers/types';
import type { InfraRcaImportInput, InfraRcaImportResult } from '../../shared/ipc-types';
import { mergeInfraTargetUpdate, planInfraImport, validateTarget } from './infra-rca-import';

interface InfraRcaStoreShape {
  targets: TargetCredentials[];
}

export type PublicTargetInfo = Pick<
  TargetCredentials,
  | 'id'
  | 'name'
  | 'protocol'
  | 'host'
  | 'port'
  | 'group'
  | 'winrmTransport'
  | 'winrmAuth'
  | 'winrmRejectUnauthorized'
  | 'remoteDesktop'
  | 'remotePort'
>;

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
      .map(
        ({
          id,
          name,
          protocol,
          host,
          port,
          group,
          winrmTransport,
          winrmAuth,
          winrmRejectUnauthorized,
          remoteDesktop,
          remotePort,
        }) => ({
          id,
          name,
          protocol,
          host,
          port,
          group,
          winrmTransport,
          winrmAuth,
          winrmRejectUnauthorized,
          remoteDesktop,
          remotePort,
        })
      );
  }

  importTargets(input: InfraRcaImportInput, commit = false): InfraRcaImportResult {
    const { result, nextTargets } = planInfraImport(input, this.store.get('targets', []));
    if (commit && result.success && (result.added || result.updated)) {
      // One encrypted write for the entire batch; validation never saves partial rows.
      this.store.set('targets', nextTargets);
    }
    return result;
  }

  /** Full record including secrets — main-process use only (driver dispatch), never sent to the renderer or the model. */
  getTargetByName(name: string): TargetCredentials | undefined {
    return this.store.get('targets', []).find((t) => t.name === name);
  }

  getTargetById(id: string): TargetCredentials | undefined {
    return this.store.get('targets', []).find((t) => t.id === id);
  }

  saveTarget(target: Omit<TargetCredentials, 'id'> & { id?: string }): TargetCredentials {
    const targets = this.store.get('targets', []);
    const id = target.id || randomUUID();
    if (
      targets.some(
        (t) => t.id !== id && t.name.trim().toLowerCase() === target.name.trim().toLowerCase()
      )
    ) {
      throw new Error('A target with this name already exists.');
    }
    const existingIndex = targets.findIndex((t) => t.id === id);
    const existing = existingIndex >= 0 ? targets[existingIndex] : undefined;
    const saved = mergeInfraTargetUpdate(existing, target, id);
    validateTarget(saved);
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
