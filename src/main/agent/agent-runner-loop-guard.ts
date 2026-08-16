/**
 * Loop guard — detects runaway tool-call loops inside a single agent turn.
 *
 * Three-layer strategy:
 *
 *   Layer 1  Hash-based group detection (consecutive streak)
 *     - Hash the entire tool-call list of each assistant message (MD5 over stable keys).
 *     - Count the *current consecutive streak* of identical hashes. Any different
 *       hash resets the streak to 1. This avoids false positives from interleaved
 *       patterns like A/B/A/B/A which are not actually loops.
 *     - The recent hashes are still retained in a sliding window (default 20 entries)
 *       for diagnostics; the window does NOT influence the streak comparison.
 *     - 3 in a row  → warn  (inject a "please stop" steering message)
 *     - 5 in a row  → halt  (inject a hard "stop now, produce text" steering message)
 *     - 8 in a row  → abort (upstream gave up listening — kill the turn)
 *
 *   Layer 2  Tool-name-only consecutive streak (ignoring arguments)
 *     - Same idea as Layer 1, but the group key is the ordered list of tool
 *       *names* only — arguments are never inspected. Catches the case Layer 1
 *       structurally cannot: the same tool (or same short sequence of tools)
 *       invoked turn after turn with *different* arguments each time (e.g. a
 *       browser-automation loop that calls new_page with a different URL on
 *       every retry — the hash differs every time because the URL differs,
 *       but the shape of what the model is doing does not).
 *     - Thresholds are lower than Layer 1's because this signal is coarser
 *       and therefore reached deliberately sooner: 4 in a row → warn,
 *       7 → halt, 12 → abort.
 *
 *   Layer 3  Per-tool frequency detection (no parameter comparison)
 *     - Tracks cumulative invocations of each tool type within the turn.
 *     - Catches cross-parameter loops such as repeatedly reading *different* files.
 *     - 30 invocations → warn
 *     - 50 invocations → halt
 *     - 80 invocations → abort
 *
 * Stable tool key generation (for hashing):
 *   - read_file            → `${tool}:${path}#bucket=${floor(startLine / 200)}`
 *                            (adjacent line ranges collapse into the same key)
 *   - write_file / str_replace / edit_file / create_file / search_replace
 *                          → `${tool}:${md5(fullArgs)}`
 *                            (any content change = distinct operation)
 *   - everything else      → `${tool}:${md5(extracted key fields)}`
 *                            where key fields = path/file_path/url/query/command/regex/pattern
 *
 * This module is **pure** — no electron, no logger, no network — so it is
 * trivially unit-testable. The host (agent-runner.ts) is responsible for
 * translating decisions into side effects (sendUserMessage steer, abort, etc.).
 */

import { createHash } from 'node:crypto';

/** Configuration knobs. All fields are required once normalised. */
export interface LoopGuardConfig {
  /** How many most-recent assistant-message hashes to retain. */
  messageHashWindow: number;
  /** Same hash appearing this many times → soft warning. */
  duplicateHashWarnThreshold: number;
  /** Same hash appearing this many times → hard halt steering. */
  duplicateHashHaltThreshold: number;
  /** Same hash appearing this many times → unilateral abort. */
  duplicateHashAbortThreshold: number;
  /** Same tool invoked this many times in the turn → soft warning. */
  toolFrequencyWarnThreshold: number;
  /** Same tool invoked this many times in the turn → hard halt steering. */
  toolFrequencyHaltThreshold: number;
  /** Same tool invoked this many times in the turn → unilateral abort. */
  toolFrequencyAbortThreshold: number;
  /** Line-number bucket width used to collapse adjacent read_file ranges. */
  readFileLineBucketSize: number;
  /** Same tool-name sequence (args ignored) repeated this many times in a row → soft warning. */
  toolNameStreakWarnThreshold: number;
  /** Same tool-name sequence (args ignored) repeated this many times in a row → hard halt steering. */
  toolNameStreakHaltThreshold: number;
  /** Same tool-name sequence (args ignored) repeated this many times in a row → unilateral abort. */
  toolNameStreakAbortThreshold: number;
  /** Consecutive user permission denials → soft warning steer message. */
  permissionDenialWarnThreshold: number;
  /** Consecutive user permission denials → unilateral abort. Denials are a much
   * stronger "stop" signal than a tool-call loop, so this fires fast. */
  permissionDenialAbortThreshold: number;
}

