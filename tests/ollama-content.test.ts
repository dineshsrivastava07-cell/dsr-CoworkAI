import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callOllamaChat,
  DEFAULT_CAPABLE_MODEL,
  DEFAULT_FAST_MODEL,
  extractJsonObject,
  pickModelForTask,
  validateGeneratedContent,
} from '../src/main/config/ollama-content';

const ENV_KEYS = [
  'OLLAMA_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_MODEL',
  'OLLAMA_MODEL_CAPABLE',
] as const;

describe('ollama-content helper', () => {
  const originalFetch = global.fetch;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    global.fetch = vi.fn();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('pickModelForTask', () => {
    it('defaults to the fast model for simple tasks', () => {
      expect(pickModelForTask('simple')).toBe(DEFAULT_FAST_MODEL);
    });

    it('defaults to the capable model for complex tasks', () => {
      expect(pickModelForTask('complex')).toBe(DEFAULT_CAPABLE_MODEL);
    });

    it('respects OLLAMA_MODEL override for simple tasks', () => {
      process.env.OLLAMA_MODEL = 'custom-fast:1b';
      expect(pickModelForTask('simple')).toBe('custom-fast:1b');
    });

    it('respects OLLAMA_MODEL_CAPABLE override for complex tasks', () => {
      process.env.OLLAMA_MODEL_CAPABLE = 'custom-capable:70b';
      expect(pickModelForTask('complex')).toBe('custom-capable:70b');
    });
  });

  describe('callOllamaChat', () => {
    it('posts to the default localhost base URL when nothing else is configured', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await callOllamaChat([{ role: 'user', content: 'hi' }]);

      expect(result).toBe('{"ok":true}');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('uses OLLAMA_BASE_URL / OLLAMA_API_KEY env vars when set (built-in servers get these from mcp-manager)', async () => {
      process.env.OLLAMA_BASE_URL = 'http://ollama.internal:11434';
      process.env.OLLAMA_API_KEY = 'secret-key';
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        })
      );

      await callOllamaChat([{ role: 'user', content: 'hi' }]);

      const [url, init] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('http://ollama.internal:11434/v1/chat/completions');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    });

    it('explicit opts.baseUrl/opts.apiKey take precedence over env vars', async () => {
      process.env.OLLAMA_BASE_URL = 'http://env-configured:11434';
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        })
      );

      await callOllamaChat([{ role: 'user', content: 'hi' }], {
        baseUrl: 'http://explicit:11434',
        apiKey: 'explicit-key',
      });

      const [url, init] = vi.mocked(global.fetch).mock.calls[0];
      expect(url).toBe('http://explicit:11434/v1/chat/completions');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer explicit-key');
    });

    it('returns null on a non-2xx response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(new Response('server error', { status: 500 }));
      expect(await callOllamaChat([{ role: 'user', content: 'hi' }])).toBeNull();
    });

    it('returns null on network failure instead of throwing', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await callOllamaChat([{ role: 'user', content: 'hi' }])).toBeNull();
    });
  });

  describe('extractJsonObject', () => {
    it('strips markdown fences and extracts the outer JSON object', () => {
      expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('returns null when there is no JSON object in the content', () => {
      expect(extractJsonObject('no json here')).toBeNull();
    });
  });

  describe('validateGeneratedContent', () => {
    it('accepts well-formed content with no placeholders', () => {
      const result = validateGeneratedContent(
        JSON.stringify({ sheets: [{ name: 'Q1 Sales', headers: ['Month'], rows: [['Jan']] }] })
      );
      expect(result.valid).toBe(true);
    });

    it('rejects invalid JSON', () => {
      expect(validateGeneratedContent('{not json')).toEqual({
        valid: false,
        reason: 'not_valid_json',
      });
    });

    it.each([
      '{"text":"Achieved [Goal] this quarter"}',
      '{"text":"Revenue grew by $X percent"}',
      '{"text":"Key win: shipped the feature"}',
      '{"text":"Challenge 1 was resourcing"}',
    ])('rejects bracket/generic placeholder content: %s', (json) => {
      expect(validateGeneratedContent(json).valid).toBe(false);
    });
  });
});
