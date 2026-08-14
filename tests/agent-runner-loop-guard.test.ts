import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOOP_GUARD_CONFIG,
  LoopGuard,
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  messageCallsHash,
  messageToolNamesKey,
  stableToolKey,
  type ToolCallDescriptor,
} from '../src/main/agent/agent-runner-loop-guard';

describe('stableToolKey', () => {
  it('buckets adjacent read_file line ranges into the same key', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 1 });
    const b = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 100 });
    const c = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 199 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('separates read_file buckets when crossing the 200-line boundary', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 10 });
    const b = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 500 });
    expect(a).not.toBe(b);
  });

  it('distinguishes different files for read_file', () => {
    const a = stableToolKey('read_file', { file_path: '/a/b.ts', start_line: 0 });
    const b = stableToolKey('read_file', { file_path: '/a/c.ts', start_line: 0 });
    expect(a).not.toBe(b);
  });

  it('treats write_file content changes as distinct operations', () => {
    const a = stableToolKey('write_file', { file_path: '/a.ts', content: 'hello' });
    const b = stableToolKey('write_file', { file_path: '/a.ts', content: 'world' });
    expect(a).not.toBe(b);
  });

  it('str_replace with different replacement payloads yields different keys', () => {
    const a = stableToolKey('str_replace', { path: '/f', old_str: 'a', new_str: 'b' });
    const b = stableToolKey('str_replace', { path: '/f', old_str: 'a', new_str: 'c' });
    expect(a).not.toBe(b);
  });

  it('generic tool extracts only key fields (ignores noise)', () => {
    const a = stableToolKey('web_search', { query: 'foo', session_id: 'x', ts: 1 });
    const b = stableToolKey('web_search', { query: 'foo', session_id: 'y', ts: 2 });
    expect(a).toBe(b);
  });

  it('generic tool with different query yields different keys', () => {
    const a = stableToolKey('web_search', { query: 'foo' });
    const b = stableToolKey('web_search', { query: 'bar' });
    expect(a).not.toBe(b);
  });

  it('is stable against key ordering in input objects', () => {
    const a = stableToolKey('bash', { command: 'ls', cwd: '/a' });
    const b = stableToolKey('bash', { cwd: '/a', command: 'ls' });
    expect(a).toBe(b);
  });

  it('returns a deterministic placeholder for missing input', () => {
    expect(stableToolKey('any', undefined)).toBe('any:∅');
  });
});

describe('messageCallsHash', () => {
  it('returns the same hash for identical tool-call groups regardless of object key ordering', () => {
    const groupA: ToolCallDescriptor[] = [
      { name: 'bash', input: { command: 'ls' } },
      { name: 'read_file', input: { file_path: '/x', start_line: 0 } },
    ];
    const groupB: ToolCallDescriptor[] = [
      { name: 'bash', input: { command: 'ls' } },
      { name: 'read_file', input: { start_line: 0, file_path: '/x' } },
    ];
    expect(messageCallsHash(groupA)).toBe(messageCallsHash(groupB));
  });

  it('order matters (sequence of calls is part of identity)', () => {
    const group1: ToolCallDescriptor[] = [
      { name: 'a', input: { x: 1 } },
      { name: 'b', input: { y: 2 } },
    ];
    const group2: ToolCallDescriptor[] = [
      { name: 'b', input: { y: 2 } },
      { name: 'a', input: { x: 1 } },
    ];
    expect(messageCallsHash(group1)).not.toBe(messageCallsHash(group2));
  });

  it('empty tool-call list hashes to empty string', () => {
    expect(messageCallsHash([])).toBe('');
  });
});