export const DEFAULT_LOOP_GUARD_CONFIG: LoopGuardConfig = {
  messageHashWindow: 20,
  duplicateHashWarnThreshold: 3,
  duplicateHashHaltThreshold: 5,
  duplicateHashAbortThreshold: 8,
  toolFrequencyWarnThreshold: 30,
  toolFrequencyHaltThreshold: 50,
  toolFrequencyAbortThreshold: 80,
  readFileLineBucketSize: 200,
  toolNameStreakWarnThreshold: 4,
  toolNameStreakHaltThreshold: 7,
  toolNameStreakAbortThreshold: 12,
  permissionDenialWarnThreshold: 2,
  permissionDenialAbortThreshold: 3,
};

export interface ToolCallDescriptor {
  name: string;
  input: Record<string, unknown> | undefined;
}

export type LoopGuardAction =
  | 'none'
  | 'hash_warn'
  | 'hash_halt'
  | 'hash_abort'
  | 'name_warn'
  | 'name_halt'
  | 'name_abort'
  | 'freq_warn'
  | 'freq_halt'
  | 'freq_abort'
  | 'permission_denial_warn'
  | 'permission_denial_abort';

export interface LoopGuardDecision {
  action: LoopGuardAction;
  reason: string;
  count?: number;
  toolName?: string;
  hash?: string;
  window?: number;
}

const NOOP_DECISION: LoopGuardDecision = { action: 'none', reason: 'ok' };

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Deterministic JSON — sorted keys, recursive. */
function normaliseForHash(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normaliseForHash);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) out[k] = normaliseForHash(src[k]);
  return out;
}

function md5(value: unknown): string {
  return createHash('md5')
    .update(JSON.stringify(normaliseForHash(value)))
    .digest('hex');
}

const READ_FILE_PATTERN = /\bread[-_]?file\b/i;
const WRITE_LIKE_PATTERN =
  /\b(write[-_]?file|str[-_]?replace|edit[-_]?file|create[-_]?file|search[-_]?replace|apply[-_]?patch|append[-_]?file)\b/i;

const KEY_FIELDS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'url',
  'query',
  'q',
  'command',
  'cmd',
  'regex',
  'pattern',
  'keyword',
  'keywords',
] as const;

/** Build a stable key that represents "the same logical call". */
export function stableToolKey(
  toolName: string,
  input: Record<string, unknown> | undefined,
  config: Pick<LoopGuardConfig, 'readFileLineBucketSize'> = {
    readFileLineBucketSize: DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize,
  }
): string {
  const name = toolName || 'unknown';
  if (!input || typeof input !== 'object') return `${name}:∅`;

  // read_file — bucket by line range so "read lines 1-100" and "read lines 50-150"
  // of the same file count as the same logical operation.
  if (READ_FILE_PATTERN.test(name) || name === 'read') {
    const path = pickString(input, ['file_path', 'filePath', 'path', 'file']) ?? '';
    const rawStart = pickNumber(input, ['start_line', 'startLine', 'offset', 'line']);
    const start = rawStart ?? 0;
    const bucket = Math.floor(start / Math.max(1, config.readFileLineBucketSize));
    return `${name}:${path}#bucket=${bucket}`;
  }

  // Destructive writes — any content change is a distinct op.
  if (WRITE_LIKE_PATTERN.test(name)) {
    return `${name}:${md5(input)}`;
  }

  // Generic tools — hash the subset of key fields when available, otherwise full input.
  const extracted: Record<string, unknown> = {};
  for (const k of KEY_FIELDS) {
    if (k in input) extracted[k] = (input as Record<string, unknown>)[k];
  }
  const target = Object.keys(extracted).length > 0 ? extracted : input;
  return `${name}:${md5(target)}`;
}

function pickString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

