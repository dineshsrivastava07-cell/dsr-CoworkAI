import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface LinuxDisplayInfo {
  index: number;
  name: string;
  isMain: boolean;
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleFactor: number;
}

export interface LinuxDisplayConfiguration {
  displays: LinuxDisplayInfo[];
  totalWidth: number;
  totalHeight: number;
  mainDisplayIndex: number;
}

export interface LinuxRuntimeStatus {
  platform: 'linux';
  sessionType: string;
  display: string | null;
  ready: boolean;
  inputBackend: string | null;
  displayBackend: string | null;
  screenshotBackend: string | null;
  limitations: string[];
  missing: string[];
}

type CommandResult = { stdout: string; stderr: string };

async function run(command: string, args: string[], timeout = 30_000): Promise<CommandResult> {
  const result = await execFileAsync(command, args, { timeout });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const executableCache = new Map<string, string | null>();

export async function resolveLinuxExecutable(name: string): Promise<string | null> {
  if (executableCache.has(name)) return executableCache.get(name) ?? null;

  const knownPaths = [`/usr/bin/${name}`, `/bin/${name}`, `/usr/local/bin/${name}`];
  for (const candidate of knownPaths) {
    try {
      await run('/usr/bin/test', ['-x', candidate], 2_000);
      executableCache.set(name, candidate);
      return candidate;
    } catch {
      // Try the next packaged location.
    }
  }

  try {
    const { stdout } = await run('/usr/bin/which', [name], 2_000);
    const resolved = stdout.trim();
    executableCache.set(name, resolved || null);
    return resolved || null;
  } catch {
    executableCache.set(name, null);
    return null;
  }
}

function linuxSessionError(): Error {
  const sessionType = (process.env.XDG_SESSION_TYPE || 'unknown').toLowerCase();
  if (!process.env.DISPLAY && process.env.WAYLAND_DISPLAY) {
    return new Error(
      `Linux desktop automation cannot access an X11/XWayland display in this ${sessionType} session. ` +
        'Run V-Coworker inside the signed-in graphical session with DISPLAY set, or use an organization-approved Wayland automation portal.'
    );
  }
  return new Error(
    'Linux desktop automation needs a signed-in, unlocked graphical session with DISPLAY set. ' +
      'Background service accounts and text-only SSH sessions cannot control the desktop.'
  );
}

async function requireLinuxDesktop(): Promise<void> {
  if (!process.env.DISPLAY) throw linuxSessionError();
}

async function requireLinuxExecutable(name: string, installHint: string): Promise<string> {
  const executable = await resolveLinuxExecutable(name);
  if (!executable) {
    throw new Error(`Linux desktop automation requires ${name}. ${installHint}`);
  }
  return executable;
}

async function runXdotool(args: string[]): Promise<CommandResult> {
  await requireLinuxDesktop();
  const executable = await requireLinuxExecutable(
    'xdotool',
    'Install the approved xdotool package on the execution workstation and restart V-Coworker.'
  );
  try {
    return await run(executable, args);
  } catch (error) {
    throw new Error(
      `Linux input automation failed: ${error instanceof Error ? error.message : String(error)}. ` +
        'Confirm that DISPLAY belongs to the signed-in user and that the X11/Wayland security policy permits synthetic input.'
    );
  }
}

function mapModifier(modifier: string): string {
  const normalized = modifier.toLowerCase();
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return 'super';
  if (normalized === 'control') return 'ctrl';
  if (normalized === 'option') return 'alt';
  return normalized;
}

function mapKey(key: string): string {
  const keyMap: Record<string, string> = {
    enter: 'Return',
    return: 'Return',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    space: 'space',
    delete: 'Delete',
    backspace: 'BackSpace',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'Prior',
    pagedown: 'Next',
  };
  const normalized = key.toLowerCase();
  if (keyMap[normalized]) return keyMap[normalized];
  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key;
  throw new Error(`Unsupported Linux key: ${key}`);
}

export function parseXrandrDisplays(output: string): LinuxDisplayConfiguration {
  const displays: LinuxDisplayInfo[] = [];
  const displayPattern =
    /^(\S+) connected(?:\s+(primary))?\s+(\d+)x(\d+)([+-]\d+)([+-]\d+)(?:\s|$)/;

  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(displayPattern);
    if (!match) continue;
    displays.push({
      index: displays.length,
      name: match[1],
      isMain: match[2] === 'primary',
      width: Number(match[3]),
      height: Number(match[4]),
      originX: Number(match[5]),
      originY: Number(match[6]),
      scaleFactor: 1,
    });
  }

  if (displays.length === 0) {
    throw new Error(
      'xrandr did not report an active display. Confirm the graphical session and DISPLAY.'
    );
  }
  if (!displays.some((display) => display.isMain)) displays[0].isMain = true;

  const minX = Math.min(...displays.map((display) => display.originX));
  const minY = Math.min(...displays.map((display) => display.originY));
  const maxX = Math.max(...displays.map((display) => display.originX + display.width));
  const maxY = Math.max(...displays.map((display) => display.originY + display.height));
  const mainDisplay = displays.find((display) => display.isMain) ?? displays[0];

  return {
    displays,
    totalWidth: maxX - minX,
    totalHeight: maxY - minY,
    mainDisplayIndex: mainDisplay.index,
  };
}

export async function linuxGetDisplayConfiguration(): Promise<LinuxDisplayConfiguration> {
  await requireLinuxDesktop();
  const xrandr = await requireLinuxExecutable(
    'xrandr',
    'Install the approved xrandr/x11-xserver-utils package on the execution workstation.'
  );
  const { stdout } = await run(xrandr, ['--query'], 5_000);
  return parseXrandrDisplays(stdout);
}

