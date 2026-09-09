import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_RESULT_TEXT_LENGTH,
  truncateOversizedToolResult,
} from '../src/main/mcp/mcp-manager';

// Regression test for a real production failure: a browser-automation
// "take_snapshot" call against amazon.in returned a 103,100-character raw
// accessibility-tree dump. Feeding that whole block into the model's context
// right before its next decision caused every provider tested (gemma4:e4b,
// gemma4:26b, and Gemini) to derail into a hallucinated, unrelated task —
// not because the context window overflowed (total usage stayed well under
// budget), but because that much low-signal noise in one turn made it
// impossible for any model to stay anchored on the actual task. This caps
// oversized text content from ANY MCP tool result before it reaches the agent.
describe('truncateOversizedToolResult', () => {
  it('leaves small results completely untouched', () => {
    const result = { content: [{ type: 'text', text: 'short result' }] };
    expect(truncateOversizedToolResult(result)).toBe(result);
  });

  it('truncates a text block exceeding the size cap and appends a clear notice', () => {
    const hugeText = 'x'.repeat(MAX_TOOL_RESULT_TEXT_LENGTH + 5000);
    const result = { content: [{ type: 'text', text: hugeText }] };

    const truncated = truncateOversizedToolResult(result) as {
      content: { type: string; text: string }[];
    };

    expect(truncated.content[0].text.length).toBeLessThan(hugeText.length);
    expect(truncated.content[0].text).toContain(`[...truncated, 5000 more characters`);
    expect(truncated.content[0].text.startsWith('x'.repeat(100))).toBe(true);
  });

  it('reproduces the exact real-world scenario: a 103,100-character page snapshot', () => {
    const snapshotText = 'uid=1_0 RootWebArea "Amazon.in"\n'.repeat(3300); // > 100,000 chars
    expect(snapshotText.length).toBeGreaterThan(100000);
    const result = { content: [{ type: 'text', text: snapshotText }] };

    const truncated = truncateOversizedToolResult(result) as {
      content: { type: string; text: string }[];
    };

    expect(truncated.content[0].text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_TEXT_LENGTH + 300);
  });

  it('only truncates the oversized block, leaving other blocks in the same result untouched', () => {
    const hugeText = 'y'.repeat(MAX_TOOL_RESULT_TEXT_LENGTH + 1000);
    const result = {
      content: [
        { type: 'text', text: 'small preamble' },
        { type: 'text', text: hugeText },
      ],
    };

    const truncated = truncateOversizedToolResult(result) as {
      content: { type: string; text: string }[];
    };

    expect(truncated.content[0].text).toBe('small preamble');
    expect(truncated.content[1].text.length).toBeLessThan(hugeText.length);
  });

  it('preserves isError and other top-level fields on the result', () => {
    const hugeText = 'z'.repeat(MAX_TOOL_RESULT_TEXT_LENGTH + 1000);
    const result = { isError: true, content: [{ type: 'text', text: hugeText }] };

    const truncated = truncateOversizedToolResult(result) as { isError: boolean };
    expect(truncated.isError).toBe(true);
  });

  it('is a no-op for non-object, missing-content, or non-array-content results', () => {
    expect(truncateOversizedToolResult(null)).toBe(null);
    expect(truncateOversizedToolResult('a string result')).toBe('a string result');
    expect(truncateOversizedToolResult({ content: 'not an array' })).toEqual({
      content: 'not an array',
    });
    expect(truncateOversizedToolResult({})).toEqual({});
  });

  it('leaves non-text content blocks (e.g. images) untouched even in an oversized result', () => {
    const hugeText = 'w'.repeat(MAX_TOOL_RESULT_TEXT_LENGTH + 1000);
    const result = {
      content: [
        { type: 'image', data: 'base64...', mimeType: 'image/png' },
        { type: 'text', text: hugeText },
      ],
    };

    const truncated = truncateOversizedToolResult(result) as {
      content: { type: string; data?: string; text?: string }[];
    };

    expect(truncated.content[0]).toEqual({
      type: 'image',
      data: 'base64...',
      mimeType: 'image/png',
    });
    expect(truncated.content[1].text!.length).toBeLessThan(hugeText.length);
  });
});
