// WinRM driver with explicit transport/authentication. The maintained
// winrm-client fork implements Basic and NTLM over HTTP or HTTPS. Kerberos is
// delegated to the native Windows PowerShell WS-Man client so a domain ticket
// is never converted into a password-based downgrade.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPowershell as runWinrmPowershell } from 'winrm-client';
import type {
  DiagnosticCategory,
  DiagnosticMetric,
  DiagnosticResult,
  TargetCredentials,
} from './types';

const execFileAsync = promisify(execFile);
type WinrmAuth = 'basic' | 'ntlm' | 'kerberos';

function authFor(target: TargetCredentials): WinrmAuth {
  const configured = target.winrmAuth && target.winrmAuth !== 'auto' ? target.winrmAuth : undefined;
  const domainUser = /\\|@/.test(target.username || '');
  const auth = configured || (domainUser ? 'ntlm' : 'basic');
  if (auth === 'basic' && domainUser)
    throw new Error('WinRM Basic auth cannot use a domain/UPN username; choose NTLM or Kerberos.');
  if (auth === 'ntlm' && !domainUser)
    throw new Error('WinRM NTLM requires DOMAIN\\user or user@domain username format.');
  return auth;
}

function isHttpsTransport(target: TargetCredentials): boolean {
  return (
    target.winrmTransport === 'https' ||
    (target.winrmTransport === undefined && target.port === 5986)
  );
}

