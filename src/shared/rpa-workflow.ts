export interface RpaWorkflowBrief {
  name: string;
  surface: 'desktop' | 'web' | 'remote';
  application: string;
  inputs: string;
  steps: string;
  successCheck: string;
  executionMode?: 'ui' | 'background' | 'headless';
  credentialProfile?: string;
  trigger?: 'manual' | 'schedule' | 'watch';
  scheduleAt?: string;
  watchUrl?: string;
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
  if (!['desktop', 'web', 'remote'].includes(brief.surface)) {
    throw new Error('Choose a valid application type.');
  }
  const executionMode = brief.executionMode || 'ui';
  const trigger = brief.trigger || 'manual';
  if (!['ui', 'background', 'headless'].includes(executionMode)) {
    throw new Error('Choose a valid execution mode.');
  }
  if (!['manual', 'schedule', 'watch'].includes(trigger)) {
    throw new Error('Choose a valid trigger.');
  }
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
    watchUrl: brief.watchUrl?.trim() || '',
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
${normalized.watchUrl ? `- Trigger URL: ${normalized.watchUrl}` : ''}

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
