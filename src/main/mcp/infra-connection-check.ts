import { Socket } from 'node:net';
import type {
  InfraRcaConnectionResult,
  InfraRcaNetworkPath,
  InfraRcaPortProbe,
} from '../../shared/ipc-types';
import type { TargetCredentials } from './infra-drivers/types';
import { inspectInfraNetworkPath } from './infra-network-path';

type Endpoint = Pick<
  TargetCredentials,
  | 'host'
  | 'protocol'
  | 'port'
  | 'dbEngine'
  | 'winrmTransport'
  | 'winrmAuth'
  | 'winrmRejectUnauthorized'
>;

export interface InfraConnectionCheckOptions {
  advancedWinrm?: boolean;
  verifyLogin?: boolean;
  inspectNetworkPath?: (host: string) => Promise<InfraRcaNetworkPath | undefined>;
  probeTcp?: (
    host: string,
    port: number,
    service: string,
    timeoutMs: number
  ) => Promise<InfraRcaPortProbe>;
}

function portFor(target: Endpoint): number {
  return (
    target.port ||
    (target.protocol === 'winrm'
      ? target.winrmTransport === 'https'
        ? 5986
        : 5985
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
  const usesHttps = target.winrmTransport === 'https' || target.port === 5986;
  return target.protocol === 'winrm'
    ? {
        limitation:
          target.winrmAuth === 'basic' && !usesHttps
            ? 'Basic over HTTP is configured but blocked by organizational safety policy. Edit this target to use Basic over HTTPS, or use approved NTLM/Kerberos.'
            : target.winrmAuth === 'kerberos'
              ? 'WinRM Kerberos uses the current Windows domain ticket and requires a Windows V-Coworker host. It never falls back to password authentication.'
              : `Configured for ${target.winrmAuth === 'ntlm' ? 'NTLM' : target.winrmAuth === 'basic' ? 'Basic' : 'automatic local Basic/domain NTLM selection'} over ${usesHttps ? 'HTTPS' : 'HTTP'}. This describes the adapter configuration; it is not evidence that the target listener or authentication succeeded. HTTPS certificate verification is ${target.winrmRejectUnauthorized === false ? 'disabled by explicit configuration' : 'enabled'}.`,
        localChecks: [
          'Get-Service WinRM',
          'Get-Service sshd -ErrorAction SilentlyContinue',
          `Get-NetTCPConnection -State Listen -LocalPort ${Array.from(new Set([22, portFor(target), 5985, 5986])).join(',')} -ErrorAction SilentlyContinue`,
          `Get-NetTCPConnection -State Listen -LocalPort ${portFor(target)} -ErrorAction SilentlyContinue`,
          'winrm enumerate winrm/config/listener',
          "Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'",
          'Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue | Select-Object Name,Enabled,Profile,Action',
          ...(usesHttps
            ? [
                "Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.HasPrivateKey -and $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1' } | Select-Object Subject,DnsNameList,Thumbprint,NotAfter",
                'Get-NetFirewallPortFilter | Where-Object LocalPort -in 5985,5986 | Select-Object InstanceID,LocalPort',
              ]
            : []),
          "Get-NetFirewallRule -DisplayGroup 'Windows Remote Management' | Select-Object DisplayName,Enabled,Direction,Action,Profile",
          'Test-WSMan -ComputerName localhost',
        ],
      }
    : {};
}

function knownConnectionCode(error: unknown): string {
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
  return (
    (knownCodes.includes(supplied) && supplied) ||
    knownCodes.find((value) => new RegExp(`\\b${value}\\b`).test(message)) ||
    'CONNECTION_FAILED'
  );
}

/** Only return known error categories, never arbitrary driver text containing credentials. */
export function describeInfraConnectionFailure(
  error: unknown,
  target: Endpoint
): InfraRcaConnectionResult {
  const code = knownConnectionCode(error);
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

async function probeTcpPort(
  host: string,
  port: number,
  service: string,
  timeoutMs: number
): Promise<InfraRcaPortProbe> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result: InfraRcaPortProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ port, service, reachable: false, errorCode: 'ETIMEDOUT' }),
      timeoutMs
    );
    socket.once('error', (error) =>
      finish({ port, service, reachable: false, errorCode: knownConnectionCode(error) })
    );
    try {
      socket.connect(port, host, () =>
        finish({ port, service, reachable: true, latencyMs: Date.now() - start })
      );
    } catch (error) {
      finish({ port, service, reachable: false, errorCode: knownConnectionCode(error) });
    }
  });
}