export function getWinrmConnectionSettings(target: TargetCredentials): {
  auth: WinrmAuth;
  useHttps: boolean;
  port: number;
  rejectUnauthorized: boolean;
} {
  const useHttps = isHttpsTransport(target);
  return {
    auth: authFor(target),
    useHttps,
    port: target.port || (useHttps ? 5986 : 5985),
    rejectUnauthorized: target.winrmRejectUnauthorized ?? true,
  };
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function runKerberosPowershell(target: TargetCredentials, command: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error(
      'Kerberos WinRM requires a Windows V-Coworker host with a domain ticket. Use NTLM or HTTPS on this workstation, or run the approved Windows helper.'
    );
  }
  const ssl = isHttpsTransport(target) ? ' -UseSSL' : '';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$session = New-PSSession -ComputerName '${escapePowerShellLiteral(target.host)}' -Port ${target.port || (isHttpsTransport(target) ? 5986 : 5985)} -Authentication Kerberos${ssl}`,
    'try {',
    `  Invoke-Command -Session $session -ScriptBlock { ${command}\n }`,
    '} finally { if ($session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue } }',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  if (stderr.trim() && !stdout.trim()) throw new Error(stderr.trim().slice(0, 1000));
  return stdout;
}

const PS_COMMANDS: Partial<Record<DiagnosticCategory, string>> = {
  os_health:
    "Get-Service | Where-Object Status -ne 'Running' | Select-Object -First 10 Name,Status | ConvertTo-Json -Compress",
  disk_health:
    'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Json -Compress',
  ram_health:
    '(Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize) | ConvertTo-Json -Compress',
  network_health: 'Get-NetAdapter | Select-Object Name,Status | ConvertTo-Json -Compress',
  file_health:
    "Get-WinEvent -LogName System -MaxEvents 20 -ErrorAction SilentlyContinue | Where-Object LevelDisplayName -eq 'Error' | Select-Object -First 10 Message | ConvertTo-Json -Compress",
  service_health:
    "Get-Service | Where-Object Status -ne 'Running' | Select-Object -First 25 Name,Status,StartType | ConvertTo-Json -Compress",
  process_health:
    'Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 ProcessName,Id,CPU,PM | ConvertTo-Json -Compress',
  cpu_health:
    "Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 1 | Select-Object -ExpandProperty CounterSamples | Select-Object CookedValue,InstanceName | ConvertTo-Json -Compress",
  storage_health:
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,Size,FreeSpace,FileSystem | ConvertTo-Json -Compress',
  hardware_health:
    'Get-CimInstance Win32_ComputerSystem,Win32_BIOS,Win32_Processor,Win32_PhysicalMemory | Select-Object -First 40 | ConvertTo-Json -Compress',
  virtualization_health:
    'Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,HypervisorPresent,Domain | ConvertTo-Json -Compress',
  security_health:
    'Get-MpComputerStatus -ErrorAction SilentlyContinue | Select-Object AMServiceEnabled,AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated | ConvertTo-Json -Compress',
};

async function runPs(target: TargetCredentials, command: string): Promise<string> {
  const settings = getWinrmConnectionSettings(target);
  if (settings.auth === 'kerberos') return runKerberosPowershell(target, command);
  return runWinrmPowershell(
    command,
    target.host,
    target.username || '',
    target.secret || '',
    settings.port,
    settings.useHttps,
    settings.rejectUnauthorized
  );
}

/** Exported so infra-rca-server.ts can run an exact, already-proposed remediation command. */
export const winrmExec = runPs;

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildMetricsForDisk(parsed: unknown): DiagnosticMetric[] {
  const drives = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const metrics: DiagnosticMetric[] = [];
  for (const d of drives) {
    const rec = d as { Name?: string; Used?: number; Free?: number };
    const used = Number(rec.Used) || 0;
    const free = Number(rec.Free) || 0;
    const total = used + free;
    if (!total) continue;
    const pct = Math.round((used / total) * 100);
    metrics.push({
      name: `Disk usage (${rec.Name ?? '?'})`,
      value: pct,
      unit: '%',
      status: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
    });
  }
  return metrics;
}

function buildMetricsForRam(parsed: unknown): DiagnosticMetric[] {
  const rec = parsed as { FreePhysicalMemory?: number; TotalVisibleMemorySize?: number };
  if (!rec.TotalVisibleMemorySize) return [];
  const usedPct = Math.round(
    ((rec.TotalVisibleMemorySize - (rec.FreePhysicalMemory || 0)) / rec.TotalVisibleMemorySize) *
      100
  );
  return [
    {
      name: 'RAM usage',
      value: usedPct,
      unit: '%',
      status: usedPct >= 95 ? 'critical' : usedPct >= 85 ? 'warning' : 'ok',
    },
  ];
}

function buildHypothesis(metrics: DiagnosticMetric[]): string | null {
  const bad = metrics.filter((m) => m.status !== 'ok');
  if (bad.length === 0) return null;
  const worst = bad.find((m) => m.status === 'critical') || bad[0];
  return `${worst.name} is at ${worst.value}${worst.unit || ''} on this Windows host — investigate via Event Viewer / Task Manager for the specific process or service involved.`;
}

export async function diagnoseWinrm(
  target: TargetCredentials,
  category: DiagnosticCategory
): Promise<DiagnosticResult> {
  const command = PS_COMMANDS[category];
  if (!command) {
    return {
      category,
      target: target.name,
      protocol: 'winrm',
      metrics: [],
      rootCauseHypothesis: `${category} is not supported over WinRM yet.`,
    };
  }

  const rawOutput = await runPs(target, command);
  const parsed = tryParseJson(rawOutput);

  let metrics: DiagnosticMetric[] = [];
  if (category === 'disk_health') {
    metrics = buildMetricsForDisk(parsed);
  } else if (category === 'ram_health') {
    metrics = buildMetricsForRam(parsed);
  } else if (category === 'os_health' || category === 'service_health') {
    const stopped = Array.isArray(parsed) ? parsed.length : parsed ? 1 : 0;
    metrics = [
      { name: 'Non-running services', value: stopped, status: stopped > 0 ? 'warning' : 'ok' },
    ];
  } else if (category === 'process_health') {
    const processes = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    metrics = [{ name: 'Top process sample rows', value: processes.length, status: 'ok' }];
  } else if (category === 'cpu_health') {
    const samples = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const value = Number((samples[0] as { CookedValue?: number })?.CookedValue);
    metrics = [
      {
        name: 'CPU utilization',
        value: Number.isFinite(value) ? Math.round(value) : 'unknown',
        unit: '%',
        status: !Number.isFinite(value)
          ? 'ok'
          : value >= 95
            ? 'critical'
            : value >= 85
              ? 'warning'
              : 'ok',
        threshold: 'warning >=85%, critical >=95%',
      },
    ];
  } else if (category === 'storage_health') {
    const disks = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    metrics = disks.flatMap((disk) => {
      const record = disk as { DeviceID?: string; Size?: number; FreeSpace?: number };
      const size = Number(record.Size);
      const free = Number(record.FreeSpace);
      if (!size) return [];
      const used = Math.round(((size - free) / size) * 100);
      return [
        {
          name: `Storage usage (${record.DeviceID || '?'})`,
          value: used,
          unit: '%',
          status: used >= 90 ? 'critical' : used >= 75 ? 'warning' : ('ok' as const),
        },
      ];
    });
  } else {
    metrics = [{ name: 'Diagnostic output length', value: rawOutput.length, status: 'ok' }];
  }

  return {
    category,
    target: target.name,
    protocol: 'winrm',
    metrics,
    rootCauseHypothesis: buildHypothesis(metrics),
    rawOutput: rawOutput.slice(0, 4000),
  };
}
