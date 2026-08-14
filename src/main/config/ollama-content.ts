/**
 * Shared Ollama chat-completion helper for content-generation MCP servers
 * (office-tools-server, and future consumers).
 *
 * Deliberately has zero Electron/electron-store dependency: this module is
 * bundled standalone into MCP servers that run as plain Node child processes
 * (see scripts/bundle-mcp.js), which do not have an Electron runtime and
 * cannot import config-store.ts (electron-store requires `app`). Connection
 * settings therefore come from explicit `opts` (for main-process callers that
 * already have config-store access) or from OLLAMA_BASE_URL/OLLAMA_API_KEY
 * env vars — which mcp-manager.ts injects from the user's configured Ollama
 * profile when spawning built-in servers (see connectServerInternal).
 */

import { normalizeOllamaBaseUrl, DEFAULT_OLLAMA_BASE_URL } from '../../shared/ollama-base-url';

export type TaskComplexity = 'simple' | 'complex';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model?: string;
  temperature?: number;
  numPredict?: number;
  timeoutMs?: number;
  baseUrl?: string;
  apiKey?: string;
}

const FAST_MODEL_ENV = 'OLLAMA_MODEL';
const CAPABLE_MODEL_ENV = 'OLLAMA_MODEL_CAPABLE';
export const DEFAULT_FAST_MODEL = 'gemma4:e4b';
export const DEFAULT_CAPABLE_MODEL = 'gemma4:26b';

interface OllamaConnection {
  baseUrl: string;
  apiKey?: string;
}

function resolveOllamaConnection(opts: OllamaChatOptions): OllamaConnection {
  if (opts.baseUrl) {
    return {
      baseUrl: normalizeOllamaBaseUrl(opts.baseUrl) || DEFAULT_OLLAMA_BASE_URL,
      apiKey: opts.apiKey,
    };
  }
  const envBaseUrl = process.env.OLLAMA_BASE_URL?.trim();
  if (envBaseUrl) {
    return {
      baseUrl: normalizeOllamaBaseUrl(envBaseUrl) || DEFAULT_OLLAMA_BASE_URL,
      apiKey: opts.apiKey ?? process.env.OLLAMA_API_KEY?.trim() ?? undefined,
    };
  }
  return { baseUrl: DEFAULT_OLLAMA_BASE_URL, apiKey: opts.apiKey };
}

/** Cheap model for short/simple asks; larger model for source-file-driven or otherwise complex asks. */
export function pickModelForTask(complexity: TaskComplexity): string {
  if (complexity === 'complex') {
    return process.env[CAPABLE_MODEL_ENV]?.trim() || DEFAULT_CAPABLE_MODEL;
  }
  return process.env[FAST_MODEL_ENV]?.trim() || DEFAULT_FAST_MODEL;
}

/**
 * Single-shot chat completion against an OpenAI-compatible Ollama endpoint.
 * Returns the raw assistant message content, or null on any failure (network,
 * timeout, non-2xx, malformed response) — callers are expected to fall back.
 */
export async function callOllamaChat(
  messages: OllamaChatMessage[],
  opts: OllamaChatOptions = {}
): Promise<string | null> {
  const conn = resolveOllamaConnection(opts);
  const model = opts.model || pickModelForTask('simple');

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (conn.apiKey) {
      headers.Authorization = `Bearer ${conn.apiKey}`;
    }

    const resp = await fetch(`${conn.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.numPredict ?? 4000,
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** Strips markdown fences and extracts the outermost {...} JSON object from a model response. */
export function extractJsonObject(content: string): string | null {
  const stripped = content.replace(/```(?:json)?|```/g, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\s*(?:x|goal|achievement|insert[^\]]*|todo|placeholder|t0d|fill\s*in[^\]]*)\s*\]/i,
  /\$\s*x\b/i,
  /\blorem ipsum\b/i,
  /\bkey win\b/i,
  /\bchallenge\s*\d\b/i,
];

export interface ContentValidationResult {
  valid: boolean;
  reason?: string;
}

/** Rejects AI-generated content JSON containing bracket/generic placeholder text instead of real content. */
export function validateGeneratedContent(rawJson: string): ContentValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { valid: false, reason: 'not_valid_json' };
  }
  const text = JSON.stringify(parsed);
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason: `placeholder_detected:${pattern.source}` };
    }
  }
  return { valid: true, reason: undefined };
}
