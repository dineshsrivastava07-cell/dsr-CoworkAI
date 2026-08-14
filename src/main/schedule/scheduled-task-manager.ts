/**
 * @module main/schedule/scheduled-task-manager
 *
 * Cron-like scheduled task system (488 lines).
 *
 * Responsibilities:
 * - Scheduled task CRUD with daily/weekly/interval repeat modes
 * - Timer-based execution engine with tick loop
 * - Task persistence via SQLite (ScheduledTask rows)
 * - Delegates execution to session-manager for AI-powered tasks
 *
 * Dependencies: session-manager, database
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../../shared/schedule/task-title';
import { log, logError } from '../utils/logger';

const execFileAsync = promisify(execFile);

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduledTaskWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ──────────────── Reactive scheduling (watch tasks) ──────────────────────────────
// A watch task polls a condition (HTTP response / shell command output) on
// `pollIntervalMs` and only starts a real agent session when the condition's
// state actually changes, instead of firing unconditionally on a clock.

export type WatchCheckType = 'http' | 'command';

export interface WatchHttpCheckConfig {
  url: string;
  method?: 'GET' | 'HEAD';
}

export interface WatchCommandCheckConfig {
  command: string;
  args?: string[];
}

export interface WatchConfig {
  checkType: WatchCheckType;
  http?: WatchHttpCheckConfig;
  command?: WatchCommandCheckConfig;
  /** How often to re-check when unchanged. Floored at MIN_POLL_INTERVAL_MS to prevent abuse. */
  pollIntervalMs: number;
}

export interface CheckConditionResult {
  changed: boolean;
  /** Opaque serialized state used to diff against the next check. */
  state: string;
}

export type CheckConditionFn = (task: ScheduledTask) => Promise<CheckConditionResult>;

const MIN_POLL_INTERVAL_MS = 60_000;

export interface ScheduledTaskDailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface ScheduledTaskWeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduledTaskWeekday[];
  times: string[];
}

export type ScheduledTaskScheduleConfig =
  | ScheduledTaskDailyScheduleConfig
  | ScheduledTaskWeeklyScheduleConfig;

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduledTaskScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  watchConfig: WatchConfig | null;
  lastCheckedState: string | null;
  lastCheckedAt: number | null;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  watchConfig?: WatchConfig | null;
}

export interface ScheduledTaskUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  watchConfig?: WatchConfig | null;
  lastCheckedState?: string | null;
  lastCheckedAt?: number | null;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

export interface ScheduledTaskStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskCreateInput): ScheduledTask;
  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null;
  delete(id: string): boolean;
}

export interface ScheduledTaskRunResult {
  sessionId: string;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ScheduledTaskExecutionRecord {
  success: boolean;
  sessionId?: string;
  error?: string;
}

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore;
  executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  onTaskError?: (taskId: string, error: string) => void;
  now?: () => number;
  /** Injectable for tests; defaults to defaultCheckCondition (real HTTP/command checks). */
  checkCondition?: CheckConditionFn;
}

export class ScheduledTaskManager {
  private readonly store: ScheduledTaskStore;
  private readonly executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  private readonly onTaskError?: (taskId: string, error: string) => void;
  private readonly now: () => number;
  private readonly checkCondition: CheckConditionFn;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly executingTasks = new Set<string>();
  private running = false;

  constructor(options: ScheduledTaskManagerOptions) {
    this.store = options.store;
    this.executeTask = options.executeTask;
    this.onTaskError = options.onTaskError;
    this.now = options.now ?? (() => Date.now());
    this.checkCondition = options.checkCondition ?? defaultCheckCondition;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tasks = this.store.list();
    for (const task of tasks) {
      this.scheduleTask(task);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  list(): ScheduledTask[] {
    return this.store.list().sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      const aNextRun = a.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNextRun = b.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      if (aNextRun !== bNextRun) {
        return aNextRun - bNextRun;
      }
      return b.createdAt - a.createdAt;
    });
  }

  get(id: string): ScheduledTask | null {
    return this.store.get(id);
  }

