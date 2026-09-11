/**
 * JSON file store for RPA recipes — recorded sequences of GUI_Operate
 * actions that can be replayed against any app for recurring daily
 * operational tasks. Low-volume structured data, so a JSON file (not a new
 * SQLite table) is the right-sized store, matching this codebase's existing
 * lightweight-store precedent (remote-config-store.ts).
 *
 * This module runs inside the gui-operate-server.ts child process, which has
 * no Electron `app` access, so the storage path is computed the same way
 * that file already computes its own (OPEN_COWORK_DATA_DIR) rather than via
 * app.getPath('userData').
 */
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

const OPEN_COWORK_DATA_DIR =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork')
    : path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork');

const DEFAULT_RPA_RECIPES_DIR = path.join(OPEN_COWORK_DATA_DIR, 'rpa_recipes');

/** Test-only override so tests can redirect storage to a temp dir instead of the real home directory. */
let recipesDirOverride: string | null = null;
export function _setRecipesDirForTesting(dir: string | null): void {
  recipesDirOverride = dir;
}
function getRecipesDir(): string {
  return recipesDirOverride ?? DEFAULT_RPA_RECIPES_DIR;
}
function getRecipesFile(): string {
  return path.join(getRecipesDir(), 'recipes.json');
}

export interface RpaStep {
  tool: 'click' | 'type_text' | 'key_press' | 'scroll' | 'drag' | 'wait';
  args: Record<string, unknown>;
  /** Semantic description of the target ("the Save button") — used to re-locate the element on replay instead of trusting stale coordinates. */
  elementDescription?: string;
}

export interface RpaRecipe {
  id: string;
  name: string;
  appName: string;
  description?: string;
  steps: RpaStep[];
  createdAt: number;
  updatedAt: number;
}

interface RecipeFileShape {
  recipes: RpaRecipe[];
}

function ensureDirSync(): void {
  const dir = getRecipesDir();
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

async function readAll(): Promise<RecipeFileShape> {
  try {
    const raw = await fs.readFile(getRecipesFile(), 'utf8');
    const parsed = JSON.parse(raw) as RecipeFileShape;
    return { recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [] };
  } catch {
    return { recipes: [] };
  }
}

async function writeAll(data: RecipeFileShape): Promise<void> {
  ensureDirSync();
  await fs.mkdir(getRecipesDir(), { recursive: true });
  await fs.writeFile(getRecipesFile(), JSON.stringify(data, null, 2), 'utf8');
}

export async function listRecipes(): Promise<
  Pick<RpaRecipe, 'id' | 'name' | 'appName' | 'description'>[]
> {
  const { recipes } = await readAll();
  return recipes.map(({ id, name, appName, description }) => ({ id, name, appName, description }));
}

export async function getRecipeByName(name: string): Promise<RpaRecipe | undefined> {
  const { recipes } = await readAll();
  return recipes.find((r) => r.name === name);
}

export async function saveRecipe(
  recipe: Omit<RpaRecipe, 'id' | 'createdAt' | 'updatedAt'>
): Promise<RpaRecipe> {
  const data = await readAll();
  const existing = data.recipes.find((r) => r.name === recipe.name);
  const now = Date.now();
  if (existing) {
    existing.appName = recipe.appName;
    existing.description = recipe.description;
    existing.steps = recipe.steps;
    existing.updatedAt = now;
    await writeAll(data);
    return existing;
  }
  const created: RpaRecipe = {
    ...recipe,
    id: `recipe_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  data.recipes.push(created);
  await writeAll(data);
  return created;
}

export async function deleteRecipe(name: string): Promise<void> {
  const data = await readAll();
  data.recipes = data.recipes.filter((r) => r.name !== name);
  await writeAll(data);
}

/** Substitutes {{param}} tokens in string arg values with params[param]. Non-string values pass through unchanged. */
export function fillParams(
  args: Record<string, unknown>,
  params: Record<string, string> | undefined
): Record<string, unknown> {
  if (!params) return args;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (match, paramName) =>
        Object.prototype.hasOwnProperty.call(params, paramName) ? params[paramName] : match
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
