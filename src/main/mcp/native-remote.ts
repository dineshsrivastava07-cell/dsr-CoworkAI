import { execFile, spawn } from 'node:child_process';
import { Socket } from 'node:net';
import type {
  InfraNativeRemoteLaunchResult,
  InfraNativeRemoteProtocol,
} from '../../shared/ipc-types';
import type { TargetCredentials } from './infra-drivers/types';

function defaultPort(protocol: InfraNativeRemoteProtocol): number {
  return protocol === 'rdp' ? 3389 : 5900;
}

async function probe(host: string, port: number, timeoutMs = 2500): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Remote desktop port ${port} timed out.`));
    }, timeoutMs);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once('error', (error) => finish(error));
    socket.connect(port, host, () => finish());
  });
}

function runDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function which(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', [command], (error) => resolve(!error));
  });
}

async function launchLinux(protocol: InfraNativeRemoteProtocol, host: string, port: number) {
  const candidates: Array<[string, string[]]> =
    protocol === 'rdp'
      ? [
          ['xfreerdp', [`/v:${host}:${port}`]],
          ['remmina', ['-c', `rdp://${host}:${port}`]],
        ]
      : [
          ['vncviewer', [`${host}::${port}`]],
          ['vinagre', [`${host}:${port}`]],
        ];
  for (const [command, args] of candidates) {
    if (await which(command)) {
      runDetached(command, args);
      return command;
    }
  }
  throw new Error(
    protocol === 'rdp'
      ? 'No native Linux RDP client found. Install xfreerdp or Remmina.'
      : 'No native Linux VNC client found. Install a VNC viewer such as TigerVNC or Vinagre.'
  );
}

/** Launches the OS-native interactive client after a bounded port preflight. */
export async function openNativeRemoteDesktop(
  target: Pick<TargetCredentials, 'host' | 'protocol' | 'port' | 'remoteDesktop' | 'remotePort'>
): Promise<InfraNativeRemoteLaunchResult> {
  if (target.protocol === 'snmp' || target.protocol === 'db') {
    throw new Error('Native remote desktop is available for SSH/WinRM host targets only.');
  }
  const protocol: InfraNativeRemoteProtocol =
    target.remoteDesktop || (target.protocol === 'winrm' ? 'rdp' : 'vnc');
  const port = target.remotePort || defaultPort(protocol);
  await probe(target.host, port);

  if (process.platform === 'win32') {
    if (protocol === 'rdp') runDetached('mstsc.exe', [`/v:${target.host}:${port}`]);
    else runDetached('explorer.exe', [`vnc://${target.host}:${port}`]);
    return {
      launched: true,
      protocol,
      host: target.host,
      port,
      client: protocol === 'rdp' ? 'mstsc.exe' : 'VNC URI',
    };
  }
  if (process.platform === 'darwin') {
    if (protocol === 'vnc')
      runDetached('open', ['-a', 'Screen Sharing', `vnc://${target.host}:${port}`]);
    else runDetached('open', [`rdp://full%20address=s:${target.host}:${port}`]);
    return {
      launched: true,
      protocol,
      host: target.host,
      port,
      client: protocol === 'vnc' ? 'Screen Sharing' : 'RDP URI',
    };
  }
  if (process.platform === 'linux') {
    const client = await launchLinux(protocol, target.host, port);
    return { launched: true, protocol, host: target.host, port, client };
  }
  throw new Error(`Native remote desktop is not supported on ${process.platform}.`);
}
