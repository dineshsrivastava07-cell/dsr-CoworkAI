import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  _setRecipesDirForTesting,
  deleteRecipe,
  fillParams,
  getRecipeByName,
  listRecipes,
  saveRecipe,
} from '../src/main/mcp/rpa-recipe-store';

// Regression coverage for the RPA "record once, replay reliably" framework's
// storage layer. Redirected to a temp dir via _setRecipesDirForTesting so
// this never touches the real ~/Library/Application Support/open-cowork
// directory a live app instance would use.
describe('rpa-recipe-store', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-recipe-store-test-'));
    _setRecipesDirForTesting(tempDir);
  });

  afterEach(() => {
    _setRecipesDirForTesting(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty list before any recipe is saved', async () => {
    expect(await listRecipes()).toEqual([]);
  });

  it('saves a recipe and lists it back without the full step data', async () => {
    const saved = await saveRecipe({
      name: 'daily_invoice_entry',
      appName: 'Tally',
      description: 'Enters the daily invoice total',
      steps: [
        { tool: 'click', args: { x: 100, y: 200 }, elementDescription: 'the Invoice Amount field' },
        { tool: 'type_text', args: { text: '{{amount}}' } },
      ],
    });

    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeTypeOf('number');

    const listed = await listRecipes();
    expect(listed).toEqual([
      {
        id: saved.id,
        name: 'daily_invoice_entry',
        appName: 'Tally',
        description: 'Enters the daily invoice total',
      },
    ]);
  });

  it('round-trips the full recipe including steps via getRecipeByName', async () => {
    await saveRecipe({
      name: 'weekly_report',
      appName: 'ERP',
      steps: [{ tool: 'click', args: { x: 1, y: 2 }, elementDescription: 'the Generate button' }],
    });

    const fetched = await getRecipeByName('weekly_report');
    expect(fetched?.steps).toEqual([
      { tool: 'click', args: { x: 1, y: 2 }, elementDescription: 'the Generate button' },
    ]);
  });

  it('overwrites an existing recipe with the same name instead of duplicating it', async () => {
    await saveRecipe({ name: 'dup', appName: 'App', steps: [] });
    await saveRecipe({ name: 'dup', appName: 'App', steps: [{ tool: 'wait', args: { ms: 500 } }] });

    const listed = await listRecipes();
    expect(listed).toHaveLength(1);

    const fetched = await getRecipeByName('dup');
    expect(fetched?.steps).toHaveLength(1);
  });

  it('deletes a recipe by name', async () => {
    await saveRecipe({ name: 'to_delete', appName: 'App', steps: [] });
    expect(await listRecipes()).toHaveLength(1);

    await deleteRecipe('to_delete');
    expect(await listRecipes()).toHaveLength(0);
  });

  it('persists recipes across separate calls (real file I/O, not just in-memory)', async () => {
    await saveRecipe({ name: 'persisted', appName: 'App', steps: [] });

    // A fresh call re-reads from disk each time (no shared in-memory cache) —
    // this confirms the data actually survived being written to the temp dir.
    const fetched = await getRecipeByName('persisted');
    expect(fetched).toBeDefined();
    expect(fs.existsSync(path.join(tempDir, 'recipes.json'))).toBe(true);
  });
});

describe('fillParams', () => {
  it('substitutes {{placeholder}} tokens in string values with the given params', () => {
    const result = fillParams({ text: 'Invoice total: {{amount}}' }, { amount: '4500' });
    expect(result.text).toBe('Invoice total: 4500');
  });

  it('leaves non-string values untouched', () => {
    const result = fillParams({ x: 100, y: 200 }, { amount: '4500' });
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('leaves an unmatched placeholder as-is rather than substituting undefined', () => {
    const result = fillParams({ text: 'Date: {{today}}' }, { amount: '4500' });
    expect(result.text).toBe('Date: {{today}}');
  });

  it('returns args unchanged when params is undefined', () => {
    const args = { text: '{{amount}}' };
    expect(fillParams(args, undefined)).toEqual(args);
  });

  it('substitutes multiple distinct placeholders in the same string', () => {
    const result = fillParams(
      { text: '{{customer}} owes {{amount}}' },
      { customer: 'Acme Corp', amount: '4500' }
    );
    expect(result.text).toBe('Acme Corp owes 4500');
  });
});
