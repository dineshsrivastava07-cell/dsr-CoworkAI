import { describe, expect, it } from 'vitest';
import { buildRpaWorkflowPrompt, type RpaWorkflowBrief } from '../src/shared/rpa-workflow';
const brief: RpaWorkflowBrief = {
  name: 'Attendance',
  surface: 'web',
  application: 'HRMS test tenant',
  inputs: '{{report_date}}',
  steps: 'Export attendance CSV',
  successCheck: 'Reopen CSV and compare employee count',
};
describe('RPA workflow setup handoff', () => {
  it('keeps business inputs and verification requirements in the review request', () => {
    const prompt = buildRpaWorkflowPrompt(brief);
    expect(prompt).toContain(brief.successCheck);
    expect(prompt).toContain('{{report_date}}');
    expect(prompt).toContain('do not operate the application until I approve');
    expect(prompt).toContain('do not promise they record browser-tool/API actions');
  });
  it('requires a business success check before producing instructions', () => {
    expect(() => buildRpaWorkflowPrompt({ ...brief, successCheck: '' })).toThrow();
  });
  it('explains remote-session scope instead of claiming a distributed worker', () => {
    expect(buildRpaWorkflowPrompt({ ...brief, surface: 'remote' })).toContain(
      'does not deploy workers to remote machines'
    );
  });

  it('includes autonomous execution, credential profile and evidence requirements', () => {
    const prompt = buildRpaWorkflowPrompt({
      ...brief,
      executionMode: 'background',
      trigger: 'schedule',
      credentialProfile: 'hrms-service-account',
      scheduleAt: '2030-01-01T09:00',
    });
    expect(prompt).toContain('Execution mode: background');
    expect(prompt).toContain('hrms-service-account');
    expect(prompt).toContain('invoke the saved recipe autonomously');
    expect(prompt).toContain('postcondition');
    expect(prompt).not.toContain('password:');
  });
});
