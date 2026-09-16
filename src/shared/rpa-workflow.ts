export type RpaDefinedStepAction =
  | 'launch_app'
  | 'click'
  | 'type_text'
  | 'key_press'
  | 'scroll'
  | 'drag'
  | 'wait';

export interface RpaDefinedStep {
  id: string;
  action: RpaDefinedStepAction;
  target: string;
  value: string;
  notes: string;
}

export interface RpaReferenceScreenshot {
  id: string;
  path: string;
  description: string;
  capturedAt: number;
}

export interface RpaRecipeDefinitionInput {
  name: string;
  appName: string;
  description?: string;
  steps: RpaDefinedStep[];
  executionMode?: 'ui' | 'background' | 'headless';
  credentialProfile?: string;
  successCheck: string;
}

export interface RpaRecipePublic {
  id: string;
  name: string;
  appName: string;
  description?: string;
  executionMode?: 'ui' | 'background' | 'headless';
  credentialProfile?: string;
  successCheck?: string;
}

export interface RpaWorkflowBrief {
  name: string;
  surface: 'desktop' | 'web' | 'remote';
  application: string;
  inputs: string;
  steps: string;
  successCheck: string;
  executionMode?: 'ui' | 'background' | 'headless';
  credentialProfile?: string;
  trigger?: 'manual' | 'schedule' | 'once' | 'daily' | 'weekly' | 'interval' | 'watch';
  scheduleAt?: string;
  scheduleTimes?: string[];
  scheduleWeekdays?: number[];
  repeatEvery?: number;
  repeatUnit?: 'minute' | 'hour' | 'day';
  watchUrl?: string;
  definedSteps?: RpaDefinedStep[];
  referenceScreenshots?: RpaReferenceScreenshot[];
}

export interface SavedRpaWorkflowConfiguration extends RpaWorkflowBrief {
  updatedAt: number;
}

