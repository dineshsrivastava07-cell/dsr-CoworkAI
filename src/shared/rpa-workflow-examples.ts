import type { RpaWorkflowBrief } from './rpa-workflow';

const emptySchedulingFields = {
  credentialProfile: '',
  scheduleAt: '',
  scheduleTimes: [] as string[],
  scheduleWeekdays: [] as number[],
  repeatEvery: 1,
  repeatUnit: 'hour' as const,
  watchUrl: '',
  referenceScreenshots: [],
};

export const RPA_WORKFLOW_EXAMPLES: readonly RpaWorkflowBrief[] = [
  {
    ...emptySchedulingFields,
    name: '[Example] One-time desktop app check',
    surface: 'desktop',
    application: 'Calculator',
    inputs: 'No business inputs. Replace Calculator if required on this operating system.',
    steps:
      'Open Calculator, clear its state, calculate 12 + 8 = 20, multiply that result by 5 = 100, then subtract 25 for a final result of 75.',
    successCheck:
      'Independently read the Calculator display and require exactly 75. If the app is not frontmost, input is rejected, an unexpected dialog appears, the result differs, or evidence cannot be read, stop and report failure with the captured evidence; do not blindly retry.',
    executionMode: 'ui',
    trigger: 'once',
    definedSteps: [
      {
        id: 'example-once-launch',
        action: 'launch_app',
        target: '',
        value: 'Calculator',
        notes: 'Use the installed launcher name for this operating system.',
      },
      {
        id: 'example-once-wait',
        action: 'wait',
        target: '',
        value: '1000',
        notes: 'Wait for the application window.',
      },
      {
        id: 'example-once-clear',
        action: 'key_press',
        target: 'Calculator input',
        value: 'escape',
        notes: 'Clear any prior calculation; stop if Calculator is not active.',
      },
      {
        id: 'example-once-first-expression',
        action: 'type_text',
        target: 'Calculator input',
        value: '12+8',
        notes: 'First calculation stage; expected result after Enter is 20.',
      },
      {
        id: 'example-once-first-enter',
        action: 'key_press',
        target: 'Calculator input',
        value: 'enter',
        notes: 'Evaluate 12 + 8.',
      },
      {
        id: 'example-once-second-expression',
        action: 'type_text',
        target: 'Calculator input',
        value: '*5',
        notes: 'Multiply the current result 20 by 5; expected result after Enter is 100.',
      },
      {
        id: 'example-once-second-enter',
        action: 'key_press',
        target: 'Calculator input',
        value: 'enter',
        notes: 'Evaluate 20 × 5.',
      },
      {
        id: 'example-once-third-expression',
        action: 'type_text',
        target: 'Calculator input',
        value: '-25',
        notes: 'Subtract 25 from the current result 100.',
      },
      {
        id: 'example-once-third-enter',
        action: 'key_press',
        target: 'Calculator input',
        value: 'enter',
        notes: 'Evaluate 100 − 25; expected final result is 75.',
      },
      {
        id: 'example-once-result-wait',
        action: 'wait',
        target: '',
        value: '800',
        notes: 'Allow the final display to settle before evidence capture and read-back.',
      },
    ],
  },
  {
    ...emptySchedulingFields,
    name: '[Example] Daily ERP exception review',
    surface: 'desktop',
    application: 'Replace with ERP desktop client',
    inputs: '{{business_date}}, {{business_unit}}',
    steps:
      'Open the approved ERP client, select the business unit and date, refresh the exception queue, and leave the result in read-only view.',
    successCheck:
      'Read back the tenant, business unit, date, exception count and refresh timestamp; do not submit or change records.',
    executionMode: 'ui',
    trigger: 'daily',
    scheduleTimes: ['09:00', '18:00'],
    definedSteps: [
      {
        id: 'example-daily-launch',
        action: 'launch_app',
        target: '',
        value: 'Replace with ERP desktop client',
        notes: 'Replace this launcher before saving a recipe.',
      },
      {
        id: 'example-daily-refresh',
        action: 'click',
        target: 'Exception queue refresh button',
        value: '',
        notes: 'Locate semantically; keep this sample read-only.',
      },
      {
        id: 'example-daily-wait',
        action: 'wait',
        target: '',
        value: '2000',
        notes: 'Wait for the refreshed timestamp and count.',
      },
    ],
  },
  {
    ...emptySchedulingFields,
    name: '[Example] Weekly HRMS attendance export',
    surface: 'web',
    application: 'Replace with HRMS test URL and tenant',
    inputs: '{{week_start}}, {{department}}, {{output_folder}}',
    steps:
      'Open the approved HRMS test tenant, select the week and department, export attendance, and reopen the downloaded file.',
    successCheck:
      'Verify tenant, week, department, employee count, file path and exported row count against the HRMS result.',
    executionMode: 'ui',
    trigger: 'weekly',
    scheduleTimes: ['10:00'],
    scheduleWeekdays: [1],
    definedSteps: [],
  },
  {
    ...emptySchedulingFields,
    name: '[Example] Repeating desktop queue monitor',
    surface: 'desktop',
    application: 'Replace with queue monitor application',
    inputs: '{{queue_name}}, {{alert_threshold}}',
    steps:
      'Open the queue monitor, select the approved queue, refresh it, and record the visible pending and failed counts.',
    successCheck:
      'Read back queue identity, refresh time, pending count and failed count; report an alert when the approved threshold is exceeded.',
    executionMode: 'background',
    trigger: 'interval',
    repeatEvery: 30,
    repeatUnit: 'minute',
    definedSteps: [
      {
        id: 'example-interval-launch',
        action: 'launch_app',
        target: '',
        value: 'Replace with queue monitor application',
        notes: 'Replace this launcher before saving a recipe.',
      },
      {
        id: 'example-interval-refresh',
        action: 'click',
        target: 'Queue refresh button',
        value: '',
        notes: 'Locate semantically and do not alter queue items.',
      },
      {
        id: 'example-interval-wait',
        action: 'wait',
        target: '',
        value: '2000',
        notes: 'Wait for counts and refresh time to settle.',
      },
    ],
  },
  {
    ...emptySchedulingFields,
    name: '[Example] HTTP-triggered reconciliation review',
    surface: 'web',
    application: 'Replace with reconciliation application URL',
    inputs: '{{batch_id}}, {{business_date}} from the authorized trigger payload or source.',
    steps:
      'When the authorized endpoint changes, open the reconciliation view for the batch and compare source and destination totals.',
    successCheck:
      'Verify batch ID, business date, record counts, debit/credit totals and reconciliation status; report mismatches without posting adjustments.',
    executionMode: 'ui',
    trigger: 'watch',
    definedSteps: [],
  },
] as const;
