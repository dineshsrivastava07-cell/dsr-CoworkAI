import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildRecipeSteps,
  deleteProcessRecipe,
  deleteReferenceScreenshot,
  listProcessRecipes,
  readReferenceScreenshot,
  retainReferenceScreenshot,
  saveDefinedRecipe,
} from '../src/main/mcp/rpa-process-studio';
import { _setRecipesDirForTesting } from '../src/main/mcp/rpa-recipe-store';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpa-process-studio-'));
  _setRecipesDirForTesting(path.join(root, 'recipes'));
});

afterEach(async () => {
  _setRecipesDirForTesting(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('RPA Process Studio', () => {
  it('builds validated executable steps with semantic click relocation', () => {
    expect(
      buildRecipeSteps([
        {
          id: '0',
          action: 'launch_app',
          target: '',
          value: 'Example Desktop',
          notes: '',
        },
        {
          id: '1',
          action: 'click',
          target: 'Save button',
          value: '',
          notes: 'save the draft',
        },
        {
          id: '2',
          action: 'type_text',
          target: 'Employee field',
          value: '{{employee_id}}',
          notes: '',
        },
        {
          id: '3',
          action: 'key_press',
          target: '',
          value: 'ctrl+s',
          notes: '',
        },
      ])
    ).toEqual([
      {
        tool: 'launch_app',
        args: { app_name: 'Example Desktop' },
      },
      {
        tool: 'click',
        args: { x: 0, y: 0, intent: 'save the draft' },
        elementDescription: 'Save button',
      },
      {
        tool: 'type_text',
        args: { text: '{{employee_id}}' },
        elementDescription: 'Employee field',
      },
      {
        tool: 'key_press',
        args: { key: 's', modifiers: ['ctrl'] },
        elementDescription: undefined,
      },
    ]);
  });

  it('saves, lists and deletes a directly defined recipe', async () => {
    const saved = await saveDefinedRecipe({
      name: 'Attendance export',
      appName: 'HRMS',
      description: 'Export attendance',
      successCheck: 'Reopen the CSV and compare the employee count',
      executionMode: 'background',
      steps: [
        {
          id: '1',
          action: 'click',
          target: 'Export button',
          value: '',
          notes: 'export the report',
        },
      ],
    });
    expect(saved.steps[0].elementDescription).toBe('Export button');
    expect(await listProcessRecipes()).toEqual([
      expect.objectContaining({ name: 'Attendance export', executionMode: 'background' }),
    ]);
    await deleteProcessRecipe('Attendance export');
    expect(await listProcessRecipes()).toEqual([]);
  });

  it('retains screenshots in the managed workflow asset directory and restricts deletion', async () => {
    const source = path.join(root, 'source.png');
    await fs.writeFile(source, 'synthetic-image');
    const retained = await retainReferenceScreenshot(
      source,
      path.join(root, 'user-data'),
      'Attendance export',
      'Report filters selected'
    );
    expect(await fs.readFile(retained.path, 'utf8')).toBe('synthetic-image');
    expect(await readReferenceScreenshot(retained.path, path.join(root, 'user-data'))).toEqual({
      data: Buffer.from('synthetic-image').toString('base64'),
      mediaType: 'image/png',
    });
    await expect(deleteReferenceScreenshot(source, path.join(root, 'user-data'))).rejects.toThrow(
      'outside'
    );
    await deleteReferenceScreenshot(retained.path, path.join(root, 'user-data'));
    await expect(fs.access(retained.path)).rejects.toThrow();
  });

  it('rejects incomplete or unsafe direct recipe definitions', async () => {
    expect(() =>
      buildRecipeSteps([{ id: '1', action: 'click', target: '', value: '', notes: '' }])
    ).toThrow('semantic target');
    expect(() =>
      buildRecipeSteps([{ id: '1', action: 'launch_app', target: '', value: '', notes: '' }])
    ).toThrow('launcher name');
    await expect(
      saveDefinedRecipe({
        name: 'Headless GUI',
        appName: 'ERP',
        successCheck: 'Record exists',
        executionMode: 'headless',
        steps: [{ id: '1', action: 'wait', target: '', value: '1000', notes: '' }],
      })
    ).rejects.toThrow('cannot run headlessly');
  });
});
