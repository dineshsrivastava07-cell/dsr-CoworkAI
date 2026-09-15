import Store from 'electron-store';
import {
  normalizeRpaWorkflowBrief,
  type RpaWorkflowBrief,
  type SavedRpaWorkflowConfiguration,
} from '../../shared/rpa-workflow';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';

interface RpaWorkflowStoreShape {
  workflows: SavedRpaWorkflowConfiguration[];
}

class RpaWorkflowStore {
  private readonly store: Store<RpaWorkflowStoreShape>;

  constructor() {
    type RecordShape = RpaWorkflowStoreShape & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<RecordShape>({
      stableKey: 'open-cowork-rpa-workflows-stable-v1',
      legacyKeys: getLegacyDerivedKeyHexes({
        moduleDirname: __dirname,
        stableSeed: 'open-cowork-rpa-workflows-stable-v1',
        legacySeed: 'open-cowork-rpa-workflows-stable-v1',
        salt: 'open-cowork-rpa-workflows-salt',
      }),
      storeOptions: {
        name: 'rpa-workflows',
        projectName: 'open-cowork',
        defaults: { workflows: [] },
      },
      logPrefix: '[RpaWorkflowStore]',
      log,
      warn: logWarn,
    }) as unknown as Store<RpaWorkflowStoreShape>;
  }

  list(): SavedRpaWorkflowConfiguration[] {
    return [...this.store.get('workflows', [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  save(input: RpaWorkflowBrief): SavedRpaWorkflowConfiguration {
    const normalized = normalizeRpaWorkflowBrief(input);
    const workflows = this.store.get('workflows', []);
    const saved: SavedRpaWorkflowConfiguration = { ...normalized, updatedAt: Date.now() };
    const index = workflows.findIndex(
      (workflow) => workflow.name.toLowerCase() === normalized.name.toLowerCase()
    );
    if (index >= 0) workflows[index] = saved;
    else workflows.push(saved);
    this.store.set('workflows', workflows);
    return saved;
  }

  delete(name: string): void {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) throw new Error('Workflow name is required.');
    this.store.set(
      'workflows',
      this.store
        .get('workflows', [])
        .filter((workflow) => workflow.name.trim().toLowerCase() !== normalizedName)
    );
  }
}

export const rpaWorkflowStore = new RpaWorkflowStore();
