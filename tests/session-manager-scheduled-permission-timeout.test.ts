import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/main/session/session-manager';

// requestPermission and markSessionScheduled only touch a handful of instance
// fields (scheduledSessionIds, pendingPermissions, sendToRenderer) — invoke
// them directly against a minimal fake `this` via Function.prototype.call,
// same technique as tests/session-manager-scheduled-title.test.ts, rather
// than constructing a full SessionManager (which needs a real db/MCP setup).
function createFakeManager() {
  return {
    scheduledSessionIds: new Set<string>(),
    pendingPermissions: new Map<string, (result: 'allow' | 'deny' | 'allow_always') => void>(),
    sendToRenderer: vi.fn(),
  };
}

type ProtoMethods = {
  markSessionScheduled(sessionId: string): void;
  requestPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<'allow' | 'deny' | 'allow_always'>;
};

const proto = SessionManager.prototype as unknown as ProtoMethods;

describe('SessionManager scheduled-session permission fast-deny', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a session id as scheduled', () => {
    const fakeManager = createFakeManager();
    proto.markSessionScheduled.call(fakeManager, 'session-1');
    expect(fakeManager.scheduledSessionIds.has('session-1')).toBe(true);
  });

  it('denies quickly (500ms) for a scheduled session instead of waiting the full 60s', async () => {
    const fakeManager = createFakeManager();
    fakeManager.scheduledSessionIds.add('session-1');

    const promise = proto.requestPermission.call(
      fakeManager,
      'session-1',
      'tool-use-1',
      'write',
      {}
    );

    // Not yet resolved just before the short timeout.
    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Resolves 'deny' right after the short timeout — not 60s.
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('deny');
  });

  it('still waits the full 60s for a normal (non-scheduled) interactive session', async () => {
    const fakeManager = createFakeManager();
    // session NOT added to scheduledSessionIds — interactive session.

    const promise = proto.requestPermission.call(
      fakeManager,
      'session-2',
      'tool-use-2',
      'write',
      {}
    );

    await vi.advanceTimersByTimeAsync(59_999);
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('deny');
  });

  it('still resolves with the real user decision if it arrives before the fast-deny timeout', async () => {
    const fakeManager = createFakeManager();
    fakeManager.scheduledSessionIds.add('session-1');

    const promise = proto.requestPermission.call(
      fakeManager,
      'session-1',
      'tool-use-1',
      'write',
      {}
    );

    // Simulate a response arriving via handlePermissionResponse's callback
    // before the fast-deny timer fires.
    const resolver = fakeManager.pendingPermissions.get('tool-use-1');
    expect(resolver).toBeDefined();
    resolver!('allow');

    await expect(promise).resolves.toBe('allow');
  });

  it('sends permission.request for scheduled sessions too (visible if someone is watching)', () => {
    const fakeManager = createFakeManager();
    fakeManager.scheduledSessionIds.add('session-1');

    void proto.requestPermission.call(fakeManager, 'session-1', 'tool-use-1', 'write', {
      path: 'x',
    });

    expect(fakeManager.sendToRenderer).toHaveBeenCalledWith({
      type: 'permission.request',
      payload: {
        toolUseId: 'tool-use-1',
        toolName: 'write',
        input: { path: 'x' },
        sessionId: 'session-1',
      },
    });
  });
});
