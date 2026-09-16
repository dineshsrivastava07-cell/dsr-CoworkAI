import { execFile } from 'node:child_process';
import { networkInterfaces, platform } from 'node:os';
import { promisify } from 'node:util';
import type { InfraRcaNetworkPath } from '../../shared/ipc-types';

const execFileAsync = promisify(execFile);

interface ParsedRoute {
  interface?: string;
  gateway?: string;
  sourceAddress?: string;
}

function addressForInterface(name?: string): string | undefined {
  if (!name) return undefined;
  return networkInterfaces()[name]?.find((entry) => entry.family === 'IPv4' && !entry.internal)
    ?.address;
}

export function parseMacRouteOutput(output: string): ParsedRoute {
  const field = (name: string) =>
    output.match(new RegExp(`^\\s*${name}:\\s*(\\S+)`, 'm'))?.[1] || undefined;
  return {
    interface: field('interface'),
    gateway: field('gateway'),
  };
}

export function parseLinuxRouteOutput(output: string): ParsedRoute {
  return {
    interface: output.match(/\bdev\s+(\S+)/)?.[1],
    gateway: output.match(/\bvia\s+(\S+)/)?.[1],
    sourceAddress: output.match(/\bsrc\s+(\S+)/)?.[1],
  };
}

function summarizeRoute(
  route: ParsedRoute,
  usesDefaultRoute: boolean | undefined,
  vpnInterface: boolean
): string {
  const via = route.gateway ? ` via gateway ${route.gateway}` : ' using a direct/on-link route';
  const source = route.sourceAddress ? ` from ${route.sourceAddress}` : '';
  const defaultRoute = usesDefaultRoute
    ? ' The target is using the workstation default route.'
    : '';
  const vpn = vpnInterface ? ' The selected interface appears to be a VPN/tunnel.' : '';
  return `Traffic uses ${route.interface || 'an unknown interface'}${source}${via}.${defaultRoute}${vpn}`;
}

async function inspectMacRoute(host: string): Promise<InfraRcaNetworkPath> {
  const [{ stdout: targetOutput }, { stdout: defaultOutput }] = await Promise.all([
    execFileAsync('/sbin/route', ['-n', 'get', host], { timeout: 4000 }),
    execFileAsync('/sbin/route', ['-n', 'get', 'default'], { timeout: 4000 }),
  ]);
  const route = parseMacRouteOutput(targetOutput);
  const defaultRoute = parseMacRouteOutput(defaultOutput);
  route.sourceAddress = addressForInterface(route.interface);
  const usesDefaultRoute = Boolean(
    route.gateway &&
    defaultRoute.gateway &&
    route.gateway === defaultRoute.gateway &&
    route.interface === defaultRoute.interface
  );
  const vpnInterface = /^(utun|ppp|tun|tap|wg)/i.test(route.interface || '');
  return {
    ...route,
    usesDefaultRoute,
    vpnInterface,
    summary: summarizeRoute(route, usesDefaultRoute, vpnInterface),
  };
}

async function inspectLinuxRoute(host: string): Promise<InfraRcaNetworkPath> {
  const { stdout } = await execFileAsync('ip', ['route', 'get', host], { timeout: 4000 });
  const route = parseLinuxRouteOutput(stdout);
  route.sourceAddress ||= addressForInterface(route.interface);
  const usesDefaultRoute = /^default\b/.test(stdout.trim());
  const vpnInterface = /^(tun|tap|wg|ppp)/i.test(route.interface || '');
  return {
    ...route,
    usesDefaultRoute,
    vpnInterface,
    summary: summarizeRoute(route, usesDefaultRoute, vpnInterface),
  };
}

async function inspectWindowsRoute(host: string): Promise<InfraRcaNetworkPath> {
  const escapedHost = host.replace(/'/g, "''");
  const script = [
    `$route = Find-NetRoute -RemoteIPAddress '${escapedHost}'`,
    '$adapter = Get-NetIPConfiguration -InterfaceIndex $route.InterfaceIndex',
    '[pscustomobject]@{ Interface=$route.InterfaceAlias; SourceAddress=$route.IPAddress; Gateway=$adapter.IPv4DefaultGateway.NextHop } | ConvertTo-Json -Compress',
  ].join('; ');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 5000, windowsHide: true }
  );
  const parsed = JSON.parse(stdout) as {
    Interface?: string;
    SourceAddress?: string;
    Gateway?: string;
  };
  const route: ParsedRoute = {
    interface: parsed.Interface,
    sourceAddress: parsed.SourceAddress,
    gateway: parsed.Gateway,
  };
  const vpnInterface = /vpn|tunnel|wireguard|forti|globalprotect/i.test(route.interface || '');
  return {
    ...route,
    vpnInterface,
    summary: summarizeRoute(route, undefined, vpnInterface),
  };
}

/** Best-effort, read-only OS route inspection. Failure never blocks the connection probe. */
export async function inspectInfraNetworkPath(
  host: string
): Promise<InfraRcaNetworkPath | undefined> {
  try {
    if (platform() === 'darwin') return await inspectMacRoute(host);
    if (platform() === 'linux') return await inspectLinuxRoute(host);
    if (platform() === 'win32') return await inspectWindowsRoute(host);
  } catch {
    return undefined;
  }
  return undefined;
}