  create(input: ScheduledTaskCreateInput): ScheduledTask {
    const normalizedPrompt = input.prompt.trim();
    const normalizedTitle = input.title
      ? buildScheduledTaskTitle(input.title)
      : buildScheduledTaskFallbackTitle(normalizedPrompt);
    const normalizedScheduleConfig = normalizeScheduleConfig(input.scheduleConfig);
    const normalizedWatchConfig = normalizeWatchConfig(input.watchConfig);
    const usesCustomTrigger = Boolean(normalizedScheduleConfig || normalizedWatchConfig);
    const normalizedRepeatEvery = usesCustomTrigger
      ? null
      : normalizeRepeatEvery(input.repeatEvery);
    const normalizedRepeatUnit =
      usesCustomTrigger || normalizedRepeatEvery === null
        ? null
        : normalizeRepeatUnit(input.repeatUnit);
    const created = this.store.create({
      ...input,
      title: normalizedTitle,
      prompt: normalizedPrompt,
      scheduleConfig: normalizedScheduleConfig,
      watchConfig: normalizedWatchConfig,
      nextRunAt: input.nextRunAt ?? input.runAt,
      enabled: input.enabled ?? true,
      repeatEvery: normalizedRepeatEvery,
      repeatUnit: normalizedRepeatUnit,
    });
    this.scheduleTask(created);
    return created;
  }

  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    const nextPrompt = updates.prompt === undefined ? current.prompt : updates.prompt.trim();
    const nextTitle =
      updates.title === undefined
        ? current.title
        : buildScheduledTaskTitle(updates.title || nextPrompt);
    const nextScheduleConfig =
      updates.scheduleConfig === undefined
        ? undefined
        : normalizeScheduleConfig(updates.scheduleConfig);
    const nextWatchConfig =
      updates.watchConfig === undefined ? undefined : normalizeWatchConfig(updates.watchConfig);
    const usesScheduleConfig =
      nextScheduleConfig !== undefined
        ? nextScheduleConfig !== null
        : current.scheduleConfig !== null;
    const usesWatchConfig =
      nextWatchConfig !== undefined ? nextWatchConfig !== null : current.watchConfig !== null;
    const usesCustomTrigger = usesScheduleConfig || usesWatchConfig;
    const nextRepeatEvery = usesCustomTrigger
      ? null
      : updates.repeatEvery === undefined
        ? undefined
        : normalizeRepeatEvery(updates.repeatEvery);
    let nextRepeatUnit = usesCustomTrigger
      ? null
      : updates.repeatUnit === undefined
        ? undefined
        : normalizeRepeatUnit(updates.repeatUnit);
    if (!usesCustomTrigger && nextRepeatEvery !== undefined && nextRepeatEvery === null) {
      nextRepeatUnit = null;
    }
    const updated = this.store.update(id, {
      ...updates,
      prompt: nextPrompt,
      title: nextTitle,
      scheduleConfig: nextScheduleConfig,
      watchConfig: nextWatchConfig,
      repeatEvery: nextRepeatEvery,
      repeatUnit: nextRepeatUnit,
    });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  delete(id: string): boolean {
    this.clearTimer(id);
    return this.store.delete(id);
  }

  toggle(id: string, enabled: boolean): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    if (enabled && !isRepeatingTask(current)) {
      const oneTimeRunAt = current.nextRunAt ?? current.runAt;
      if (oneTimeRunAt <= this.now()) {
        throw new Error('Cannot enable: one-time task is overdue. Edit the schedule first.');
      }
    }
    const nextRunAt = enabled ? this.computeToggleNextRunAt(current) : null;
    const updated = this.store.update(id, { enabled, nextRunAt });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  async runNow(id: string): Promise<ScheduledTask | null> {
    const task = this.store.get(id);
    if (!task) return null;
    if (this.executingTasks.has(id)) {
      throw new Error('Task is already executing');
    }
    this.executingTasks.add(id);
    const taskToExecute = this.prepareExecution(task);
    try {
      const execution = await this.executeAndRecord(taskToExecute);
      if (!execution.success) {
        throw new Error(execution.error ?? 'Scheduled task execution failed');
      }
    } finally {
      this.executingTasks.delete(id);
    }
    return this.store.get(id);
  }

