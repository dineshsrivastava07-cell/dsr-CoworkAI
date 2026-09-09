import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/renderer/components/RemoteControlPanel.tsx');
const panelContent = readFileSync(panelPath, 'utf8');

describe('RemoteControlPanel links', () => {
  const deprecatedBotAuthUrl = `open.${'fei' + 'shu'}.cn/app/cli_a90ad18f0f39dcc6/auth`;

  it('does not show one-click permission link', () => {
    expect(panelContent).not.toContain('一键配置权限');
  });

  it('does not include the deprecated bot auth url', () => {
    expect(panelContent).not.toContain(deprecatedBotAuthUrl);
  });

  it('uses the Indian remote desktop setup component', () => {
    const deprecatedComponentName = `${'Fei' + 'shu'}ConfigStep`;

    expect(panelContent).toContain('IndianVncConfigStep');
    expect(panelContent).not.toContain(deprecatedComponentName);
  });
});
