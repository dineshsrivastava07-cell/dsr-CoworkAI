export type ScreenshotPurpose = 'display' | 'verification';

export function canReuseScreenshot(
  purpose: ScreenshotPurpose,
  capturedAt: number,
  now: number,
  reuseWindowMs: number
): boolean {
  if (purpose === 'verification') return false;
  const age = now - capturedAt;
  return age >= 0 && age <= reuseWindowMs;
}
