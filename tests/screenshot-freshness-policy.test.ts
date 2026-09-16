import { describe, expect, it } from 'vitest';
import { canReuseScreenshot } from '../src/main/mcp/screenshot-freshness-policy';

describe('GUI screenshot freshness policy', () => {
  it('never reuses a screenshot for postcondition verification', () => {
    expect(canReuseScreenshot('verification', 1_000, 1_001, 300_000)).toBe(false);
  });

  it('allows a recent display screenshot and rejects expired or future captures', () => {
    expect(canReuseScreenshot('display', 1_000, 2_000, 5_000)).toBe(true);
    expect(canReuseScreenshot('display', 1_000, 7_000, 5_000)).toBe(false);
    expect(canReuseScreenshot('display', 3_000, 2_000, 5_000)).toBe(false);
  });
});
