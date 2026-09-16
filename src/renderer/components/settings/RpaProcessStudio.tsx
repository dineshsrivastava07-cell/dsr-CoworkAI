import { useEffect, useState } from 'react';
import type {
  RpaDefinedStep,
  RpaDefinedStepAction,
  RpaRecipePublic,
  RpaWorkflowBrief,
} from '../../../shared/rpa-workflow';

const inputClass =
  'w-full px-3 py-2 rounded bg-background border border-border text-sm text-text-primary';

interface Props {
  brief: RpaWorkflowBrief;
  connected: boolean;
  configured: boolean;
  onChange: (key: keyof RpaWorkflowBrief, value: RpaWorkflowBrief[keyof RpaWorkflowBrief]) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onStartGuidedRecording: () => Promise<void>;
  onRecipesChange: (names: string[]) => void;
}

function newStep(application: string, firstStep: boolean): RpaDefinedStep {
  return {
    id: globalThis.crypto?.randomUUID?.() || `step-${Date.now()}`,
    action: firstStep ? 'launch_app' : 'click',
    target: '',
    value: firstStep ? application : '',
    notes: '',
  };
}

function valuePlaceholder(action: RpaDefinedStepAction): string {
  if (action === 'launch_app') return 'Application launcher name or Linux desktop ID';
  if (action === 'type_text') return 'Text or {{parameter}}';
  if (action === 'key_press') return 'enter or ctrl+s';
  if (action === 'wait') return 'Milliseconds, e.g. 1000';
  if (action === 'scroll') return 'down:3';
  if (action === 'drag') return '100,200,700,200';
  return 'No value needed';
}