  private scheduleTask(task: ScheduledTask): void {
    this.clearTimer(task.id);
    if (!this.running) return;
    if (!task.enabled) return;
    if (task.nextRunAt === null) return;
    const delay = Math.max(0, task.nextRunAt - this.now());
    const effectiveDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
    if (effectiveDelay < delay) {
      log('[Scheduler] Delay clamped to max for task:', task.id);
    }
    const timer = setTimeout(() => {
      this.handleTrigger(task.id);
    }, effectiveDelay);
    this.timers.set(task.id, timer);
  }

  private handleTrigger(taskId: string): void {
    this.timers.delete(taskId);
    const task = this.store.get(taskId);
    if (!task || !task.enabled) return;
    if (task.nextRunAt === null) return;
    if (task.nextRunAt > this.now()) {
      this.scheduleTask(task);
      return;
    }
    if (this.executingTasks.has(taskId)) {
      return;
    }

    if (task.watchConfig) {
      this.executingTasks.add(taskId);
      this.runWatchCheck(task).finally(() => {
        this.executingTasks.delete(taskId);
      });
      return;
    }

    this.executingTasks.add(taskId);
    const taskToExecute = this.prepareExecution(task);
    this.executeAndRecord(taskToExecute)
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        try {
          this.store.update(taskToExecute.id, {
            lastRunAt: this.now(),
            lastRunSessionId: null,
            lastError: errorMessage,
          });
        } catch (updateError) {
          logError(
            '[ScheduledTaskManager] Failed to update store after unhandled error:',
            updateError
          );
        }
        this.onTaskError?.(taskToExecute.id, errorMessage);
        logError(`[ScheduledTask] Unhandled error executing task ${taskToExecute.id}:`, err);
      })
      .finally(() => {
        this.executingTasks.delete(taskId);
      });
  }

  /**
   * Check-then-act pipeline for watch tasks: evaluate the condition first,
   * and only start a real agent session (via the normal executeAndRecord
   * path) when the observed state actually changed. Always reschedules the
   * next check at pollIntervalMs regardless of outcome — watch tasks never
   * self-disable the way one-time tasks do.
   */
  private async runWatchCheck(task: ScheduledTask): Promise<void> {
    const watchConfig = task.watchConfig;
    if (!watchConfig) return;
    const nextCheckAt = this.now() + watchConfig.pollIntervalMs;

    let result: CheckConditionResult;
    try {
      result = await this.checkCondition(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = this.store.update(task.id, {
        nextRunAt: nextCheckAt,
        lastCheckedAt: this.now(),
        lastError: message,
      });
      if (updated) this.scheduleTask(updated);
      this.onTaskError?.(task.id, message);
      logError(`[ScheduledTask] Watch check failed for task ${task.id}:`, error);
      return;
    }

    const afterCheck = this.store.update(task.id, {
      nextRunAt: nextCheckAt,
      lastCheckedAt: this.now(),
      lastCheckedState: result.state,
      lastError: null,
    });
    if (!afterCheck) return;

    if (!result.changed) {
      this.scheduleTask(afterCheck);
      return;
    }

    // Condition changed — fire the underlying task through the normal execution
    // path (records lastRunAt/lastRunSessionId/lastError), then re-arm the timer
    // using the nextRunAt we already set above.
    try {
      const execution = await this.executeAndRecord(afterCheck);
      if (!execution.success) {
        this.onTaskError?.(task.id, execution.error ?? 'Watch task execution failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onTaskError?.(task.id, message);
      logError(`[ScheduledTask] Unhandled error executing watch task ${task.id}:`, error);
    } finally {
      const finalTask = this.store.get(task.id);
      if (finalTask) this.scheduleTask(finalTask);
    }
  }

  private prepareExecution(task: ScheduledTask): ScheduledTask {
    this.clearTimer(task.id);

    if (!task.enabled) {
      return task;
    }

    if (isRepeatingTask(task)) {
      const nextRunAt = computeNextRunAt(task, this.now());
      if (nextRunAt !== null) {
        const updated = this.store.update(task.id, {
          nextRunAt,
          enabled: true,
        });
        if (updated) {
          this.scheduleTask(updated);
          return updated;
        }
      }
    }

    return (
      this.store.update(task.id, {
        enabled: false,
        nextRunAt: null,
      }) ?? task
    );
  }

  private computeToggleNextRunAt(task: ScheduledTask): number {
    const now = this.now();
    if (isRepeatingTask(task)) {
      const nextRunAt = computeNextRunAt(task, now);
      if (nextRunAt !== null) {
        return nextRunAt;
      }
    }
    const base = task.nextRunAt ?? task.runAt ?? now;
    return Math.max(base, now);
  }

  private async executeAndRecord(task: ScheduledTask): Promise<ScheduledTaskExecutionRecord> {
    try {
      const result = await this.executeTask(task);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: result.sessionId,
          lastError: null,
        });
      } catch (error) {
        logError('[ScheduledTaskManager] Failed to update store:', error);
      }
      return { success: true, sessionId: result.sessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: null,
          lastError: message,
        });
      } catch (updateError) {
        logError('[ScheduledTaskManager] Failed to update store:', updateError);
      }
      this.onTaskError?.(task.id, message);
      return { success: false, error: message };
    }
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }
}

