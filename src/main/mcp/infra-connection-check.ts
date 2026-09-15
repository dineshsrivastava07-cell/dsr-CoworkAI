import { Socket } from 'node:net';
import type { InfraRcaConnectionResult } from '../../shared/ipc-types';
import type { TargetCredentials } from './infra-drivers/types';

type Endpoint = Pick<
  TargetCredentials,
  'host' | 'protocol' | 'port' | 'dbEngine' | 'winrmTransport' | 'winrmAuth'
>;

function portFor(target: Endpoint): number {
  return (
    target.port ||
    (target.protocol === 'winrm'
      ? 5985
      : target.protocol === 'ssh'
        ? 22
        : target.protocol === 'snmp'
          ? 161
          : target.dbEngine === 'mysql'
            ? 3306
            : 5432)
  );
}

function winrmHelp(target: Endpoint) {
  return target.protocol === 'winrm'
    ? {
        limitation:
          target.winrmAuth === 'kerberos'
            ? 'WinRM Kerberos uses the current Windows domain ticket and requires a Windows V-Coworker host. It never falls back to password authentication.'
            : `WinRM ${target.winrmAuth === 'ntlm' ? 'NTLM' : target.winrmAuth === 'basic' ? 'Basic' : 'auto-detected Basic/NTLM'} over ${target.winrmTransport === 'https' || target.port === 5986 ? 'HTTPS' : 'HTTP'} is supported. HTTPS certificates are verified by default.`,
        localChecks: [
          'Get-Service WinRM',
          `Get-NetTCPConnection -State Listen -LocalPort ${portFor(target)} -ErrorAction SilentlyContinue`,
          'winrm enumerate winrm/config/listener',
          'Test-WSMan -ComputerName localhost',
        ],
      }
    : {};
}

/** Only return known error categories, never arbitrary driver text containing credentials. */
export function describeInfraConnectionFailure(
  error: unknown,
  target: Endpoint
): InfraRcaConnectionResult {
  const knownCodes = [
    'ECONNREFUSED',
    'EHOSTDOWN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EACCES',
    'EPERM',
  ];
  const supplied = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  const code = knownCodes.includes(supplied)
    ? supplied
    : knownCodes.find((value) => new RegExp(`\\b${value}\\b`).test(message)) || 'CONNECTION_FAILED';
  let summary = 'Connection check failed.';
  let steps = ['Verify the configured host, port, service and approved network access.'];
  if (code === 'ECONNREFUSED') {
    summary = 'Connection refused before login. The TCP connection was actively rejected.';
    steps = [
      'Have IT check that the target service is running and listening on the configured port.',
      'Check listener bindings and rejecting host/network firewall rules for this workstation.',
    ];
  } else if (['EHOSTDOWN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(code)) {
    summary =
      code === 'ETIMEDOUT'
        ? 'Connection timed out before login.'
        : 'Host or network unreachable before login.';
    steps = [
      'Confirm the target is powered on and its inventory address is current.',
      'Check this workstation’s LAN/VPN, route and inter-subnet access policy.',
      'Have IT inspect firewall logs; this result alone does not prove that the target is powered off.',
    ];
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    summary = 'The target hostname could not be resolved.';
    steps = ['Check the inventory hostname and this workstation’s DNS/VPN configuration.'];
  } else if (['EACCES', 'EPERM'].includes(code)) {
    summary = 'The workstation denied the network connection.';
    steps = [
      'Have IT review local network permissions and endpoint policy for the running V-Coworker app.',
    ];
  }
  return {
    reachable: false,
    check: 'tcp',
    port: portFor(target),
    errorCode: code,
    error: summary,
    nextSteps: [
      ...steps,
      'Repeat Test after the network/service correction, then run an authorized read-only diagnostic to test login.',
    ],
    ...winrmHelp(target),
  };
}

/** Shared by the settings IPC and MCP readiness check; a TCP success is not a login test. */
export async function checkInfraConnection(
  target: TargetCredentials,
  timeoutMs = 5000
): Promise<InfraRcaConnectionResult> {
  const port = portFor(target);
  const start = Date.now();
  if (target.protocol === 'snmp') {
    try {
      const { probeSnmp } = await import('./infra-drivers/snmp-driver');
      await probeSnmp(target);
      return { reachable: true, check: 'snmp', port, latencyMs: Date.now() - start };
    } catch {
      return {
        reachable: false,
        check: 'snmp',
        port,
        errorCode: 'SNMP_PROBE_FAILED',
        error: 'SNMP did not return a valid response.',
        nextSteps: [
          'Check UDP reachability, SNMPv2c support, community and source-address ACLs. A TCP check cannot verify SNMP.',
        ],
      };
    }
  }
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result: InfraRcaConnectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish(describeInfraConnectionFailure({ code: 'ETIMEDOUT' }, target)),
      timeoutMs
    );
    socket.once('error', (error) => finish(describeInfraConnectionFailure(error, target)));
    try {
      socket.connect(port, target.host, () =>
        finish({
          reachable: true,
          check: 'tcp',
          port,
          latencyMs: Date.now() - start,
          nextSteps: [
            'TCP reachable; login and diagnostic permissions have not been tested. Run an authorized read-only diagnostic next.',
          ],
          ...winrmHelp(target),
        })
      );
    } catch (error) {
      finish(describeInfraConnectionFailure(error, target));
    }
  });
}