export function RpaProcessStudio({
  brief,
  connected,
  configured,
  onChange,
  onError,
  onStatus,
  onStartGuidedRecording,
  onRecipesChange,
}: Props) {
  const [recipes, setRecipes] = useState<RpaRecipePublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [screenshotDescription, setScreenshotDescription] = useState('');
  const steps = brief.definedSteps || [];
  const screenshots = brief.referenceScreenshots || [];

  async function loadRecipes() {
    try {
      const nextRecipes = await window.electronAPI.rpaStudio.listRecipes();
      setRecipes(nextRecipes);
      onRecipesChange(nextRecipes.map((recipe) => recipe.name));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not load saved RPA recipes.');
    }
  }

  useEffect(() => {
    void loadRecipes();
    // Recipe storage is local and only needs to be refreshed when the studio mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setSteps(next: RpaDefinedStep[]) {
    onChange('definedSteps', next);
  }

  function updateStep(id: string, updates: Partial<RpaDefinedStep>) {
    setSteps(steps.map((step) => (step.id === id ? { ...step, ...updates } : step)));
  }

  async function captureScreenshot() {
    if (!brief.name.trim()) {
      onError('Enter a workflow name before capturing a reference screenshot.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const result = await window.electronAPI.rpaStudio.captureReferenceScreenshot({
        workflowName: brief.name,
        description: screenshotDescription,
      });
      if (!result.success || !result.screenshot) {
        throw new Error(result.error || 'Could not capture the current desktop.');
      }
      onChange('referenceScreenshots', [...screenshots, result.screenshot]);
      setScreenshotDescription('');
      onStatus('Reference screenshot captured. Save the workflow configuration to retain it.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not capture the current desktop.');
    } finally {
      setBusy(false);
    }
  }

  async function removeScreenshot(id: string, assetPath: string) {
    setBusy(true);
    onError('');
    try {
      const result = await window.electronAPI.rpaStudio.deleteReferenceScreenshot(assetPath);
      if (!result.success) throw new Error(result.error || 'Could not delete the screenshot.');
      onChange(
        'referenceScreenshots',
        screenshots.filter((screenshot) => screenshot.id !== id)
      );
      onStatus(
        'Reference screenshot removed. Save the workflow configuration to retain this change.'
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not delete the screenshot.');
    } finally {
      setBusy(false);
    }
  }

  async function saveExecutableRecipe() {
    setBusy(true);
    onError('');
    try {
      const result = await window.electronAPI.rpaStudio.saveRecipe({
        name: brief.name,
        appName: brief.application,
        description: brief.steps,
        steps,
        executionMode: brief.executionMode,
        credentialProfile: brief.credentialProfile,
        successCheck: brief.successCheck,
      });
      if (!result.success || !result.recipe) {
        throw new Error(result.error || 'Could not save the executable recipe.');
      }
      await loadRecipes();
      onStatus(
        `Executable recipe “${result.recipe.name}” saved with ${steps.length} step(s). Test it in chat before scheduling.`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not save the executable recipe.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecipe(name: string) {
    if (!window.confirm(`Delete the executable recipe “${name}”?`)) return;
    setBusy(true);
    onError('');
    try {
      const result = await window.electronAPI.rpaStudio.deleteRecipe(name);
      if (!result.success) throw new Error(result.error || 'Could not delete the recipe.');
      await loadRecipes();
      onStatus(`Executable recipe “${name}” deleted.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not delete the recipe.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface/40 p-3 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-text-primary">Process Studio</h4>
        <p className="text-xs text-text-muted mt-1">
          Define executable steps directly, capture durable reference screens, or let the agent
          sense and record a supervised run. Saving the workflow form alone does not create an
          executable recipe.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-text-secondary">User-defined process steps</div>
          <button
            type="button"
            disabled={busy || steps.length >= 200}
            onClick={() => setSteps([...steps, newStep(brief.application, steps.length === 0)])}
            className="px-2 py-1 rounded bg-surface-muted text-xs text-text-primary disabled:opacity-50"
          >
            Add process step
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="text-xs text-text-muted border border-dashed border-border rounded p-3">
            No executable steps defined. Add steps or start a guided recording.
          </p>
        ) : (
          steps.map((step, index) => (
            <div key={step.id} className="rounded border border-border p-2 space-y-2">
              <div className="grid gap-2 md:grid-cols-[auto_140px_1fr_1fr_auto] md:items-center">
                <span className="text-xs text-text-muted">{index + 1}</span>
                <select
                  aria-label={`Step ${index + 1} action`}
                  value={step.action}
                  onChange={(event) =>
                    updateStep(step.id, {
                      action: event.target.value as RpaDefinedStepAction,
                      value:
                        event.target.value === 'launch_app' && !step.value
                          ? brief.application
                          : step.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="launch_app">Open application</option>
                  <option value="click">Click target</option>
                  <option value="type_text">Type text</option>
                  <option value="key_press">Press key</option>
                  <option value="scroll">Scroll</option>
                  <option value="drag">Drag</option>
                  <option value="wait">Wait</option>
                </select>
                <input
                  aria-label={`Step ${index + 1} target`}
                  value={step.target}
                  onChange={(event) => updateStep(step.id, { target: event.target.value })}
                  placeholder="Semantic target, e.g. Save button"
                  disabled={step.action === 'launch_app'}
                  className={inputClass}
                />
                <input
                  aria-label={`Step ${index + 1} value`}
                  value={step.value}
                  onChange={(event) => updateStep(step.id, { value: event.target.value })}
                  placeholder={valuePlaceholder(step.action)}
                  disabled={step.action === 'click'}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setSteps(steps.filter((candidate) => candidate.id !== step.id))}
                  className="px-2 py-1 text-xs text-error"
                >
                  Remove
                </button>
              </div>
              <input
                aria-label={`Step ${index + 1} notes`}
                value={step.notes}
                onChange={(event) => updateStep(step.id, { notes: event.target.value })}
                placeholder="Expected state, exception handling, or action intent"
                className={inputClass}
              />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">Reference screenshots</div>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={screenshotDescription}
            onChange={(event) => setScreenshotDescription(event.target.value)}
            placeholder="Describe this screen or process state"
            className={inputClass}
          />
          <button
            type="button"
            disabled={!connected || busy || screenshots.length >= 20}
            onClick={() => void captureScreenshot()}
            className="px-3 py-2 rounded bg-surface-muted text-sm text-text-primary disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Capture current screen'}
          </button>
        </div>
        {!connected && (
          <p className="text-xs text-text-muted">Enable RPA before capturing the desktop.</p>
        )}
        {screenshots.map((screenshot) => (
          <div
            key={screenshot.id}
            className="flex items-center justify-between gap-2 text-xs border border-border rounded p-2"
          >
            <div className="min-w-0">
              <div className="text-text-secondary truncate">
                {screenshot.description || 'Reference state'}
              </div>
              <div className="text-text-muted truncate" title={screenshot.path}>
                {screenshot.path.split(/[\\/]/).pop()}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeScreenshot(screenshot.id, screenshot.path)}
              className="text-error disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
        {screenshots.length > 0 && (
          <p className="text-xs text-text-muted">
            Starting guided recording sends these retained images to the configured model with the
            workflow instructions.
          </p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy || steps.length === 0}
          onClick={() => void saveExecutableRecipe()}
          className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
        >
          Save executable recipe
        </button>
        <button
          type="button"
          disabled={!connected || !configured || busy}
          onClick={() => void onStartGuidedRecording()}
          className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
        >
          Start guided recording in chat
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium text-text-secondary">Saved executable recipes</div>
        {recipes.length === 0 ? (
          <p className="text-xs text-text-muted">No recipes saved on this workstation.</p>
        ) : (
          recipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-text-secondary truncate">
                {recipe.name} · {recipe.appName}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteRecipe(recipe.name)}
                className="text-error disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