function normalizeRepeatEvery(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (normalized <= 0) return null;
  return normalized;
}

function normalizeRepeatUnit(
  value: ScheduleRepeatUnit | null | undefined
): ScheduleRepeatUnit | null {
  if (value === 'minute' || value === 'hour' || value === 'day') {
    return value;
  }
  return null;
}

function normalizeScheduleConfig(
  value: ScheduledTaskScheduleConfig | null | undefined
): ScheduledTaskScheduleConfig | null {
  if (!value) {
    return null;
  }
  if (value.kind === 'daily') {
    const times = normalizeScheduleTimes(value.times);
    if (times.length === 0) {
      return null;
    }
    return { kind: 'daily', times };
  }
  if (value.kind === 'weekly') {
    const times = normalizeScheduleTimes(value.times);
    const weekdays = normalizeWeekdays(value.weekdays);
    if (times.length === 0 || weekdays.length === 0) {
      return null;
    }
    return { kind: 'weekly', weekdays, times };
  }
  return null;
}

function isRepeatingTask(task: ScheduledTask): boolean {
  return (
    task.watchConfig !== null ||
    task.scheduleConfig !== null ||
    Boolean(task.repeatEvery && task.repeatUnit)
  );
}

function computeNextRunAt(task: ScheduledTask, now: number): number | null {
  if (task.watchConfig) {
    return now + task.watchConfig.pollIntervalMs;
  }
  if (task.scheduleConfig) {
    return computeNextRunAtFromScheduleConfig(task.scheduleConfig, now);
  }
  const intervalMs = getIntervalMs(task.repeatEvery, task.repeatUnit);
  if (intervalMs === null) return null;
  const nextBase = task.nextRunAt ?? task.runAt;
  if (!Number.isFinite(nextBase)) return null;
  if (nextBase > now) return nextBase;
  const skippedIntervals = Math.floor((now - nextBase) / intervalMs) + 1;
  return nextBase + skippedIntervals * intervalMs;
}

function normalizeWatchConfig(value: WatchConfig | null | undefined): WatchConfig | null {
  if (!value) {
    return null;
  }
  const pollIntervalMs = Number.isFinite(value.pollIntervalMs)
    ? Math.max(MIN_POLL_INTERVAL_MS, Math.floor(value.pollIntervalMs))
    : MIN_POLL_INTERVAL_MS;

  if (value.checkType === 'http') {
    const url = value.http?.url?.trim();
    if (!url) return null;
    return {
      checkType: 'http',
      http: { url, method: value.http?.method === 'HEAD' ? 'HEAD' : 'GET' },
      pollIntervalMs,
    };
  }
  if (value.checkType === 'command') {
    const command = value.command?.command?.trim();
    if (!command) return null;
    return {
      checkType: 'command',
      command: {
        command,
        args: Array.isArray(value.command?.args) ? value.command.args.filter(Boolean) : [],
      },
      pollIntervalMs,
    };
  }
  return null;
}

