import { describe, expect, it } from 'vitest';
import {
  buildRpaAutonomousRunPrompt,
  buildRpaWorkflowPrompt,
  normalizeRpaWorkflowBrief,
  type RpaWorkflowBrief,
} from '../src/shared/rpa-workflow';
import { getRpaAutonomousReadinessIssues } from '../src/renderer/components/settings/RpaWorkflowSetup';
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

  it('uses an execution contract for scheduled runs without the recording approval gate', () => {
    const prompt = buildRpaAutonomousRunPrompt({
      ...brief,
      executionMode: 'background',
      credentialProfile: 'hrms-service-account',
    });
    expect(prompt).toContain('Execute the approved autonomous RPA workflow now');
    expect(prompt).toContain('call run_recipe');
    expect(prompt).toContain('Do not start a new recording or stop at a proposed plan');
    expect(prompt).not.toContain('do not operate the application until I approve');
  });

  it('normalizes a persistable workflow configuration without credential secrets', () => {
    const normalized = normalizeRpaWorkflowBrief({
      ...brief,
      password: 'must-not-be-persisted',
      name: '  Attendance  ',
      application: ' HRMS test tenant ',
      credentialProfile: ' hrms-service-account ',
    } as RpaWorkflowBrief & { password: string });
    expect(normalized).toEqual({
      ...brief,
      name: 'Attendance',
      application: 'HRMS test tenant',
      executionMode: 'ui',
      trigger: 'manual',
      credentialProfile: 'hrms-service-account',
      scheduleAt: '',
      scheduleTimes: [],
      scheduleWeekdays: [],
      repeatEvery: 1,
      repeatUnit: 'hour',
      watchUrl: '',
      definedSteps: [],
      referenceScreenshots: [],
    });
    expect(normalized).not.toHaveProperty('password');
  });

  it('rejects invalid persisted execution and trigger values', () => {
    expect(() => normalizeRpaWorkflowBrief({ ...brief, executionMode: 'invalid' as 'ui' })).toThrow(
      'valid execution mode'
    );
    expect(() => normalizeRpaWorkflowBrief({ ...brief, trigger: 'invalid' as 'manual' })).toThrow(
      'valid trigger'
    );
  });

  it('normalizes advanced daily scheduling and includes defined process context', () => {
    const normalized = normalizeRpaWorkflowBrief({
      ...brief,
      trigger: 'daily',
      scheduleTimes: ['22:30', '08:00', '22:30', 'invalid'],
      definedSteps: [
        {
          id: 'step-1',
          action: 'click',
          target: 'Export button',
          value: '',
          notes: 'download report',
        },
      ],
      referenceScreenshots: [
        {
          id: 'screen-1',
          path: '/managed/reference.png',
          description: 'Filters selected',
          capturedAt: 123,
        },
      ],
    });
    expect(normalized.scheduleTimes).toEqual(['08:00', '22:30']);
    const prompt = buildRpaWorkflowPrompt(normalized);
    expect(prompt).toContain('Export button');
    expect(prompt).toContain('/managed/reference.png');
    expect(prompt).toContain('08:00, 22:30');
  });

  it('blocks a past one-time job with no executable process and accepts a future defined recipe', () => {
    const now = new Date('2026-09-15T22:33:00+05:30').getTime();
    expect(
      getRpaAutonomousReadinessIssues(
        { ...brief, trigger: 'once', scheduleAt: '2026-09-15T22:28', definedSteps: [] },
        { connected: true, configured: true, recipeNames: [], now }
      )
    ).toEqual([
      'Add at least one Process Studio step or finish and save a guided recording.',
      'Choose a future one-time run.',
    ]);

    expect(
      getRpaAutonomousReadinessIssues(
        {
          ...brief,
          trigger: 'once',
          scheduleAt: '2026-09-15T22:40',
          definedSteps: [
            {
              id: 'open',
              action: 'launch_app',
              target: '',
              value: 'Example Desktop',
              notes: '',
            },
          ],
        },
        { connected: true, configured: true, recipeNames: [], now }
      )
    ).toEqual([]);
  });

  it('blocks an expired interval first run before job creation', () => {
    const now = new Date('2026-09-16T08:50:00+05:30').getTime();
    expect(
      getRpaAutonomousReadinessIssues(
        {
          ...brief,
          trigger: 'interval',
          scheduleAt: '2026-09-15T22:28',
          repeatEvery: 1,
          repeatUnit: 'hour',
        },
        { connected: true, configured: true, recipeNames: [brief.name], now }
      )
    ).toContain('Choose a future first run or leave it blank to start in five minutes.');
  });
});
