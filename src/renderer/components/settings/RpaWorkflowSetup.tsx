import { useState } from 'react';
import { useIPC } from '../../hooks/useIPC';
import { useAppStore } from '../../store';
import { buildRpaWorkflowPrompt, type RpaWorkflowBrief } from '../../../shared/rpa-workflow';
import type { ScheduleCreateInput } from '../../types';

const inputClass =
  'w-full px-3 py-2 mt-1 rounded bg-background border border-border text-sm text-text-primary';
export function RpaWorkflowSetup({ connected }: { connected: boolean }) {
  const { startSession } = useIPC();
  const configured = useAppStore((state) => state.isConfigured);
  const workingDir = useAppStore((state) => state.workingDir);
  const [brief, setBrief] = useState<RpaWorkflowBrief>({
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
    watchUrl: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [credentialUsername, setCredentialUsername] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  function change(key: keyof RpaWorkflowBrief, value: string) {
    setBrief({ ...brief, [key]: value });
    setDraft('');
    setCopied(false);
    setError('');
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
      const session = await startSession(
        `RPA setup: ${brief.name}`,
        [{ type: 'text', text: prompt }],
        workingDir || undefined
      );
      if (session) useAppStore.getState().setShowSettings(false);
      else setError('Could not start the setup conversation. Check your provider settings.');
    } finally {
      setBusy(false);
    }
  }
  async function scheduleAutonomousRun() {
    const prompt = prepare();
    if (!prompt) return;
    if (brief.trigger === 'manual') {
      setError('Choose a scheduled or watch trigger before creating an autonomous job.');
      return;
    }
    const now = Date.now();
    let payload: ScheduleCreateInput;
    const runInstruction = `AUTONOMOUS RUN: Find the saved recipe named "${brief.name.trim()}" and call run_recipe with the supplied parameters. Capture evidence and verify the stated business postcondition before reporting success.`;
    if (brief.trigger === 'watch') {
      if (!brief.watchUrl?.trim()) {
        setError('Enter a trigger URL for a watch job.');
        return;
      }
      payload = {
        prompt: `${prompt}\n\n${runInstruction}`,
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
    } else {
      const runAt = brief.scheduleAt ? new Date(brief.scheduleAt).getTime() : NaN;
      if (!Number.isFinite(runAt) || runAt <= now) {
        setError('Choose a future first-run time for the autonomous job.');
        return;
      }
      const time = new Date(runAt).toTimeString().slice(0, 5);
      payload = {
        prompt: `${prompt}\n\n${runInstruction}`,
        cwd: workingDir || '',
        runAt,
        nextRunAt: runAt,
        enabled: true,
        scheduleConfig: { kind: 'daily', times: [time] },
      };
    }
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.schedule.create(payload);
      setDraft(
        `${prompt}\n\nAutonomous job created. Finish and save the recipe as "${brief.name.trim()}" before the first run.`
      );
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
      setDraft(
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
                <option value="schedule">Daily schedule</option>
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
          {brief.trigger === 'schedule' && (
            <label className="block text-xs text-text-secondary">
              First run
              <input
                type="datetime-local"
                className={inputClass}
                value={brief.scheduleAt || ''}
                onChange={(e) => change('scheduleAt', e.target.value)}
              />
            </label>
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
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={prepare}
              className="px-3 py-2 rounded bg-surface-muted text-sm text-text-primary"
            >
              Prepare instructions
            </button>
            <button
              type="button"
              disabled={!connected || !configured || busy}
              onClick={() => void reviewInChat()}
              className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Review setup in chat'}
            </button>
            <button
              type="button"
              disabled={!connected || !configured || busy || brief.trigger === 'manual'}
              onClick={() => void scheduleAutonomousRun()}
              className="px-3 py-2 rounded bg-accent/80 text-white text-sm disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create autonomous job'}
            </button>
          </div>
          {(!connected || !configured) && (
            <p className="text-xs text-text-muted">
              Connect RPA and configure your model to review the setup in chat. You can prepare the
              instructions now.
            </p>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
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
          Saved desktop recipes are managed in chat: ask the agent to record the named workflow,
          test it on a small sample, then save it. A scheduled job starts a new agent session, calls
          the saved recipe, captures evidence and checks the business result. Enable
          <strong> Autonomous Mode </strong> in General settings for unattended safe tools;
          irreversible actions still require explicit approval. Use <code>emergency_stop</code> to
          stop GUI actions.
        </p>
      </div>
    </details>
  );
}