/** Hash the ordered list of stable keys for one assistant message. */
export function messageCallsHash(
  toolCalls: ToolCallDescriptor[],
  config: Pick<LoopGuardConfig, 'readFileLineBucketSize'> = {
    readFileLineBucketSize: DEFAULT_LOOP_GUARD_CONFIG.readFileLineBucketSize,
  }
): string {
  if (!toolCalls || toolCalls.length === 0) return '';
  const keys = toolCalls.map((tc) => stableToolKey(tc.name, tc.input, config));
  return md5(keys);
}

/**
 * The ordered list of tool names for one assistant message, joined into a
 * single key — arguments are deliberately never inspected. Two messages that
 * call the same tool(s) in the same order share a key even if every argument
 * differs, which is what lets the name-only streak layer catch "same move,
 * different parameters" loops that {@link messageCallsHash} cannot.
 */
export function messageToolNamesKey(toolCalls: ToolCallDescriptor[]): string {
  if (!toolCalls || toolCalls.length === 0) return '';
  return toolCalls.map((tc) => tc.name || 'unknown').join('|');
}

// ─── LoopGuard class ────────────────────────────────────────────────────────

export class LoopGuard {
  private readonly config: LoopGuardConfig;
  private readonly hashWindow: string[] = [];
  /** The hash of the most recently recorded assistant message (null = none yet). */
  private currentHash: string | null = null;
  /** Length of the current consecutive run of `currentHash`. */
  private currentStreak = 0;
  /** Whether warn/halt/abort have already been emitted for the *current* streak. */
  private streakWarnIssued = false;
  private streakHaltIssued = false;
  private streakAbortIssued = false;
  /** The tool-names-only key (args ignored) of the most recently recorded message. */
  private currentNameKey: string | null = null;
  /** Length of the current consecutive run of `currentNameKey`. */
  private currentNameStreak = 0;
  private nameStreakWarnIssued = false;
  private nameStreakHaltIssued = false;
  private nameStreakAbortIssued = false;
  private readonly toolFrequency = new Map<string, number>();
  private readonly toolWarnIssued = new Set<string>();
  private readonly toolHaltIssued = new Set<string>();
  private readonly toolAbortIssued = new Set<string>();
  /** Consecutive user permission denials. Reset to 0 on any allow. */
  private consecutiveDenials = 0;
  private denialWarnIssued = false;
  private denialAbortIssued = false;
  /**
   * Set when recordPermissionDenial() crosses the abort threshold. The
   * permission hook that calls it runs in a different closure/scope than the
   * per-turn prompt() code (installed once at session creation, invoked
   * across many turns), so it can't set prompt()'s local abortedByLoopGuard
   * flag directly — the per-turn code reads this instead, via the same
   * session-scoped LoopGuard instance, to suppress the generic "Cancelled"
   * trace overwrite the same way a pattern-based loop abort already does.
   */
  private permissionAbortTriggered = false;

