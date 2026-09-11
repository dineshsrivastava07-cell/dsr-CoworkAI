// Best-effort WinRM driver. Node WinRM client libraries are far less mature
// than SSH's — @netcuras/nodejs-winrm is a pure-JS WS-Management client (no
// native/edge.js dependency, so it actually runs on macOS/Linux), but only
// covers Basic auth over HTTP (not Kerberos/NTLM/HTTPS-with-client-certs).
// Treat results here as best-effort; SSH remains the fully-supported path.
import winrm from '@netcuras/nodejs-winrm';
import type {
  DiagnosticCategory,
  DiagnosticMetric,
  DiagnosticResult,
  TargetCredentials,
} from './types';

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
};

async function runPs(target: TargetCredentials, command: string): Promise<string> {
  const result = await winrm.runPowershell(
    command,
    target.host,
    target.username || '',
    target.secret || '',
    target.port || 5985
  );
  if (result instanceof Error) {
    throw result;
  }
  return typeof result === 'string' ? result : String(result);
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
  } else if (category === 'os_health') {
    const stopped = Array.isArray(parsed) ? parsed.length : parsed ? 1 : 0;
    metrics = [
      { name: 'Non-running services', value: stopped, status: stopped > 0 ? 'warning' : 'ok' },
    ];
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
