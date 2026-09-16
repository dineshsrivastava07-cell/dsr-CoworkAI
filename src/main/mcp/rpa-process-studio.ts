import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  RpaDefinedStep,
  RpaRecipeDefinitionInput,
  RpaReferenceScreenshot,
} from '../../shared/rpa-workflow';
import {
  deleteRecipe,
  listRecipes,
  saveRecipe,
  type RpaRecipe,
  type RpaStep,
} from './rpa-recipe-store';

export function buildRecipeSteps(steps: RpaDefinedStep[]): RpaStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Add at least one process step before saving the executable recipe.');
  }
  if (steps.length > 200) throw new Error('A recipe can contain at most 200 steps.');
  return steps.map((step, index) => buildRecipeStep(step, index));
}

function buildRecipeStep(step: RpaDefinedStep, index: number): RpaStep {
  const position = index + 1;
  const target = String(step.target || '').trim();
  const value = String(step.value || '').trim();
  const notes = String(step.notes || '').trim();
  if (target.length > 2_000 || notes.length > 2_000 || value.length > 20_000) {
    throw new Error(`Step ${position}: target, value or notes are too long.`);
  }
  if (step.action === 'launch_app') {
    if (!value) throw new Error(`Step ${position}: open application requires a launcher name.`);
    return { tool: 'launch_app', args: { app_name: value } };
  }
  if (step.action === 'click') {
    if (!target) throw new Error(`Step ${position}: click requires a semantic target.`);
    return {
      tool: 'click',
      args: { x: 0, y: 0, intent: notes || target },
      elementDescription: target,
    };
  }
  if (step.action === 'type_text') {
    if (!value) throw new Error(`Step ${position}: type text requires text or a {{parameter}}.`);
    return { tool: 'type_text', args: { text: value }, elementDescription: target || undefined };
  }
  if (step.action === 'key_press') {
    const parts = value
      .toLowerCase()
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean);
    const key = parts.pop();
    if (!key) throw new Error(`Step ${position}: key press requires a key.`);
    const modifiers = parts.map((part) => (part === 'control' ? 'ctrl' : part));
    if (modifiers.some((part) => !['ctrl', 'cmd', 'shift', 'alt'].includes(part))) {
      throw new Error(`Step ${position}: use only ctrl, cmd, shift or alt as key modifiers.`);
    }
    return { tool: 'key_press', args: { key, modifiers }, elementDescription: target || undefined };
  }
  if (step.action === 'wait') {
    const duration = Number(value || '1000');
    if (!Number.isFinite(duration) || duration < 100 || duration > 60_000) {
      throw new Error(`Step ${position}: wait must be between 100 and 60000 milliseconds.`);
    }
    return {
      tool: 'wait',
      args: { duration: Math.floor(duration), reason: notes || undefined },
    };
  }
  if (step.action === 'scroll') {
    const [rawDirection, rawAmount] = (value || 'down:3').split(':');
    const direction = rawDirection.toLowerCase();
    const amount = Number(rawAmount || '3');
    if (!['up', 'down', 'left', 'right'].includes(direction) || !Number.isFinite(amount)) {
      throw new Error(`Step ${position}: scroll value must look like down:3.`);
    }
    return {
      tool: 'scroll',
      args: {
        coordinate_type: 'normalized',
        x: 500,
        y: 500,
        direction,
        amount: Math.max(1, Math.min(100, Math.floor(amount))),
      },
      elementDescription: target || undefined,
    };
  }
  if (step.action === 'drag') {
    const coordinates = value.split(',').map(Number);
    if (
      coordinates.length !== 4 ||
      coordinates.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      throw new Error(`Step ${position}: drag value must be fromX,fromY,toX,toY.`);
    }
    const [fromX, fromY, toX, toY] = coordinates;
    if (coordinates.some((coordinate) => coordinate < 0 || coordinate > 1000)) {
      throw new Error(`Step ${position}: drag coordinates must be normalized from 0 to 1000.`);
    }
    return {
      tool: 'drag',
      args: {
        coordinate_type: 'normalized',
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
      },
      elementDescription: target || undefined,
    };
  }
  throw new Error(`Step ${position}: unsupported action.`);
}

export async function saveDefinedRecipe(input: RpaRecipeDefinitionInput): Promise<RpaRecipe> {
  const name = input.name.trim();
  const appName = input.appName.trim();
  const successCheck = input.successCheck.trim();
  if (!name || !appName || !successCheck) {
    throw new Error('Workflow name, application and success check are required.');
  }
  if (
    name.length > 200 ||
    appName.length > 2_000 ||
    successCheck.length > 20_000 ||
    (input.description?.length || 0) > 20_000
  ) {
    throw new Error('Recipe name, application, description or success check is too long.');
  }
  if (input.executionMode === 'headless') {
    throw new Error('A desktop recipe cannot run headlessly. Use browser or API tools instead.');
  }
  return saveRecipe({
    name,
    appName,
    description: input.description?.trim() || undefined,
    steps: buildRecipeSteps(input.steps),
    executionMode: input.executionMode || 'ui',
    credentialProfile: input.credentialProfile?.trim() || undefined,
    successCheck,
  });
}

export async function listProcessRecipes() {
  return listRecipes();
}

export async function deleteProcessRecipe(name: string): Promise<void> {
  if (!name.trim()) throw new Error('Recipe name is required.');
  await deleteRecipe(name.trim());
}

export function extractScreenshotPath(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  for (const block of content || []) {
    if (block.type !== 'text' || !block.text) continue;
    try {
      const parsed = JSON.parse(block.text) as { success?: boolean; path?: string };
      if (parsed.success && parsed.path) return parsed.path;
    } catch {
      // Continue to another text block; MCP results can contain explanatory text.
    }
  }
  throw new Error('The desktop connector did not return a screenshot path.');
}

export async function retainReferenceScreenshot(
  sourcePath: string,
  userDataDir: string,
  workflowName: string,
  description: string
): Promise<RpaReferenceScreenshot> {
  const safeName = workflowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!safeName) throw new Error('Enter a workflow name before capturing a reference screenshot.');
  const root = path.join(userDataDir, 'rpa-process-assets');
  const directory = path.join(root, safeName);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}-${randomUUID()}.png`);
  await fs.copyFile(sourcePath, destination);
  return {
    id: randomUUID(),
    path: destination,
    description: description.trim().slice(0, 1_000),
    capturedAt: Date.now(),
  };
}

export async function deleteReferenceScreenshot(
  assetPath: string,
  userDataDir: string
): Promise<void> {
  const resolved = resolveReferenceScreenshotPath(assetPath, userDataDir);
  await fs.unlink(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function readReferenceScreenshot(
  assetPath: string,
  userDataDir: string
): Promise<{ data: string; mediaType: 'image/png' }> {
  const resolved = resolveReferenceScreenshotPath(assetPath, userDataDir);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) {
    throw new Error('Reference screenshot must be a PNG file no larger than 10 MB.');
  }
  return { data: (await fs.readFile(resolved)).toString('base64'), mediaType: 'image/png' };
}

function resolveReferenceScreenshotPath(assetPath: string, userDataDir: string): string {
  const root = path.resolve(userDataDir, 'rpa-process-assets');
  const resolved = path.resolve(assetPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Reference screenshot path is outside the managed RPA asset directory.');
  }
  if (path.extname(resolved).toLowerCase() !== '.png') {
    throw new Error('Reference screenshot must be a PNG file.');
  }
  return resolved;
}
