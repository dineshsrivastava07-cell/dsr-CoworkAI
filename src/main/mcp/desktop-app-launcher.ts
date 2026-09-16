import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const SAFE_APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._+()'-]{0,199}$/u;

export interface DesktopAppLaunchCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function buildDesktopAppLaunchCommand(
  appName: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env
): DesktopAppLaunchCommand {
  const normalized = appName.trim();
  if (!SAFE_APP_NAME.test(normalized)) {
    throw new Error(
      'Application launcher name must be 1-200 characters and cannot contain paths, shell syntax or control characters.'
    );
  }
  if (platform === 'darwin') {
    return { command: '/usr/bin/open', args: ['-a', normalized] };
  }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -FilePath $env:V_COWORKER_RPA_APP',
      ],
      env: { ...environment, V_COWORKER_RPA_APP: normalized },
    };
  }
  if (platform === 'linux') {
    return { command: 'gtk-launch', args: [normalized] };
  }
  throw new Error(`Opening applications is unsupported on platform ${platform}.`);
}

export async function launchDesktopApplication(
  appName: string,
  platform: NodeJS.Platform,
  timeoutMs = 15_000
): Promise<void> {
  const plan = buildDesktopAppLaunchCommand(appName, platform);
  try {
    await execFileAsync(plan.command, plan.args, {
      timeout: timeoutMs,
      env: plan.env,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `Could not open application "${appName.trim()}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
