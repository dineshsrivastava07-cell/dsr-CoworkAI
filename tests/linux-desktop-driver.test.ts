import { describe, expect, it } from 'vitest';
import { parseXrandrDisplays } from '../src/main/mcp/linux-desktop-driver';

describe('Linux desktop driver', () => {
  it('parses primary and offset xrandr displays', () => {
    const config = parseXrandrDisplays(`
Screen 0: minimum 8 x 8, current 4480 x 1440, maximum 32767 x 32767
DP-1 connected 1920x1080-1920+180 (normal left inverted right x axis y axis)
eDP-1 connected primary 2560x1440+0+0 (normal left inverted right x axis y axis)
`);

    expect(config.mainDisplayIndex).toBe(1);
    expect(config.totalWidth).toBe(4480);
    expect(config.totalHeight).toBe(1440);
    expect(config.displays).toEqual([
      {
        index: 0,
        name: 'DP-1',
        isMain: false,
        width: 1920,
        height: 1080,
        originX: -1920,
        originY: 180,
        scaleFactor: 1,
      },
      {
        index: 1,
        name: 'eDP-1',
        isMain: true,
        width: 2560,
        height: 1440,
        originX: 0,
        originY: 0,
        scaleFactor: 1,
      },
    ]);
  });

  it('uses the first active display when xrandr has no primary marker', () => {
    const config = parseXrandrDisplays(
      'Virtual-1 connected 1280x720+0+0 (normal left inverted right x axis y axis)'
    );

    expect(config.displays[0].isMain).toBe(true);
    expect(config.mainDisplayIndex).toBe(0);
  });

  it('fails when no active graphical display is reported', () => {
    expect(() => parseXrandrDisplays('HDMI-1 disconnected')).toThrow(
      'xrandr did not report an active display'
    );
  });
});
