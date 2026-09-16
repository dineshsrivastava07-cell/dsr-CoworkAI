import { describe, expect, it } from 'vitest';
import { buildDesktopAppLaunchCommand } from '../src/main/mcp/desktop-app-launcher';

describe('desktop app launcher', () => {
  it('builds argument-safe launch commands for macOS, Windows and Linux', () => {
    expect(buildDesktopAppLaunchCommand('Example Desktop', 'darwin')).toEqual({
      command: '/usr/bin/open',
      args: ['-a', 'Example Desktop'],
    });
    expect(buildDesktopAppLaunchCommand('Example.exe', 'win32', { PATH: 'test' })).toMatchObject({
      command: 'powershell.exe',
      env: { PATH: 'test', V_COWORKER_RPA_APP: 'Example.exe' },
    });
    expect(buildDesktopAppLaunchCommand('org.example.App', 'linux')).toEqual({
      command: 'gtk-launch',
      args: ['org.example.App'],
    });
  });

  it('rejects paths, shell syntax and unsupported platforms', () => {
    expect(() => buildDesktopAppLaunchCommand('/Applications/App.app', 'darwin')).toThrow(
      'cannot contain paths'
    );
    expect(() => buildDesktopAppLaunchCommand('App; rm', 'linux')).toThrow('shell syntax');
    expect(() => buildDesktopAppLaunchCommand('Example', 'aix')).toThrow('unsupported');
  });
});
