import { describe, expect, it } from 'vitest';
import { buildOpenAIVisionTokenLimit } from '../src/main/mcp/vision-request-compat';

describe('GUI vision request compatibility', () => {
  it('uses the standard chat-completions token field initially', () => {
    expect(buildOpenAIVisionTokenLimit(2048, false)).toEqual({ max_tokens: 2048 });
  });

  it('retries with max_completion_tokens when the provider rejects max_tokens', () => {
    expect(
      buildOpenAIVisionTokenLimit(
        2048,
        true,
        "API request failed: 400 - Unsupported parameter: 'max_tokens' is not supported"
      )
    ).toEqual({ max_completion_tokens: 2048 });
  });

  it('does not change the token field for an unrelated compatibility error', () => {
    expect(buildOpenAIVisionTokenLimit(2048, true, 'Instructions are required')).toEqual({
      max_tokens: 2048,
    });
  });
});
