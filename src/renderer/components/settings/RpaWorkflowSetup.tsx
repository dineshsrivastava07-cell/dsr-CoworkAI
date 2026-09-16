import { useEffect, useState } from 'react';
import { useIPC } from '../../hooks/useIPC';
import { useAppStore } from '../../store';
import {
  buildRpaAutonomousRunPrompt,
  buildRpaWorkflowPrompt,
  type RpaWorkflowBrief,
  type SavedRpaWorkflowConfiguration,
} from '../../../shared/rpa-workflow';
import type { ContentBlock, ScheduleCreateInput } from '../../types';
import { RpaProcessStudio } from './RpaProcessStudio';

const inputClass =
  'w-full px-3 py-2 mt-1 rounded bg-background border border-border text-sm text-text-primary';
const emptyBrief: RpaWorkflowBrief = {
  name: '',
  surface: 'desktop',
  application: '',
  inputs: '',
  steps: '',
  successCheck: '',
  executionMode: 'ui',
  trigger: 'manual',
  credentialProfile: '',
  scheduleAt: '',
  scheduleTimes: [],
  scheduleWeekdays: [],
  repeatEvery: 1,
  repeatUnit: 'hour',
  watchUrl: '',
  definedSteps: [],
  referenceScreenshots: [],
};

function savedWorkflowToBrief(workflow: SavedRpaWorkflowConfiguration): RpaWorkflowBrief {
  const legacyTimestamp = workflow.scheduleAt ? new Date(workflow.scheduleAt).getTime() : NaN;
  const legacyTime = Number.isFinite(legacyTimestamp)
    ? new Date(legacyTimestamp).toTimeString().slice(0, 5)
    : null;
  return {
    name: workflow.name,
    surface: workflow.surface,
    application: workflow.application,
    inputs: workflow.inputs,
    steps: workflow.steps,
    successCheck: workflow.successCheck,
    executionMode: workflow.executionMode,
    trigger: workflow.trigger === 'schedule' ? 'daily' : workflow.trigger,
    credentialProfile: workflow.credentialProfile,
    scheduleAt: workflow.scheduleAt,
    scheduleTimes: workflow.scheduleTimes?.length
      ? workflow.scheduleTimes
      : legacyTime
        ? [legacyTime]
        : [],
    scheduleWeekdays: workflow.scheduleWeekdays,
    repeatEvery: workflow.repeatEvery,
    repeatUnit: workflow.repeatUnit,
    watchUrl: workflow.watchUrl,
    definedSteps: workflow.definedSteps,
    referenceScreenshots: workflow.referenceScreenshots,
  };
}

function nextScheduleSlot(times: string[], weekdays?: number[]): number {
  const allowedDays = weekdays ? new Set(weekdays) : null;
  const now = new Date();
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (allowedDays && !allowedDays.has(day.getDay())) continue;
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > Date.now()) return candidate;
    }
  }
  throw new Error('Could not calculate the next scheduled run.');
}

export function getRpaAutonomousReadinessIssues(
  brief: RpaWorkflowBrief,
  options: {
    connected: boolean;
    configured: boolean;
    recipeNames: string[];
    now?: number;
  }
): string[] {
  const issues: string[] = [];
  const now = options.now ?? Date.now();
  if (!options.connected) issues.push('Enable and connect RPA.');
  if (!options.configured) issues.push('Configure an AI provider and model.');
  if (
    ![brief.name, brief.application, brief.steps, brief.successCheck].every((value) => value.trim())
  ) {
    issues.push('Complete the workflow name, application, business steps and success check.');
  }
  if (brief.executionMode === 'headless') {
    issues.push('Desktop recipes require UI or Background execution mode.');
  }
  const recipeExists = options.recipeNames.some(
    (name) => name.toLowerCase() === brief.name.trim().toLowerCase()
  );
  if (!recipeExists && (brief.definedSteps?.length || 0) === 0) {
    issues.push('Add at least one Process Studio step or finish and save a guided recording.');
  }
  if (!brief.trigger || brief.trigger === 'manual') {
    issues.push('Choose an autonomous trigger.');
  } else if (brief.trigger === 'once') {
    const runAt = brief.scheduleAt ? new Date(brief.scheduleAt).getTime() : NaN;
    if (!Number.isFinite(runAt) || runAt <= now) issues.push('Choose a future one-time run.');
  } else if (brief.trigger === 'daily' && (brief.scheduleTimes?.length || 0) === 0) {
    issues.push('Add at least one daily time slot.');
  } else if (brief.trigger === 'weekly') {
    if ((brief.scheduleWeekdays?.length || 0) === 0) issues.push('Select at least one weekday.');
    if ((brief.scheduleTimes?.length || 0) === 0) issues.push('Add at least one weekly time slot.');
  } else if (brief.trigger === 'interval') {
    const firstRun = brief.scheduleAt ? new Date(brief.scheduleAt).getTime() : null;
    if (firstRun !== null && (!Number.isFinite(firstRun) || firstRun <= now)) {
      issues.push('Choose a future first run or leave it blank to start in five minutes.');
    }
    if (!Number.isFinite(brief.repeatEvery) || (brief.repeatEvery || 0) < 1) {
      issues.push('Repeat interval must be at least 1.');
    }
  } else if (brief.trigger === 'watch' && !brief.watchUrl?.trim()) {
    issues.push('Enter the HTTP trigger URL.');
  }
  return issues;
}