function classifyWinrmLoginFailure(
  error: unknown,
  target: TargetCredentials,
  port: number,
  probes: InfraRcaPortProbe[],
  networkPath?: InfraRcaNetworkPath
): InfraRcaConnectionResult {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  let errorCode = 'WINRM_PROTOCOL_FAILED';
  let stage: InfraRcaConnectionResult['stage'] = 'authentication';
  let summary = 'The WinRM listener answered, but the authenticated read-only probe failed.';
  let nextSteps = [
    'Verify the username format, password, permitted WinRM authentication methods and remote-management authorization.',
  ];
  if (message.includes('basic authentication requires https')) {
    errorCode = 'UNSAFE_BASIC_HTTP';
    summary = 'Basic authentication over HTTP is blocked by organizational safety policy.';
    nextSteps = [
      'Use NTLM/Kerberos, or configure an approved HTTPS listener for Basic authentication.',
    ];
  } else if (message.includes('kerberos winrm requires a windows')) {
    errorCode = 'KERBEROS_CLIENT_REQUIRED';
    summary = 'Kerberos cannot use the current non-Windows V-Coworker host ticket.';
    nextSteps = [
      'Run V-Coworker on a domain-joined Windows management host or select approved NTLM.',
    ];
  } else if (/certificate|self[- ]signed|unable to verify|hostname.*match/.test(message)) {
    errorCode = 'TLS_CERTIFICATE_FAILED';
    stage = 'tls';
    summary = 'The WinRM HTTPS listener answered, but certificate validation failed.';
    nextSteps = [
      'Use the target certificate hostname and install the approved issuing CA. Keep verification enabled.',
    ];
  } else if (/401|unauthori[sz]ed|authentication|logon failure|access denied/.test(message)) {
    errorCode = 'AUTHENTICATION_FAILED';
  }
  return {
    reachable: true,
    authenticated: false,
    check: 'winrm',
    stage,
    port,
    errorCode,
    error: summary,
    nextSteps,
    probes,
    networkPath,
    ...winrmHelp(target),
  };
}

function winrmRemediationCommands(target: Endpoint): string[] {
  const usesHttps = target.winrmTransport === 'https' || target.port === 5986;
  const commands = [
    'Get-NetConnectionProfile',
    'Set-Service WinRM -StartupType Automatic',
    'Start-Service WinRM',
    'Enable-PSRemoting -Force',
    "Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'",
    "if ((Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0).State -ne 'Installed') { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 }",
    'Start-Service sshd',
    'Set-Service -Name sshd -StartupType Automatic',
    "if (!(Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 } else { Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' }",
    'Test-NetConnection -ComputerName localhost -Port 22',
  ];
  if (usesHttps) {
    commands.push(
      '# HTTPS requires an approved, non-expired LocalMachine\\My certificate with Server Authentication and a hostname/SAN matching this target.',
      "Get-ChildItem Cert:\\LocalMachine\\My | Where-Object { $_.HasPrivateKey -and $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1' } | Select-Object Subject,DnsNameList,Thumbprint,NotAfter",
      'winrm quickconfig -transport:https -quiet',
      "Get-NetFirewallRule -DisplayGroup 'Windows Remote Management' | Enable-NetFirewallRule",
      'winrm enumerate winrm/config/listener',
      'Test-WSMan -ComputerName localhost -UseSSL'
    );
  } else {
    commands.push(
      "Get-NetFirewallRule -DisplayGroup 'Windows Remote Management' | Enable-NetFirewallRule",
      'winrm enumerate winrm/config/listener',
      'Test-WSMan -ComputerName localhost'
    );
  }
  return commands;
}

