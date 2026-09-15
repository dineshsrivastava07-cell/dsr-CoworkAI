import { useState } from 'react';
import { useIPC } from '../../hooks/useIPC';
import { useAppStore } from '../../store';
import { buildRpaWorkflowPrompt, type RpaWorkflowBrief } from '../../../shared/rpa-workflow';

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
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
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
  return (
    <details className="border-t border-border-subtle pt-3">
      <summary className="text-sm font-medium text-text-primary cursor-pointer">
        Configure a business workflow
      </summary>
      <div className="space-y-3 mt-3">
        <p className="text-xs text-text-muted">
          Enable makes tools available. This form prepares a workflow brief for supervised setup in
          chat; it does not create or validate a runnable recipe by itself. Create a separate
          workflow for each repeatable ERP, HRMS, web or desktop task.
        </p>
        <ol className="list-decimal pl-5 text-xs text-text-secondary space-y-1">
          <li>
            Enable the required connector and configure your model. Desktop vision needs a working
            image-capable provider.
          </li>
          <li>
            Sign in to the exact application and account. On macOS, allow Accessibility and Screen
            Recording.
          </li>
          <li>
            Define inputs, steps and the business result to verify below. Review the plan, then
            record and test a small sample in chat.
          </li>
          <li>
            Re-open outputs to check IDs, totals and status. Schedule only after supervised replay
            succeeds. Keep the execution desktop unlocked and run one UI job per desktop.
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
          Saved desktop recipes are managed in chat: ask “List my saved RPA recipes”, then request a
          named recipe with its parameters and required success checks. Use the emergency_stop tool
          to stop GUI actions.
        </p>
      </div>
    </details>
  );
}