export async function linuxPerformClick(
  x: number,
  y: number,
  clickType: 'single' | 'double' | 'right' | 'triple',
  modifiers: string[]
): Promise<void> {
  const normalizedModifiers = modifiers.map(mapModifier);
  for (const modifier of normalizedModifiers) await runXdotool(['keydown', modifier]);
  try {
    await runXdotool(['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))]);
    const button = clickType === 'right' ? '3' : '1';
    const count = clickType === 'double' ? '2' : clickType === 'triple' ? '3' : '1';
    await runXdotool(['click', '--repeat', count, '--delay', '80', button]);
  } finally {
    for (const modifier of normalizedModifiers.reverse()) {
      try {
        await runXdotool(['keyup', modifier]);
      } catch {
        // Best effort: preserve the original action failure.
      }
    }
  }
}

export async function linuxPerformType(text: string, pressEnter: boolean): Promise<void> {
  await runXdotool(['type', '--clearmodifiers', '--delay', '1', '--', text]);
  if (pressEnter) await runXdotool(['key', 'Return']);
}

export async function linuxPerformKeyPress(key: string, modifiers: string[]): Promise<void> {
  const chord = [...modifiers.map(mapModifier), mapKey(key)].join('+');
  await runXdotool(['key', '--clearmodifiers', chord]);
}

export async function linuxPerformScroll(
  x: number,
  y: number,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number
): Promise<void> {
  const button = { up: '4', down: '5', left: '6', right: '7' }[direction];
  await runXdotool(['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))]);
  await runXdotool(['click', '--repeat', String(Math.max(1, Math.min(100, amount))), button]);
}

export async function linuxPerformDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  await runXdotool(['mousemove', '--sync', String(Math.round(fromX)), String(Math.round(fromY))]);
  await runXdotool(['mousedown', '1']);
  try {
    await runXdotool(['mousemove', '--sync', String(Math.round(toX)), String(Math.round(toY))]);
  } finally {
    await runXdotool(['mouseup', '1']);
  }
}

export async function linuxGetMousePosition(): Promise<{ globalX: number; globalY: number }> {
  const { stdout } = await runXdotool(['getmouselocation', '--shell']);
  const x = stdout.match(/^X=(-?\d+)$/m);
  const y = stdout.match(/^Y=(-?\d+)$/m);
  if (!x || !y) throw new Error(`Could not parse xdotool mouse position: ${stdout.trim()}`);
  return { globalX: Number(x[1]), globalY: Number(y[1]) };
}

export async function linuxMoveMouse(x: number, y: number): Promise<void> {
  await runXdotool(['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))]);
}

export async function linuxGetForegroundApplicationName(): Promise<string | null> {
  try {
    const active = await runXdotool(['getactivewindow']);
    const windowId = active.stdout.trim();
    if (!windowId) return null;
    const title = await runXdotool(['getwindowname', windowId]);
    return title.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function linuxTakeScreenshot(
  outputPath: string,
  region?: { x: number; y: number; width: number; height: number }
): Promise<void> {
  await requireLinuxDesktop();
  const maim = await resolveLinuxExecutable('maim');
  if (maim) {
    const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
    const args = region
      ? ['-g', `${region.width}x${region.height}${signed(region.x)}${signed(region.y)}`, outputPath]
      : [outputPath];
    await run(maim, args, 15_000);
    return;
  }

  const scrot = await resolveLinuxExecutable('scrot');
  if (scrot) {
    const args = region
      ? ['-a', `${region.x},${region.y},${region.width},${region.height}`, outputPath]
      : [outputPath];
    await run(scrot, args, 15_000);
    return;
  }

  if (!region) {
    const gnomeScreenshot = await resolveLinuxExecutable('gnome-screenshot');
    if (gnomeScreenshot) {
      await run(gnomeScreenshot, ['-f', outputPath], 15_000);
      return;
    }
  }

  throw new Error(
    'Linux screenshot capture requires maim or scrot (gnome-screenshot is supported for full-desktop capture). ' +
      'Install an approved backend and restart V-Coworker.'
  );
}

export async function getLinuxRuntimeStatus(): Promise<LinuxRuntimeStatus> {
  const [xdotool, xrandr, maim, scrot, gnomeScreenshot] = await Promise.all([
    resolveLinuxExecutable('xdotool'),
    resolveLinuxExecutable('xrandr'),
    resolveLinuxExecutable('maim'),
    resolveLinuxExecutable('scrot'),
    resolveLinuxExecutable('gnome-screenshot'),
  ]);
  const sessionType = (process.env.XDG_SESSION_TYPE || 'unknown').toLowerCase();
  const limitations: string[] = [];
  const missing: string[] = [];
  if (!process.env.DISPLAY) missing.push('DISPLAY graphical session');
  if (!xdotool) missing.push('xdotool');
  if (!xrandr) missing.push('xrandr');
  if (!maim && !scrot && !gnomeScreenshot) missing.push('maim, scrot, or gnome-screenshot');
  if (sessionType === 'wayland') {
    limitations.push(
      'Global input and capture depend on XWayland/compositor policy; native Wayland secure surfaces may reject automation.'
    );
  }
  limitations.push('The signed-in desktop must remain unlocked for UI and background GUI recipes.');

  return {
    platform: 'linux',
    sessionType,
    display: process.env.DISPLAY || null,
    ready: missing.length === 0,
    inputBackend: xdotool,
    displayBackend: xrandr,
    screenshotBackend: maim || scrot || gnomeScreenshot,
    limitations,
    missing,
  };
}