async function checkWinrmAdvanced(
  target: TargetCredentials,
  timeoutMs: number,
  options: InfraConnectionCheckOptions
): Promise<InfraRcaConnectionResult> {
  const configuredPort = portFor(target);
  const ports = Array.from(new Set([configuredPort, 5985, 5986]));
  const tcpProbe = options.probeTcp || probeTcpPort;
  const networkPathPromise = (options.inspectNetworkPath || inspectInfraNetworkPath)(target.host);
  const probes = await Promise.all(
    ports.map((port) =>
      tcpProbe(target.host, port, port === 5986 ? 'WinRM HTTPS' : 'WinRM HTTP', timeoutMs)
    )
  );
  const networkPath = await networkPathPromise;
  const configuredProbe = probes.find((probe) => probe.port === configuredPort)!;

  if (configuredProbe.reachable) {
    if (options.verifyLogin) {
      try {
        const { probeWinrm } = await import('./infra-drivers/winrm-driver');
        await probeWinrm(target);
      } catch (error) {
        return classifyWinrmLoginFailure(error, target, configuredPort, probes, networkPath);
      }
      return {
        reachable: true,
        authenticated: true,
        check: 'winrm',
        stage: 'ready',
        port: configuredPort,
        latencyMs: configuredProbe.latencyMs,
        probes,
        networkPath,
        nextSteps: [
          'Authenticated read-only WinRM probe succeeded. Expert diagnostics can now run.',
        ],
        ...winrmHelp(target),
      };
    }
    return {
      reachable: true,
      check: 'tcp',
      stage: 'tcp',
      port: configuredPort,
      latencyMs: configuredProbe.latencyMs,
      probes,
      networkPath,
      nextSteps: [
        'TCP reachable; login and diagnostic permissions have not been tested. Run an authorized read-only diagnostic next.',
      ],
      ...winrmHelp(target),
    };
  }

  const alternate = probes.find((probe) => probe.port !== configuredPort && probe.reachable);
  if (alternate) {
    return {
      reachable: false,
      check: 'tcp',
      stage: 'tcp',
      port: configuredPort,
      errorCode: 'WINRM_TRANSPORT_MISMATCH',
      error: `The configured WinRM port is unavailable, but ${alternate.service} answered on port ${alternate.port}.`,
      nextSteps: [
        `Edit this target to use ${alternate.port === 5986 ? 'HTTPS' : 'HTTP'} on port ${alternate.port}, then repeat Test to verify authentication.`,
      ],
      probes,
      networkPath,
      ...winrmHelp(target),
    };
  }

  const managementProbes = await Promise.all([
    tcpProbe(target.host, 135, 'Windows RPC endpoint mapper', Math.min(timeoutMs, 2500)),
    tcpProbe(target.host, 445, 'Windows SMB', Math.min(timeoutMs, 2500)),
    tcpProbe(target.host, 3389, 'Windows Remote Desktop', Math.min(timeoutMs, 2500)),
  ]);
  probes.push(...managementProbes);
  const hostResponded =
    configuredProbe.errorCode === 'ECONNREFUSED' ||
    managementProbes.some((probe) => probe.reachable);
  if (hostResponded) {
    const answering = managementProbes
      .filter((probe) => probe.reachable)
      .map((probe) => `${probe.service} (${probe.port})`)
      .join(', ');
    return {
      reachable: false,
      check: 'winrm',
      stage: 'host',
      port: configuredPort,
      errorCode: 'WINRM_LISTENER_UNAVAILABLE',
      error:
        'The Windows host is reachable, but neither standard WinRM listener is accepting connections.',
      nextSteps: [
        answering
          ? `Other Windows services answer at this IP: ${answering}. This confirms the host path and isolates the failure to WinRM provisioning or filtering.`
          : 'The immediate refusal confirms the host path and isolates the failure to WinRM provisioning or filtering.',
        'Run the read-only checks on the target. If WinRM is not provisioned, have an administrator apply the approved repair locally, through RDP, endpoint management, or Group Policy.',
        'For organizational fleets, deploy the WinRM service, listener and scoped inbound firewall rule through Group Policy or endpoint management instead of configuring machines one by one.',
        'Repeat Test; once a listener answers, Infra RCA will continue to TLS and authentication verification.',
      ],
      probes,
      networkPath,
      remediationCommands: winrmRemediationCommands(target),
      ...winrmHelp(target),
    };
  }

  const failure = describeInfraConnectionFailure(
    { code: configuredProbe.errorCode || 'CONNECTION_FAILED' },
    target
  );
  return { ...failure, stage: 'route', probes, networkPath };
}

/** Shared by the settings IPC and MCP readiness check; a TCP success is not a login test. */
export async function checkInfraConnection(
  target: TargetCredentials,
  timeoutMs = 5000,
  options: InfraConnectionCheckOptions = {}
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
  if (target.protocol === 'winrm' && options.advancedWinrm) {
    return checkWinrmAdvanced(target, timeoutMs, options);
  }
  const probe = await probeTcpPort(target.host, port, 'TCP endpoint', timeoutMs);
  if (!probe.reachable) {
    return describeInfraConnectionFailure({ code: probe.errorCode || 'CONNECTION_FAILED' }, target);
  }
  return {
    reachable: true,
    check: 'tcp',
    stage: 'tcp',
    port,
    latencyMs: Date.now() - start,
    nextSteps: [
      'TCP reachable; login and diagnostic permissions have not been tested. Run an authorized read-only diagnostic next.',
    ],
    ...winrmHelp(target),
  };
}