describe('LoopGuard layer 1 — hash-based group detection (streak semantics)', () => {
  const buildCall = (name: string, input: Record<string, unknown>): ToolCallDescriptor => ({
    name,
    input,
  });

  it('emits hash_warn on the 3rd identical group and halt on the 5th and abort on the 8th', () => {
    const guard = new LoopGuard();
    const group = [buildCall('bash', { command: 'echo hi' })];

    const decisions = Array.from({ length: 10 }, () => guard.recordAssistantMessage(group));

    expect(decisions[0].action).toBe('none');
    expect(decisions[1].action).toBe('none');
    expect(decisions[2].action).toBe('hash_warn');
    expect(decisions[2].count).toBe(3);
    expect(decisions[3].action).toBe('none');
    expect(decisions[4].action).toBe('hash_halt');
    expect(decisions[4].count).toBe(5);
    expect(decisions[5].action).toBe('none');
    expect(decisions[6].action).toBe('none');
    expect(decisions[7].action).toBe('hash_abort');
    expect(decisions[7].count).toBe(8);
    expect(decisions[8].action).toBe('none');
    expect(decisions[9].action).toBe('none');
  });

  it('A/B/A/B/A interleaved pattern does NOT fire (no consecutive streak)', () => {
    // Regression test for false-positive bug: under the old frequency-map
    // semantics, the 5-element A/B/A/B/A sequence would push A's count to 3
    // and incorrectly trigger hash_warn. Under streak semantics the streak
    // never exceeds 1 because every message is a different hash from the
    // previous one.
    const guard = new LoopGuard();
    const A = [buildCall('a', { x: 1 })];
    const B = [buildCall('b', { x: 1 })];

    const actions = [A, B, A, B, A, B, A, B, A, B].map(
      (g) => guard.recordAssistantMessage(g).action
    );

    for (const action of actions) {
      expect(action).toBe('none');
    }
  });

  it('different consecutive groups do not contribute to each other', () => {
    const guard = new LoopGuard();
    const groupA = [buildCall('read_file', { file_path: '/a', start_line: 0 })];
    const groupB = [buildCall('read_file', { file_path: '/b', start_line: 0 })];

    // Each block of 3 consecutive identical messages fires exactly one warn for
    // its own hash; the streak resets when the group changes.
    expect(guard.recordAssistantMessage(groupA).action).toBe('none');
    expect(guard.recordAssistantMessage(groupA).action).toBe('none');
    expect(guard.recordAssistantMessage(groupA).action).toBe('hash_warn');
    expect(guard.recordAssistantMessage(groupB).action).toBe('none');
    expect(guard.recordAssistantMessage(groupB).action).toBe('none');
    expect(guard.recordAssistantMessage(groupB).action).toBe('hash_warn');
  });

  it('empty tool-call messages (pure text responses) are ignored by the guard', () => {
    const guard = new LoopGuard();
    expect(guard.recordAssistantMessage([]).action).toBe('none');
    expect(guard.recordAssistantMessage([]).action).toBe('none');
    expect(guard.recordAssistantMessage([]).action).toBe('none');
  });

  it('streak resets when a different hash arrives, allowing fresh warn/halt cycles', () => {
    const guard = new LoopGuard();
    const A = [buildCall('a', { x: 1 })];
    const B = [buildCall('b', { x: 1 })];

    // First A-streak fires at length 3.
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('hash_warn');

    // A run of Bs breaks the A-streak and clears its per-streak issued flags.
    guard.recordAssistantMessage(B);
    guard.recordAssistantMessage(B);
    guard.recordAssistantMessage(B);

    // A subsequent A-streak can warn again.
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('none');
    expect(guard.recordAssistantMessage(A).action).toBe('hash_warn');
  });

  it('collapses adjacent read_file ranges so they count as the same consecutive group', () => {
    const guard = new LoopGuard();
    const actions = [0, 50, 100, 150, 199]
      .map((start) => [buildCall('read_file', { file_path: '/big.ts', start_line: start })])
      .map((g) => guard.recordAssistantMessage(g).action);

    expect(actions[0]).toBe('none');
    expect(actions[1]).toBe('none');
    expect(actions[2]).toBe('hash_warn');
    expect(actions[3]).toBe('none');
    expect(actions[4]).toBe('hash_halt');
  });

  it('snapshot exposes currentStreak and currentHash for diagnostics', () => {
    const guard = new LoopGuard();
    const A = [buildCall('a', { x: 1 })];
    const B = [buildCall('b', { x: 1 })];

    guard.recordAssistantMessage(A);
    guard.recordAssistantMessage(A);
    const snap1 = guard.snapshot();
    expect(snap1.currentStreak).toBe(2);
    expect(typeof snap1.currentHash).toBe('string');
    expect(snap1.window).toHaveLength(2);

    guard.recordAssistantMessage(B);
    const snap2 = guard.snapshot();
    expect(snap2.currentStreak).toBe(1);
    expect(snap2.currentHash).not.toBe(snap1.currentHash);
  });
});