  constructor(config: Partial<LoopGuardConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_GUARD_CONFIG, ...config };
  }

  /**
   * Record a complete assistant message's tool-call list and decide whether
   * to intervene. Call once per `message_end` that contains tool_use blocks.
   *
   * Decision is based on the *current consecutive streak* of identical hashes,
   * not the cumulative count over the window. Patterns like A/B/A/B never fire.
   */
  recordAssistantMessage(toolCalls: ToolCallDescriptor[]): LoopGuardDecision {
    if (!toolCalls || toolCalls.length === 0) return NOOP_DECISION;

    // Both counters are updated unconditionally, every call — never short-circuited
    // by the other layer firing. Otherwise a hash-layer decision on one call would
    // skip that call's contribution to the name streak (or vice versa), leaving the
    // two counters out of sync with the actual number of messages seen.
    const previousHash = this.currentHash;
    const hash = messageCallsHash(toolCalls, this.config);
    this.pushHash(hash);
    const hashDecision = this.evaluateHashStreak(hash);

    // The name streak only advances on calls where the arguments actually changed
    // from the previous call (hash differs). An exact repeat of the same tool +
    // args is already owned exclusively by the hash layer above, at stricter
    // thresholds — counting it here too would double-fire warnings for plain
    // identical-call loops that Layer 1 already handles on its own.
    const nameKey = messageToolNamesKey(toolCalls);
    const argsChanged = hash !== previousHash;
    this.pushNameKey(nameKey, argsChanged);
    const nameDecision = this.evaluateNameStreak(nameKey);

    // Hash-layer decisions take priority: identical args is a stronger signal
    // than "same tool names, different args," and its thresholds are lower.
    return hashDecision ?? nameDecision ?? NOOP_DECISION;
  }

  private evaluateHashStreak(hash: string): LoopGuardDecision | null {
    const count = this.currentStreak;

    if (count >= this.config.duplicateHashAbortThreshold && !this.streakAbortIssued) {
      this.streakAbortIssued = true;
      return this.mkDecision(
        'hash_abort',
        `identical tool-call group repeated ${count} times in a row`,
        {
          count,
          hash,
          window: this.config.messageHashWindow,
        }
      );
    }
    if (count >= this.config.duplicateHashHaltThreshold && !this.streakHaltIssued) {
      this.streakHaltIssued = true;
      return this.mkDecision(
        'hash_halt',
        `identical tool-call group repeated ${count} times in a row`,
        {
          count,
          hash,
          window: this.config.messageHashWindow,
        }
      );
    }
    if (count >= this.config.duplicateHashWarnThreshold && !this.streakWarnIssued) {
      this.streakWarnIssued = true;
      return this.mkDecision(
        'hash_warn',
        `identical tool-call group repeated ${count} times in a row`,
        {
          count,
          hash,
          window: this.config.messageHashWindow,
        }
      );
    }
    return null;
  }

  private evaluateNameStreak(nameKey: string): LoopGuardDecision | null {
    const nameCount = this.currentNameStreak;

    if (nameCount >= this.config.toolNameStreakAbortThreshold && !this.nameStreakAbortIssued) {
      this.nameStreakAbortIssued = true;
      return this.mkDecision(
        'name_abort',
        `same tool(s) "${nameKey}" invoked ${nameCount} times in a row with varying arguments`,
        { count: nameCount, toolName: nameKey }
      );
    }
    if (nameCount >= this.config.toolNameStreakHaltThreshold && !this.nameStreakHaltIssued) {
      this.nameStreakHaltIssued = true;
      return this.mkDecision(
        'name_halt',
        `same tool(s) "${nameKey}" invoked ${nameCount} times in a row with varying arguments`,
        { count: nameCount, toolName: nameKey }
      );
    }
    if (nameCount >= this.config.toolNameStreakWarnThreshold && !this.nameStreakWarnIssued) {
      this.nameStreakWarnIssued = true;
      return this.mkDecision(
        'name_warn',
        `same tool(s) "${nameKey}" invoked ${nameCount} times in a row with varying arguments`,
        { count: nameCount, toolName: nameKey }
      );
    }
    return null;
  }

  /**
   * Record a single tool invocation start and decide whether the per-tool
   * frequency limit is tripped. Call once per `tool_execution_start`.
   */
  recordToolInvocation(toolName: string): LoopGuardDecision {
    const name = toolName || 'unknown';
    const count = (this.toolFrequency.get(name) ?? 0) + 1;
    this.toolFrequency.set(name, count);

    if (count >= this.config.toolFrequencyAbortThreshold && !this.toolAbortIssued.has(name)) {
      this.toolAbortIssued.add(name);
      return this.mkDecision('freq_abort', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    if (count >= this.config.toolFrequencyHaltThreshold && !this.toolHaltIssued.has(name)) {
      this.toolHaltIssued.add(name);
      return this.mkDecision('freq_halt', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    if (count >= this.config.toolFrequencyWarnThreshold && !this.toolWarnIssued.has(name)) {
      this.toolWarnIssued.add(name);
      return this.mkDecision('freq_warn', `tool "${name}" invoked ${count} times in this turn`, {
        count,
        toolName: name,
      });
    }
    return NOOP_DECISION;
  }

  /**
   * Record that the user denied a tool-call permission request. Call once per
   * denial, regardless of which tool was denied — repeatedly denying *different*
   * tools is just as strong a "stop asking" signal as denying the same one.
   * Thresholds are deliberately low (default warn=2, abort=3): a denial is an
   * explicit, unambiguous user action, not an inferred pattern like a tool loop.
   */
  recordPermissionDenial(): LoopGuardDecision {
    this.consecutiveDenials += 1;
    const count = this.consecutiveDenials;

    if (count >= this.config.permissionDenialAbortThreshold && !this.denialAbortIssued) {
      this.denialAbortIssued = true;
      this.permissionAbortTriggered = true;
      return this.mkDecision(
        'permission_denial_abort',
        `user denied ${count} tool-call permission requests in a row`,
        { count }
      );
    }
    if (count >= this.config.permissionDenialWarnThreshold && !this.denialWarnIssued) {
      this.denialWarnIssued = true;
      return this.mkDecision(
        'permission_denial_warn',
        `user denied ${count} tool-call permission requests in a row`,
        { count }
      );
    }
    return NOOP_DECISION;
  }

  /** Reset the denial streak — call when a tool call is allowed. */
  recordPermissionAllow(): void {
    this.consecutiveDenials = 0;
    this.denialWarnIssued = false;
    this.denialAbortIssued = false;
  }

  /** Whether recordPermissionDenial() has triggered an abort. See field doc above. */
  wasAbortedByPermissionDenial(): boolean {
    return this.permissionAbortTriggered;
  }

  /** Expose raw counters for diagnostics / testing. */
  snapshot(): {
    currentHash: string | null;
    currentStreak: number;
    currentNameKey: string | null;
    currentNameStreak: number;
    toolFrequency: Record<string, number>;
    window: string[];
  } {
    return {
      currentHash: this.currentHash,
      currentStreak: this.currentStreak,
      currentNameKey: this.currentNameKey,
      currentNameStreak: this.currentNameStreak,
      toolFrequency: Object.fromEntries(this.toolFrequency),
      window: [...this.hashWindow],
    };
  }

  private pushNameKey(nameKey: string, argsChanged: boolean): void {
    if (nameKey === this.currentNameKey) {
      if (argsChanged) {
        this.currentNameStreak += 1;
      }
      // else: exact duplicate of the previous call — already owned by the hash
      // layer, so leave the name streak where it is rather than double-counting.
    } else {
      this.currentNameKey = nameKey;
      this.currentNameStreak = 1;
      this.nameStreakWarnIssued = false;
      this.nameStreakHaltIssued = false;
      this.nameStreakAbortIssued = false;
    }
  }

  private pushHash(hash: string): void {
    // Maintain a small sliding window purely for diagnostics. The window
    // length does not influence streak comparison.
    this.hashWindow.push(hash);
    while (this.hashWindow.length > this.config.messageHashWindow) {
      this.hashWindow.shift();
    }

    // Streak bookkeeping: only consecutive identical hashes count toward the
    // duplicate-hash thresholds. A different hash resets the streak to 1 and
    // clears the per-streak issued flags so the new streak can warn/halt/abort
    // on its own merits.
    if (hash === this.currentHash) {
      this.currentStreak += 1;
    } else {
      this.currentHash = hash;
      this.currentStreak = 1;
      this.streakWarnIssued = false;
      this.streakHaltIssued = false;
      this.streakAbortIssued = false;
    }
  }

  private mkDecision(
    action: LoopGuardAction,
    reason: string,
    details: Partial<Pick<LoopGuardDecision, 'count' | 'toolName' | 'hash' | 'window'>>
  ): LoopGuardDecision {
    return { action, reason, ...details };
  }
}

// ─── Human-facing message builders ──────────────────────────────────────────

export const LOOP_GUARD_GUIDANCE =
  '\n\n**Suggestions:**\n' +
  '- Enable "Thinking" mode in settings and retry, especially for models like gemini-3.1-pro that tend to fall into empty loops when thinking is disabled\n' +
  '- Switch to a model with built-in reasoning capabilities (e.g., claude-sonnet-4-6)\n' +
  '- Break complex tasks into smaller subtasks and send them separately';

/** Steering message injected to the model when warn threshold is crossed. */
export function buildWarnSteerMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_warn') {
    return (
      `[Loop Guard · Warning] You have executed the same group of tool calls ${decision.count} times in a row.\n` +
      'Please stop the repetitive calls. Based on the information you have already collected, try to provide an interim text conclusion, or change your strategy (use different tools / adjust parameters / break into subtasks).'
    );
  }
  if (decision.action === 'freq_warn') {
    return (
      `[Loop Guard · Warning] The tool "${decision.toolName}" has been invoked ${decision.count} times in this turn.\n` +
      'Please assess whether the information you have is sufficient to answer. If so, output a text conclusion directly; if not, use a different tool or more precise parameters.'
    );
  }
  if (decision.action === 'name_warn') {
    return (
      `[Loop Guard · Warning] You have called "${decision.toolName}" ${decision.count} times in a row, each time with different arguments.\n` +
      'Changing the arguments each time does not avoid the loop. Please reassess your approach — reuse the result of a prior call, or stop and explain to the user what is blocking progress.'
    );
  }
  if (decision.action === 'permission_denial_warn') {
    return (
      `[Loop Guard · Warning] The user has denied ${decision.count} tool-call permission requests in a row.\n` +
      'Stop proposing new tool calls. Ask the user directly, in plain text, what they actually want you to do instead.'
    );
  }
  return '[Loop Guard · Warning]';
}

/** Steering message injected when halt threshold is crossed (stronger). */
export function buildHaltSteerMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_halt') {
    return (
      `[Loop Guard · STOP] Identical tool-call group has now repeated ${decision.count} times — this is a loop.\n` +
      '**STOP all tool calls immediately. You must output the final conclusion in plain text based on the information you have already collected. Do not make any further tool calls.**'
    );
  }
  if (decision.action === 'freq_halt') {
    return (
      `[Loop Guard · STOP] The tool "${decision.toolName}" has been invoked ${decision.count} times — this is a loop.\n` +
      '**STOP all tool calls immediately. You must output the final conclusion in plain text based on the information you have already collected. Do not make any further tool calls.**'
    );
  }
  if (decision.action === 'name_halt') {
    return (
      `[Loop Guard · STOP] "${decision.toolName}" has now been called ${decision.count} times in a row with varying arguments — this is a loop.\n` +
      '**STOP all tool calls immediately. You must output the final conclusion in plain text based on the information you have already collected. Do not make any further tool calls.**'
    );
  }
  return '[Loop Guard · STOP]';
}