/**
 * Default (real) condition checker: HTTP status+body hash, or shell command
 * exit-code+stdout hash. First-ever check for a task (lastCheckedState is
 * null) always reports changed:false — it only establishes a baseline, so
 * creating a watch task doesn't immediately fire it.
 */
export async function defaultCheckCondition(task: ScheduledTask): Promise<CheckConditionResult> {
  const watchConfig = task.watchConfig;
  if (!watchConfig) {
    throw new Error(`Task ${task.id} has no watchConfig`);
  }
  const state =
    watchConfig.checkType === 'http'
      ? await computeHttpCheckState(watchConfig.http!)
      : await computeCommandCheckState(watchConfig.command!);
  const changed = task.lastCheckedState !== null && task.lastCheckedState !== state;
  return { changed, state };
}

async function computeHttpCheckState(config: WatchHttpCheckConfig): Promise<string> {
  const response = await fetch(config.url, {
    method: config.method ?? 'GET',
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  const hash = createHash('sha256').update(body).digest('hex');
  return `status:${response.status}|hash:${hash}`;
}

async function computeCommandCheckState(config: WatchCommandCheckConfig): Promise<string> {
  try {
    const { stdout } = await execFileAsync(config.command, config.args ?? [], { timeout: 30000 });
    const hash = createHash('sha256')
      .update(typeof stdout === 'string' ? stdout : '')
      .digest('hex');
    return `exit:0|hash:${hash}`;
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string };
    const hash = createHash('sha256')
      .update(typeof err.stdout === 'string' ? err.stdout : '')
      .digest('hex');
    return `exit:${err.code ?? 'unknown'}|hash:${hash}`;
  }
}

function getIntervalMs(
  repeatEvery: number | null,
  repeatUnit: ScheduleRepeatUnit | null
): number | null {
  if (!repeatEvery || !repeatUnit) return null;
  if (repeatUnit === 'minute') return repeatEvery * 60 * 1000;
  if (repeatUnit === 'hour') return repeatEvery * 60 * 60 * 1000;
  return repeatEvery * 24 * 60 * 60 * 1000;
}

function normalizeScheduleTimes(times: string[]): string[] {
  if (!Array.isArray(times)) {
    return [];
  }
  const validTimes = Array.from(
    new Set(times.filter((time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)))
  );
  return validTimes.sort((left, right) => compareTimeStrings(left, right));
}

function normalizeWeekdays(days: number[]): ScheduledTaskWeekday[] {
  if (!Array.isArray(days)) {
    return [];
  }
  const normalized = Array.from(
    new Set(
      days.filter(
        (day): day is ScheduledTaskWeekday => Number.isInteger(day) && day >= 0 && day <= 6
      )
    )
  );
  return normalized.sort((left, right) => left - right);
}

function compareTimeStrings(left: string, right: string): number {
  return toTimeMinutes(left) - toTimeMinutes(right);
}

function toTimeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function computeNextRunAtFromScheduleConfig(
  scheduleConfig: ScheduledTaskScheduleConfig,
  now: number
): number | null {
  if (scheduleConfig.kind === 'daily') {
    return findNextScheduledSlot(now, scheduleConfig.times);
  }
  return findNextScheduledSlot(now, scheduleConfig.times, scheduleConfig.weekdays);
}

function findNextScheduledSlot(
  now: number,
  times: string[],
  weekdays?: ScheduledTaskWeekday[]
): number | null {
  const normalizedTimes = normalizeScheduleTimes(times);
  if (normalizedTimes.length === 0) {
    return null;
  }
  const allowedWeekdays = weekdays ? new Set(normalizeWeekdays(weekdays)) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduledTaskWeekday)) {
      continue;
    }
    for (const time of normalizedTimes) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}