describe('LoopGuard layer 2 — tool-name-only streak (args ignored)', () => {
  const buildCall = (name: string, input: Record<string, unknown>): ToolCallDescriptor => ({
    name,
    input,
  });

  it('reproduces the reported browser-loop scenario: same tool, different URL each time', () => {
    // The exact failure mode reported by the user: new_page called repeatedly
    // with a different target URL on every retry. messageCallsHash would never
    // repeat here because the args differ — this layer must catch it anyway.
    const guard = new LoopGuard();
    const urls = [
      'https://amazon.co.in',
      'https://amazon.in',
      'https://www.amazon.in/dp/xyz',
      'https://www.google.com/search?q=amazon+in',
      'https://amazon.in/gp/bestsellers',
      'https://www.amazon.in',
      'https://www.bitcoin.org',
    ];
    const actions = urls
      .map((url) => [buildCall('new_page', { url })])
      .map((g) => guard.recordAssistantMessage(g).action);

    expect(actions[0]).toBe('none');
    expect(actions[1]).toBe('none');
    expect(actions[2]).toBe('none');
    expect(actions[3]).toBe('name_warn');
    expect(actions[4]).toBe('none');
    expect(actions[5]).toBe('none');
    expect(actions[6]).toBe('name_halt');
  });

  it('does not fire when the hash layer already caught an identical-args streak', () => {
    // Identical args every time — the hash layer (lower thresholds) must win,
    // and the name-only layer must never also fire for the same message.
    const guard = new LoopGuard();
    const group = [buildCall('bash', { command: 'echo hi' })];
    const actions = Array.from({ length: 6 }, () => guard.recordAssistantMessage(group).action);
    expect(actions).toEqual(['none', 'none', 'hash_warn', 'none', 'hash_halt', 'none']);
    expect(actions).not.toContain('name_warn');
  });

  it('a change in the tool-name sequence resets the name-only streak', () => {
    const guard = new LoopGuard();
    const newPage = (url: string) => [buildCall('new_page', { url })];
    const listPages = [buildCall('list_pages', {})];

    expect(guard.recordAssistantMessage(newPage('https://a.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(newPage('https://b.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(newPage('https://c.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(listPages).action).toBe('none');
    // Streak restarts — needs 4 more in a row before warning again.
    expect(guard.recordAssistantMessage(newPage('https://d.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(newPage('https://e.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(newPage('https://f.com')).action).toBe('none');
    expect(guard.recordAssistantMessage(newPage('https://g.com')).action).toBe('name_warn');
  });

  it('exact duplicate calls within a varying-args streak pause rather than reset it', () => {
    const guard = new LoopGuard();
    const newPage = (url: string) => [buildCall('new_page', { url })];

    expect(guard.recordAssistantMessage(newPage('https://a.com')).action).toBe('none'); // streak=1
    expect(guard.recordAssistantMessage(newPage('https://a.com')).action).toBe('none'); // dup, owned by hash layer, streak stays 1
    expect(guard.recordAssistantMessage(newPage('https://b.com')).action).toBe('none'); // streak=2
    expect(guard.recordAssistantMessage(newPage('https://c.com')).action).toBe('none'); // streak=3
    expect(guard.recordAssistantMessage(newPage('https://d.com')).action).toBe('name_warn'); // streak=4
  });

  it('messageToolNamesKey ignores arguments entirely', () => {
    const a = messageToolNamesKey([buildCall('new_page', { url: 'https://a.com' })]);
    const b = messageToolNamesKey([buildCall('new_page', { url: 'https://b.com' })]);
    expect(a).toBe(b);
  });

  it('messageToolNamesKey distinguishes different tool sequences', () => {
    const a = messageToolNamesKey([buildCall('new_page', {}), buildCall('navigate_page', {})]);
    const b = messageToolNamesKey([buildCall('navigate_page', {}), buildCall('new_page', {})]);
    expect(a).not.toBe(b);
  });
});

describe('LoopGuard layer 3 — per-tool frequency detection', () => {
  it('per-tool counters are independent across tool names', () => {
    const guard = new LoopGuard();
    for (let i = 0; i < 29; i++) guard.recordToolInvocation('read_file');
    for (let i = 0; i < 29; i++) guard.recordToolInvocation('bash');
    expect(guard.recordToolInvocation('read_file').action).toBe('freq_warn');
    expect(guard.recordToolInvocation('bash').action).toBe('freq_warn');
  });

  it('custom thresholds via constructor are honoured', () => {
    const guard = new LoopGuard({
      toolFrequencyWarnThreshold: 2,
      toolFrequencyHaltThreshold: 3,
      toolFrequencyAbortThreshold: 4,
    });
    expect(guard.recordToolInvocation('x').action).toBe('none');
    expect(guard.recordToolInvocation('x').action).toBe('freq_warn');
    expect(guard.recordToolInvocation('x').action).toBe('freq_halt');
    expect(guard.recordToolInvocation('x').action).toBe('freq_abort');
  });
});

describe('Message builders', () => {
  it('warn / halt / abort messages all contain the count or tool name', () => {
    const warnHash = buildWarnSteerMessage({ action: 'hash_warn', reason: 'x', count: 3 });
    expect(warnHash).toContain('3');
    expect(warnHash).toContain('Loop Guard');

    const haltFreq = buildHaltSteerMessage({
      action: 'freq_halt',
      reason: 'x',
      toolName: 'bash',
      count: 50,
    });
    expect(haltFreq).toContain('bash');
    expect(haltFreq).toContain('50');
    expect(haltFreq).toContain('STOP');

    const abortHash = buildAbortUserMessage({ action: 'hash_abort', reason: 'x', count: 8 });
    expect(abortHash).toContain('8');
    expect(abortHash).toContain('Loop Guard');
    expect(abortHash).toContain('Thinking');
  });
});

describe('DEFAULT_LOOP_GUARD_CONFIG', () => {
  it('matches the documented thresholds', () => {
    expect(DEFAULT_LOOP_GUARD_CONFIG.messageHashWindow).toBe(20);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashWarnThreshold).toBe(3);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashHaltThreshold).toBe(5);
    expect(DEFAULT_LOOP_GUARD_CONFIG.duplicateHashAbortThreshold).toBe(8);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyWarnThreshold).toBe(30);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyHaltThreshold).toBe(50);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolFrequencyAbortThreshold).toBe(80);
    expect(DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize).toBe(200);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolNameStreakWarnThreshold).toBe(4);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolNameStreakHaltThreshold).toBe(7);
    expect(DEFAULT_LOOP_GUARD_CONFIG.toolNameStreakAbortThreshold).toBe(12);
  });
});
