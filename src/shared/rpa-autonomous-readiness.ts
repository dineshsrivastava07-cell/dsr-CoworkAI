import type { RpaWorkflowBrief } from './rpa-workflow';

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
  if (
    brief.name.trim().startsWith('[Example]') ||
    brief.application.trim().toLowerCase().startsWith('replace with')
  ) {
    issues.push('Customize and rename this example before creating an autonomous job.');
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