function toLocalDateTimeMinimum(timestamp: number): string {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

export function RpaWorkflowSetup({ connected }: { connected: boolean }) {
  const { startSession } = useIPC();
  const configured = useAppStore((state) => state.isConfigured);
  const workingDir = useAppStore((state) => state.workingDir);
  const [brief, setBrief] = useState<RpaWorkflowBrief>(emptyBrief);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedRpaWorkflowConfiguration[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [recipeNames, setRecipeNames] = useState<string[]>([]);
  const [clockNow, setClockNow] = useState(Date.now());

  const readinessIssues = getRpaAutonomousReadinessIssues(brief, {
    connected,
    configured,
    recipeNames,
    now: clockNow,
  });

  useEffect(() => {
    let active = true;
    void window.electronAPI.rpaWorkflows
      .list()
      .then((workflows) => {
        if (active) setSavedWorkflows(workflows);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load saved workflows.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  function change(key: keyof RpaWorkflowBrief, value: RpaWorkflowBrief[keyof RpaWorkflowBrief]) {
    setBrief({ ...brief, [key]: value });
    if (key === 'name' && String(value || '').trim() !== selectedWorkflow) setSelectedWorkflow('');
    setDraft('');
    setCopied(false);
    setError('');
    setStatus('');
  }

  function selectSavedWorkflow(name: string) {
    setSelectedWorkflow(name);
    setError('');
    setStatus('');
    setDraft('');
    if (!name) {
      setBrief(emptyBrief);
      return;
    }
    const saved = savedWorkflows.find((workflow) => workflow.name === name);
    if (saved) {
      setBrief(savedWorkflowToBrief(saved));
    }
  }

  async function saveWorkflowConfiguration() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.electronAPI.rpaWorkflows.save(brief);
      if (!result.success || !result.workflow) {
        throw new Error(result.error || 'Could not save workflow configuration.');
      }
      const saved = result.workflow;
      setSavedWorkflows((current) => [
        saved,
        ...current.filter((workflow) => workflow.name.toLowerCase() !== saved.name.toLowerCase()),
      ]);
      setBrief(savedWorkflowToBrief(saved));
      setSelectedWorkflow(saved.name);
      setStatus(
        `Workflow draft “${saved.name}” saved. No autonomous job was created; use Create autonomous job after readiness is clear.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save workflow configuration.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkflowConfiguration() {
    if (!selectedWorkflow) return;
    if (!window.confirm(`Delete the saved workflow configuration “${selectedWorkflow}”?`)) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.electronAPI.rpaWorkflows.delete(selectedWorkflow);
      if (!result.success)
        throw new Error(result.error || 'Could not delete workflow configuration.');
      setSavedWorkflows((current) =>
        current.filter((workflow) => workflow.name !== selectedWorkflow)
      );
      setBrief(emptyBrief);
      setSelectedWorkflow('');
      setStatus('Workflow configuration deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workflow configuration.');
    } finally {
      setBusy(false);
    }
  }
  function prepare() {
    try {
      const text = buildRpaWorkflowPrompt(brief);
      setDraft(text);
      setError('');
      return text;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete the required fields.');
      return null;
    }
  }
  async function reviewInChat() {
    const prompt = prepare();
    if (!prompt) return;
    setBusy(true);
    try {
      const content: ContentBlock[] = [];
      for (const screenshot of brief.referenceScreenshots || []) {
        const result = await window.electronAPI.rpaStudio.readReferenceScreenshot(screenshot.path);
        if (!result.success || !result.image) {
          throw new Error(
            result.error || `Could not read reference screenshot “${screenshot.description}”.`
          );
        }
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: result.image.mediaType,
            data: result.image.data,
          },
        });
      }
      content.push({ type: 'text', text: prompt });
      const session = await startSession(
        `RPA setup: ${brief.name}`,
        content,
        workingDir || undefined
      );
      if (session) useAppStore.getState().setShowSettings(false);
      else setError('Could not start the setup conversation. Check your provider settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start guided recording.');
    } finally {
      setBusy(false);
    }
  }
  async function scheduleAutonomousRun() {
    const currentIssues = getRpaAutonomousReadinessIssues(brief, {
      connected,
      configured,
      recipeNames,
    });
    if (currentIssues.length > 0) {
      setError(currentIssues.join(' '));
      return;
    }
    const reviewPrompt = prepare();
    if (!reviewPrompt) return;
    const prompt = buildRpaAutonomousRunPrompt(brief);
    if (brief.trigger === 'manual') {
      setError('Choose a scheduled or watch trigger before creating an autonomous job.');
      return;
    }
    const now = Date.now();
    let payload: ScheduleCreateInput;
    if (brief.trigger === 'watch') {
      if (!brief.watchUrl?.trim()) {
        setError('Enter a trigger URL for a watch job.');
        return;
      }
      payload = {
        prompt,
        cwd: workingDir || '',
        runAt: now + 5 * 60 * 1000,
        nextRunAt: now + 5 * 60 * 1000,
        enabled: true,
        watchConfig: {
          checkType: 'http',
          http: { url: brief.watchUrl.trim(), method: 'GET' },
          pollIntervalMs: 5 * 60 * 1000,
        },
      };
    } else if (brief.trigger === 'once') {
      const runAt = brief.scheduleAt ? new Date(brief.scheduleAt).getTime() : NaN;
      if (!Number.isFinite(runAt) || runAt <= now) {
        setError('Choose a future run time for the one-time autonomous job.');
        return;
      }
      payload = {
        prompt,
        cwd: workingDir || '',
        runAt,
        nextRunAt: runAt,
        enabled: true,
      };
    } else if (brief.trigger === 'daily' || brief.trigger === 'weekly') {
      const times = brief.scheduleTimes || [];
      const weekdays = brief.scheduleWeekdays || [];
      if (times.length === 0) {
        setError('Add at least one daily time slot.');
        return;
      }
      if (brief.trigger === 'weekly' && weekdays.length === 0) {
        setError('Select at least one weekday.');
        return;
      }
      const runAt = nextScheduleSlot(times, brief.trigger === 'weekly' ? weekdays : undefined);
      payload = {
        prompt,
        cwd: workingDir || '',
        runAt,
        nextRunAt: runAt,
        enabled: true,
        scheduleConfig:
          brief.trigger === 'weekly'
            ? {
                kind: 'weekly',
                weekdays: weekdays as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
                times,
              }
            : { kind: 'daily', times },
      };
    } else {
      const firstRun = brief.scheduleAt
        ? new Date(brief.scheduleAt).getTime()
        : now + 5 * 60 * 1000;
      if (!Number.isFinite(firstRun) || firstRun <= now) {
        setError('Choose a future first-run time for the repeating job.');
        return;
      }
      payload = {
        prompt,
        cwd: workingDir || '',
        runAt: firstRun,
        nextRunAt: firstRun,
        enabled: true,
        repeatEvery: Math.max(1, brief.repeatEvery || 1),
        repeatUnit: brief.repeatUnit || 'hour',
      };
    }
    setBusy(true);
    setError('');
    try {
      let recipes = await window.electronAPI.rpaStudio.listRecipes();
      let recipeExists = recipes.some(
        (recipe) => recipe.name.toLowerCase() === brief.name.trim().toLowerCase()
      );
      if (!recipeExists && (brief.definedSteps?.length || 0) > 0) {
        const savedRecipe = await window.electronAPI.rpaStudio.saveRecipe({
          name: brief.name,
          appName: brief.application,
          description: brief.steps,
          steps: brief.definedSteps || [],
          executionMode: brief.executionMode,
          credentialProfile: brief.credentialProfile,
          successCheck: brief.successCheck,
        });
        if (!savedRecipe.success || !savedRecipe.recipe) {
          throw new Error(savedRecipe.error || 'Could not save the executable recipe.');
        }
        recipes = await window.electronAPI.rpaStudio.listRecipes();
        setRecipeNames(recipes.map((recipe) => recipe.name));
        recipeExists = true;
      }
      if (!recipeExists) {
        throw new Error(
          `No executable recipe named “${brief.name.trim()}”. Save defined steps or complete guided recording before scheduling.`
        );
      }
      const savedWorkflow = await window.electronAPI.rpaWorkflows.save(brief);
      if (!savedWorkflow.success || !savedWorkflow.workflow) {
        throw new Error(savedWorkflow.error || 'Could not save the workflow before scheduling.');
      }
      const workflow = savedWorkflow.workflow;
      setSavedWorkflows((current) => [
        workflow,
        ...current.filter((saved) => saved.name.toLowerCase() !== workflow.name.toLowerCase()),
      ]);
      setSelectedWorkflow(workflow.name);
      const task = await window.electronAPI.schedule.create(payload);
      const nextRun = task.nextRunAt ?? task.runAt;
      setDraft(`${prompt}\n\nAutonomous job ${task.id} created for recipe "${brief.name.trim()}".`);
      setStatus(`Autonomous job created. Next run: ${new Date(nextRun).toLocaleString()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create autonomous job.');
    } finally {
      setBusy(false);
    }
  }
  async function saveCredentialProfile() {
    const name = brief.credentialProfile?.trim();
    if (!name || !credentialUsername.trim() || !credentialPassword) {
      setError('Enter a profile name, username and password to save credentials.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.rpaCredentials.save({
        name,
        appName: brief.application.trim() || undefined,
        username: credentialUsername,
        password: credentialPassword,
      });
      if (!result.success) throw new Error(result.error || 'Could not save credential profile.');
      setCredentialPassword('');
      setStatus(
        'Credential profile saved in the encrypted local store. The password is never placed in the workflow prompt or recipe.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credential profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-t border-border-subtle pt-3">
      <summary className="text-sm font-medium text-text-primary cursor-pointer">
        Configure a business workflow
      </summary>
      <div className="space-y-3 mt-3">
        <p className="text-xs text-text-muted">
          Enable makes tools available. This setup prepares an agentic workflow, selects its
          execution mode and can create a persistent schedule or change trigger. The first run is
          reviewed and recorded by you; later runs invoke the saved recipe autonomously with
          evidence and postcondition checks.
        </p>
        <ol className="list-decimal pl-5 text-xs text-text-secondary space-y-1">
          <li>
            Enable the required connector and configure your model. Desktop vision needs a working
            image-capable provider.
          </li>
          <li>
            Sign in to the exact application and account. On macOS, allow Accessibility and Screen
            Recording. On Linux, run inside an unlocked graphical session and use runtime status to
            verify xdotool, xrandr and a screenshot backend.
          </li>
          <li>
            Define inputs, steps and the business result to verify below. Review the plan, then
            record and test a small sample in chat.
          </li>
          <li>
            Re-open outputs to check IDs, totals and status. Schedule only after supervised replay
            succeeds. Keep the execution desktop unlocked for UI/background jobs; choose headless
            only when the workflow has a non-UI path.
          </li>
        </ol>
        <fieldset disabled={busy} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-xs text-text-secondary">
              Saved workflow configuration
              <select
                className={inputClass}
                value={selectedWorkflow}
                onChange={(e) => selectSavedWorkflow(e.target.value)}
              >
                <option value="">New workflow</option>
                {savedWorkflows.map((workflow) => (
                  <option key={workflow.name} value={workflow.name}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!selectedWorkflow || busy}
              onClick={() => void deleteWorkflowConfiguration()}
              className="px-3 py-2 rounded bg-surface-muted text-sm text-error disabled:opacity-50"
            >
              Delete saved workflow
            </button>
          </div>
          <label className="block text-xs text-text-secondary">
            Workflow name
            <input
              className={inputClass}
              value={brief.name}
              onChange={(e) => change('name', e.target.value)}
              placeholder="HRMS attendance export"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Application type
            <select
              className={inputClass}
              value={brief.surface}
              onChange={(e) => change('surface', e.target.value)}
            >
              <option value="desktop">Local desktop app</option>
              <option value="web">Website / web ERP / HRMS</option>
              <option value="remote">Remote Desktop / Citrix window</option>
            </select>
          </label>
          <label className="block text-xs text-text-secondary">
            Application name, URL or remote host
            <input
              className={inputClass}
              value={brief.application}
              onChange={(e) => change('application', e.target.value)}
              placeholder="Application and test account / tenant"
            />
          </label>
          {brief.surface === 'web' && (
            <p className="text-xs text-text-muted">
              Enable a browser connector for browser automation. Prefer page elements and state
              checks when available. Desktop recipes do not record browser-tool or API calls.
            </p>
          )}
          {brief.surface === 'remote' && (
            <p className="text-xs text-text-muted">
              This controls the visible remote-session window. It does not install or orchestrate an
              RPA worker on each remote computer.
            </p>
          )}
          <label className="block text-xs text-text-secondary">
            Inputs / parameters (no passwords)
            <textarea
              className={inputClass}
              rows={2}
              value={brief.inputs}
              onChange={(e) => change('inputs', e.target.value)}
              placeholder="report_date, department, output folder"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Business steps
            <textarea
              className={inputClass}
              rows={3}
              value={brief.steps}
              onChange={(e) => change('steps', e.target.value)}
              placeholder="Open attendance report; choose date and department; export CSV"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Success check and evidence
            <textarea
              className={inputClass}
              rows={2}
              value={brief.successCheck}
              onChange={(e) => change('successCheck', e.target.value)}
              placeholder="Re-open CSV; check date, department, employee count and output path"
            />
          </label>
          <RpaProcessStudio
            brief={brief}
            connected={connected}
            configured={configured}
            onChange={change}
            onError={setError}
            onStatus={setStatus}
            onStartGuidedRecording={reviewInChat}
            onRecipesChange={setRecipeNames}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-text-secondary">
              Execution mode
              <select
                className={inputClass}
                value={brief.executionMode || 'ui'}
                onChange={(e) => change('executionMode', e.target.value)}
              >
                <option value="ui">UI (visible desktop)</option>
                <option value="background">Background (unattended desktop)</option>
                <option value="headless">Headless (browser/API only)</option>
              </select>
            </label>
            <label className="block text-xs text-text-secondary">
              Trigger
              <select
                className={inputClass}
                value={brief.trigger || 'manual'}
                onChange={(e) => change('trigger', e.target.value)}
              >
                <option value="manual">Manual / review in chat</option>
                <option value="once">One time</option>
                <option value="daily">Daily · one or multiple times</option>
                <option value="weekly">Weekly · selected days and times</option>
                <option value="interval">Repeat every N minutes / hours / days</option>
                <option value="watch">HTTP change trigger</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-text-secondary">
            Credential profile or signed-in account label (reference only)
            <input
              className={inputClass}
              value={brief.credentialProfile || ''}
              onChange={(e) => change('credentialProfile', e.target.value)}
              placeholder="HRMS production service account"
            />
            <span className="block mt-1 text-text-muted">
              Save a profile below to let autonomous recipe runs resolve the username/password
              inside the connector. Secrets never enter the model prompt, recipe metadata or tool
              result.
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-text-secondary">
              Login username
              <input
                className={inputClass}
                value={credentialUsername}
                onChange={(e) => setCredentialUsername(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              Login password
              <input
                type="password"
                className={inputClass}
                value={credentialPassword}
                onChange={(e) => setCredentialPassword(e.target.value)}
                placeholder="Stored encrypted locally"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveCredentialProfile()}
            className="px-3 py-2 rounded bg-surface-muted text-sm text-text-primary disabled:opacity-50"
          >
            Save encrypted credential profile
          </button>
          {(brief.trigger === 'once' || brief.trigger === 'interval') && (
            <label className="block text-xs text-text-secondary">
              {brief.trigger === 'once' ? 'Run at' : 'First run'}
              <input
                type="datetime-local"
                min={toLocalDateTimeMinimum(clockNow + 60_000)}
                className={inputClass}
                value={brief.scheduleAt || ''}
                onChange={(e) => change('scheduleAt', e.target.value)}
              />
            </label>
          )}
          {(brief.trigger === 'daily' || brief.trigger === 'weekly') && (
            <div className="space-y-2 rounded border border-border p-3">
              {brief.trigger === 'weekly' && (
                <div>
                  <div className="text-xs text-text-secondary mb-2">Weekdays</div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      ['Sun', 0],
                      ['Mon', 1],
                      ['Tue', 2],
                      ['Wed', 3],
                      ['Thu', 4],
                      ['Fri', 5],
                      ['Sat', 6],
                    ].map(([label, day]) => (
                      <label
                        key={day}
                        className="flex items-center gap-1 text-xs text-text-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={(brief.scheduleWeekdays || []).includes(Number(day))}
                          onChange={() => {
                            const current = brief.scheduleWeekdays || [];
                            const numericDay = Number(day);
                            change(
                              'scheduleWeekdays',
                              current.includes(numericDay)
                                ? current.filter((candidate) => candidate !== numericDay)
                                : [...current, numericDay].sort()
                            );
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block text-xs text-text-secondary">
                  Add time slot
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (!scheduleTime) return;
                    change(
                      'scheduleTimes',
                      Array.from(new Set([...(brief.scheduleTimes || []), scheduleTime])).sort()
                    );
                  }}
                  className="px-3 py-2 rounded bg-surface-muted text-sm text-text-primary"
                >
                  Add time
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(brief.scheduleTimes || []).map((time) => (
                  <button
                    type="button"
                    key={time}
                    onClick={() =>
                      change(
                        'scheduleTimes',
                        (brief.scheduleTimes || []).filter((candidate) => candidate !== time)
                      )
                    }
                    className="px-2 py-1 rounded bg-surface-muted text-xs text-text-secondary"
                    title="Remove time slot"
                  >
                    {time} ×
                  </button>
                ))}
              </div>
            </div>
          )}
          {brief.trigger === 'interval' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-text-secondary">
                Repeat every
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={brief.repeatEvery || 1}
                  onChange={(event) =>
                    change('repeatEvery', Math.max(1, Number(event.target.value)))
                  }
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Repeat unit
                <select
                  className={inputClass}
                  value={brief.repeatUnit || 'hour'}
                  onChange={(event) => change('repeatUnit', event.target.value)}
                >
                  <option value="minute">Minute(s)</option>
                  <option value="hour">Hour(s)</option>
                  <option value="day">Day(s)</option>
                </select>
              </label>
            </div>
          )}
          {brief.trigger === 'watch' && (
            <label className="block text-xs text-text-secondary">
              HTTP trigger URL
              <input
                type="url"
                className={inputClass}
                value={brief.watchUrl || ''}
                onChange={(e) => change('watchUrl', e.target.value)}
                placeholder="https://example.internal/job-trigger"
              />
            </label>
          )}
          {brief.trigger !== 'manual' && (
            <div className="rounded border border-border bg-background p-3 space-y-1">
              <div className="text-xs font-medium text-text-secondary">
                Autonomous job readiness
              </div>
              {readinessIssues.length === 0 ? (
                <p className="text-xs text-success">
                  Ready. Creating the job will save defined steps as a recipe and register the
                  schedule.
                </p>
              ) : (
                readinessIssues.map((issue) => (
                  <p key={issue} className="text-xs text-error">
                    • {issue}
                  </p>
                ))
              )}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveWorkflowConfiguration()}
              className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save workflow draft'}
            </button>
            <button
              type="button"
              onClick={prepare}
              className="px-3 py-2 rounded bg-surface-muted text-sm text-text-primary"
            >
              Prepare instructions
            </button>
            <button
              type="button"
              disabled={busy || readinessIssues.length > 0}
              onClick={() => void scheduleAutonomousRun()}
              className="px-3 py-2 rounded bg-accent/80 text-white text-sm disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create autonomous job'}
            </button>
          </div>
          {(!connected || !configured) && (
            <p className="text-xs text-text-muted">
              Connect RPA and configure your model to start guided recording in Process Studio. You
              can save the workflow and define steps now.
            </p>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-xs text-success">
            {status}
          </p>
        )}
        {draft && (
          <div className="space-y-2">
            <textarea
              aria-label="Prepared workflow instructions"
              readOnly
              rows={8}
              value={draft}
              className={inputClass}
            />
            <button
              type="button"
              className="text-xs text-accent"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(draft);
                  setCopied(true);
                } catch {
                  setError('Could not copy. Select and copy the instructions above.');
                }
              }}
            >
              {copied ? 'Copied' : 'Copy instructions'}
            </button>
          </div>
        )}
        <p className="text-xs text-text-muted">
          Workflow configuration saves this form for reuse and does not create a recipe or a job.
          Desktop recipes are managed in chat: ask the agent to record the named workflow, test it
          on a small sample, then save it. A scheduled job starts a new agent session, calls the
          saved recipe, captures evidence and checks the business result. Enable
          <strong> Autonomous Mode </strong> in General settings for unattended safe tools;
          irreversible actions still require explicit approval. Use <code>emergency_stop</code> to
          stop GUI actions.
        </p>
      </div>
    </details>
  );
}