export function normalizeRpaWorkflowBrief(brief: RpaWorkflowBrief): RpaWorkflowBrief {
  const requiredFields = [brief.name, brief.application, brief.steps, brief.successCheck];
  if (!requiredFields.every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('Workflow name, application, steps and success check are required.');
  }
  if (brief.name.trim().length > 200) throw new Error('Workflow name is too long.');
  if (brief.application.trim().length > 2_000) throw new Error('Application value is too long.');
  if ([brief.inputs, brief.steps, brief.successCheck].some((value) => value.length > 20_000)) {
    throw new Error('Workflow instructions are too long.');
  }
  if ((brief.credentialProfile?.trim().length || 0) > 200) {
    throw new Error('Credential profile name is too long.');
  }
  if ((brief.scheduleAt?.trim().length || 0) > 100) {
    throw new Error('Scheduled run value is too long.');
  }
  if ((brief.watchUrl?.trim().length || 0) > 2_000) {
    throw new Error('Trigger URL is too long.');
  }
  if ((brief.definedSteps?.length || 0) > 200) {
    throw new Error('A workflow can contain at most 200 defined steps.');
  }
  if ((brief.referenceScreenshots?.length || 0) > 20) {
    throw new Error('A workflow can contain at most 20 reference screenshots.');
  }
  if (!['desktop', 'web', 'remote'].includes(brief.surface)) {
    throw new Error('Choose a valid application type.');
  }
  const executionMode = brief.executionMode || 'ui';
  const requestedTrigger = brief.trigger || 'manual';
  const trigger = requestedTrigger === 'schedule' ? 'daily' : requestedTrigger;
  if (!['ui', 'background', 'headless'].includes(executionMode)) {
    throw new Error('Choose a valid execution mode.');
  }
  if (!['manual', 'once', 'daily', 'weekly', 'interval', 'watch'].includes(trigger)) {
    throw new Error('Choose a valid trigger.');
  }
  const scheduleTimes = Array.from(
    new Set((brief.scheduleTimes || []).filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
  ).sort();
  const scheduleWeekdays = Array.from(
    new Set(
      (brief.scheduleWeekdays || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    )
  ).sort((left, right) => left - right);
  const repeatEvery = Number.isFinite(brief.repeatEvery)
    ? Math.max(1, Math.floor(brief.repeatEvery || 1))
    : 1;
  const repeatUnit = ['minute', 'hour', 'day'].includes(brief.repeatUnit || '')
    ? brief.repeatUnit
    : 'hour';
  return {
    name: brief.name.trim(),
    surface: brief.surface,
    application: brief.application.trim(),
    inputs: brief.inputs.trim(),
    steps: brief.steps.trim(),
    successCheck: brief.successCheck.trim(),
    executionMode,
    trigger,
    credentialProfile: brief.credentialProfile?.trim() || '',
    scheduleAt: brief.scheduleAt?.trim() || '',
    scheduleTimes,
    scheduleWeekdays,
    repeatEvery,
    repeatUnit,
    watchUrl: brief.watchUrl?.trim() || '',
    definedSteps: (brief.definedSteps || []).map(normalizeDefinedStep),
    referenceScreenshots: (brief.referenceScreenshots || []).map((screenshot) => ({
      id: String(screenshot.id || '').slice(0, 200),
      path: String(screenshot.path || '').slice(0, 4_000),
      description: String(screenshot.description || '')
        .trim()
        .slice(0, 1_000),
      capturedAt: Number.isFinite(screenshot.capturedAt) ? screenshot.capturedAt : Date.now(),
    })),
  };
}

function normalizeDefinedStep(step: RpaDefinedStep): RpaDefinedStep {
  if (
    !['launch_app', 'click', 'type_text', 'key_press', 'scroll', 'drag', 'wait'].includes(
      step.action
    )
  ) {
    throw new Error('A user-defined process step has an unsupported action.');
  }
  const target = String(step.target || '')
    .trim()
    .slice(0, 2_000);
  const value = String(step.value || '')
    .trim()
    .slice(0, 20_000);
  if (step.action === 'click' && !target) {
    throw new Error('Every click step requires a semantic target description.');
  }
  if (['launch_app', 'type_text', 'key_press'].includes(step.action) && !value) {
    throw new Error(`${step.action} requires a value.`);
  }
  return {
    id: String(step.id || '').slice(0, 200),
    action: step.action,
    target,
    value,
    notes: String(step.notes || '')
      .trim()
      .slice(0, 2_000),
  };
}

/** A reviewable plan request, not an executable recipe or an accuracy guarantee. */
export function buildRpaWorkflowPrompt(brief: RpaWorkflowBrief): string {
  const normalized = normalizeRpaWorkflowBrief(brief);
  const executionMode = normalized.executionMode || 'ui';
  const trigger = normalized.trigger || 'manual';
  return `Prepare an autonomous agentic automation workflow. Start by reviewing this brief and proposing a plan; do not operate the application until I approve the initial recording and test run.

Workflow name: ${normalized.name}
Application / URL / remote session: ${normalized.application}
Surface: ${normalized.surface}
Inputs and parameters (no passwords): ${normalized.inputs || 'Ask me for the required input values.'}
Business steps:
${normalized.steps}
Required success check and evidence:
${normalized.successCheck}

Autonomous execution settings:
- Execution mode: ${executionMode} (ui keeps the active desktop visible; background runs as an unattended session on the configured desktop; headless is allowed only when every action has a non-UI/browser/API path and must stop if a display is required)
- Trigger: ${trigger}
- Credential profile reference: ${normalized.credentialProfile || 'Use the application session/account selected by the user; never ask for or record a password in this prompt.'}
${normalized.scheduleAt ? `- First scheduled run: ${normalized.scheduleAt}` : ''}
${normalized.scheduleTimes?.length ? `- Scheduled time slots: ${normalized.scheduleTimes.join(', ')}` : ''}
${normalized.scheduleWeekdays?.length ? `- Scheduled weekdays (0=Sunday): ${normalized.scheduleWeekdays.join(', ')}` : ''}
${normalized.trigger === 'interval' ? `- Repeat every: ${normalized.repeatEvery} ${normalized.repeatUnit}` : ''}
${normalized.watchUrl ? `- Trigger URL: ${normalized.watchUrl}` : ''}

User-defined executable steps:
${
  normalized.definedSteps?.length
    ? normalized.definedSteps
        .map(
          (step, index) =>
            `${index + 1}. ${step.action}${step.target ? ` — ${step.target}` : ''}${step.value ? ` — value: ${step.value}` : ''}${step.notes ? ` — ${step.notes}` : ''}`
        )
        .join('\n')
    : 'No direct steps saved. Learn and record the process during the supervised session.'
}

Reference screenshots retained for setup context:
${
  normalized.referenceScreenshots?.length
    ? normalized.referenceScreenshots
        .map((screenshot) => `- ${screenshot.description || 'Reference state'}: ${screenshot.path}`)
        .join('\n')
    : 'None.'
}

Setup and execution requirements:
1. Inspect the available tools and confirm the exact application, account/tenant, working folder, session and inputs. Use the named credential profile or an existing signed-in session; do not record passwords, OTPs or session tokens in prompts or recipes. If credentials are unavailable, stop with a clear setup error.
2. ${normalized.surface === 'web' ? 'Prefer configured browser tools with DOM/accessibility locators and state-based waits, or an authorized application API. GUI_Operate recipes only record desktop primitives; do not promise they record browser-tool/API actions.' : normalized.surface === 'remote' ? 'Confirm the correct remote host and unlocked remote session. The local GUI connector controls the visible remote-client window; it does not deploy workers to remote machines. Use one automation at a time per interactive desktop.' : 'Use the configured GUI_Operate tools, verify desktop permissions and a working vision provider, and initialize the exact application context. Use one automation at a time per interactive desktop.'}
3. After plan approval, use a test account and a small sample. Check the target screen before acting. Re-locate semantic targets instead of reusing stale coordinates, wait for the expected state and stop on ambiguity or unexpected dialogs.
4. For desktop recipes, call start_recipe_recording, record_recipe_step after each supported action with an element_description for every click, and save_recipe under the workflow name. Record parameters such as {{report_date}} instead of hard-coded business values. Do not record approval flags for future destructive actions.
5. Verify the required business result independently: re-open the saved record or downloaded file and compare its identifier, date, row count, totals or status with the expected values. A click, screenshot change or tool success alone is insufficient. If verification is unavailable, report unverified and stop.
6. Before any repeated submission, read back the application state to avoid duplicates. Do not blindly retry payments, deletions or submissions. Preserve tool permission and irreversible-action approval requirements.
7. Report the evidence, failures and remaining manual steps. Replay on representative inputs and after a window move before recommending scheduling. For a scheduled or watch trigger, invoke the saved recipe autonomously, capture before/after screenshots, re-check the business postcondition and report a structured success/failure result. Never claim success from a click or screenshot alone.
8. When a run encounters an unexpected dialog, ambiguous target, missing credential, locked desktop or failed postcondition, stop safely, preserve evidence and request operator attention. Do not blindly retry submissions, payments, deletions or emails.`;
}

/** Execution contract for an already reviewed workflow and saved recipe. */
export function buildRpaAutonomousRunPrompt(brief: RpaWorkflowBrief): string {
  const normalized = normalizeRpaWorkflowBrief(brief);
  return `Execute the approved autonomous RPA workflow now.

Workflow name and saved recipe: ${normalized.name}
Application / URL / remote session: ${normalized.application}
Surface: ${normalized.surface}
Runtime inputs and parameters (no passwords): ${normalized.inputs || 'None.'}
Credential profile reference: ${normalized.credentialProfile || 'Use the approved signed-in application session.'}
Required business result and evidence:
${normalized.successCheck}

Execution requirements:
1. Check GUI_Operate runtime readiness and confirm the intended desktop is available and unlocked.
2. Find the saved recipe named exactly "${normalized.name}" and call run_recipe with the supplied runtime parameters, execution mode "${normalized.executionMode || 'ui'}", credential profile reference, and evidence capture enabled. Do not start a new recording or stop at a proposed plan.
3. Apply all existing permission and irreversible-action approval controls. Stop on a missing recipe, credential, ambiguous target, unexpected dialog or locked desktop.
4. Independently read back the application or output and verify this postcondition: ${normalized.successCheck}
5. Report a structured final result containing status, start/end time, recipe name, completed step count, evidence paths, postcondition result and any operator action required. Never claim success from a click or screenshot alone.`;
}