/** Final message sent to the user when we unilaterally abort. */
export function buildAbortUserMessage(decision: LoopGuardDecision): string {
  if (decision.action === 'hash_abort') {
    return (
      `**Loop Guard: The model continued to repeat the same group of tool calls ${decision.count} times even after receiving stop instructions. Session forcibly terminated.**` +
      LOOP_GUARD_GUIDANCE
    );
  }
  if (decision.action === 'freq_abort') {
    return (
      `**Loop Guard: Tool "${decision.toolName}" has been invoked ${decision.count} times in this turn, far exceeding reasonable limits. Session forcibly terminated.**` +
      LOOP_GUARD_GUIDANCE
    );
  }
  if (decision.action === 'name_abort') {
    return (
      `**Loop Guard: The model continued calling "${decision.toolName}" ${decision.count} times in a row with varying arguments, even after receiving stop instructions. Session forcibly terminated.**` +
      LOOP_GUARD_GUIDANCE
    );
  }
  if (decision.action === 'permission_denial_abort') {
    return (
      `**Stopped: you denied ${decision.count} tool-call requests in a row, so I stopped trying.**\n\n` +
      "Tell me what you'd actually like me to do — for example, a specific site to open, or say " +
      '"just chat, no tools" if you want a text-only answer.'
    );
  }
  return (
    '**Loop Guard: Tool-call loop detected. Session forcibly terminated.**' + LOOP_GUARD_GUIDANCE
  );
}
