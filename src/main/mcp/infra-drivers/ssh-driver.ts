import { Client, type ConnectConfig } from 'ssh2';
import type {
  DiagnosticCategory,
  DiagnosticMetric,
  DiagnosticResult,
  TargetCredentials,
} from './types';

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function toConnectConfig(target: TargetCredentials): ConnectConfig {
  return {
    host: target.host,
    port: target.port || 22,
    username: target.username,
    password: target.privateKey ? undefined : target.secret,
    privateKey: target.privateKey,
    passphrase: target.passphrase,
    readyTimeout: 10000,
  };
}

export function sshExec(
  target: TargetCredentials,
  command: string,
  timeoutMs = 15000
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    conn
      .on('ready', () => {
        conn.exec(command, (err: Error | undefined, stream: import('ssh2').ClientChannel) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            reject(err);
            return;
          }
          let stdout = '';
          let stderr = '';
          stream
            .on('close', (code: number | null) => {
              clearTimeout(timer);
              conn.end();
              resolve({ stdout, stderr, code });
            })
            .on('data', (data: Buffer) => {
              stdout += data.toString('utf8');
            })
            .stderr.on('data', (data: Buffer) => {
              stderr += data.toString('utf8');
            });
        });
      })
      .on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect(toConnectConfig(target));
  });
}

async function runMany(
  target: TargetCredentials,
  commands: string[]
): Promise<Record<string, ExecResult>> {
  const results: Record<string, ExecResult> = {};
  for (const cmd of commands) {
    try {
      results[cmd] = await sshExec(target, cmd);
    } catch (err) {
      results[cmd] = {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        code: -1,
      };
    }
  }
  return results;
}

function parseDiskUsage(dfOutput: string): DiagnosticMetric[] {
  const metrics: DiagnosticMetric[] = [];
  const lines = dfOutput.trim().split('\n').slice(1);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [, , , , usePctRaw, mount] = parts;
    const usePct = parseInt(usePctRaw.replace('%', ''), 10);
    if (Number.isNaN(usePct)) continue;
    metrics.push({
      name: `Disk usage (${mount})`,
      value: usePct,
      unit: '%',
      status: usePct >= 90 ? 'critical' : usePct >= 75 ? 'warning' : 'ok',
      threshold: 'warning >=75%, critical >=90%',
    });
  }
  return metrics;
}

function parseMemUsage(freeOutput: string): DiagnosticMetric[] {
  const line = freeOutput.split('\n').find((l) => l.trim().startsWith('Mem:'));
  if (!line) return [];
  const parts = line.trim().split(/\s+/);
  const total = parseInt(parts[1], 10);
  const available = parseInt(parts[6] ?? parts[3], 10);
  if (!total || Number.isNaN(available)) return [];
  const usedPct = Math.round(((total - available) / total) * 100);
  return [
    {
      name: 'RAM usage',
      value: usedPct,
      unit: '%',
      status: usedPct >= 95 ? 'critical' : usedPct >= 85 ? 'warning' : 'ok',
      threshold: 'warning >=85%, critical >=95%',
    },
  ];
}

function parseFailedServices(output: string): DiagnosticMetric[] {
  const failed = output
    .split('\n')
    .filter((l) => l.includes('failed') && !l.toLowerCase().startsWith('0 loaded'));
  return [
    {
      name: 'Failed services',
      value: failed.length,
      status: failed.length > 0 ? 'critical' : 'ok',
    },
  ];
}

function buildHypothesis(category: DiagnosticCategory, metrics: DiagnosticMetric[]): string | null {
  const bad = metrics.filter((m) => m.status !== 'ok');
  if (bad.length === 0) return null;
  const worst = bad.find((m) => m.status === 'critical') || bad[0];
  switch (category) {
    case 'disk_health':
      return `${worst.name} is at ${worst.value}${worst.unit || ''} — likely cause of write failures, log rotation failures, or service crashes on this host. Free up space or extend the volume.`;
    case 'ram_health':
      return `${worst.name} is at ${worst.value}${worst.unit || ''} — likely cause of OOM kills, swapping, or slow response times. Identify the top memory consumer and consider restarting it or adding RAM.`;
    case 'os_health':
      return `${worst.name} = ${worst.value} — one or more system services have failed and need investigation (check \`systemctl status\` / journal for the failed unit).`;
    default:
      return `${worst.name} is ${worst.value}${worst.unit || ''}, outside the healthy range (${worst.threshold || 'n/a'}).`;
  }
}

export async function diagnoseSsh(
  target: TargetCredentials,
  category: DiagnosticCategory
): Promise<DiagnosticResult> {
  let metrics: DiagnosticMetric[] = [];
  let rawOutput = '';

  switch (category) {
    case 'disk_health': {
      const { 'df -h': dfRes } = await runMany(target, ['df -h']);
      metrics = parseDiskUsage(dfRes.stdout);
      rawOutput = dfRes.stdout;
      break;
    }
    case 'ram_health': {
      const { 'free -m': freeRes } = await runMany(target, ['free -m']);
      metrics = parseMemUsage(freeRes.stdout);
      rawOutput = freeRes.stdout;
      break;
    }
    case 'os_health': {
      const results = await runMany(target, ['uptime', 'systemctl --failed --no-legend']);
      metrics = [
        { name: 'Uptime', value: results.uptime.stdout.trim() || 'unknown', status: 'ok' },
        ...parseFailedServices(results['systemctl --failed --no-legend'].stdout),
      ];
      rawOutput = Object.values(results)
        .map((r) => r.stdout)
        .join('\n---\n');
      break;
    }
    case 'network_health': {
      const results = await runMany(target, [
        'ip -brief addr 2>/dev/null || ifconfig',
        'ss -tulpn 2>/dev/null | head -30',
      ]);
      rawOutput = Object.values(results)
        .map((r) => r.stdout)
        .join('\n---\n');
      metrics = [
        {
          name: 'Network interfaces reachable',
          value: results['ip -brief addr 2>/dev/null || ifconfig'].code === 0 ? 'yes' : 'no',
          status: results['ip -brief addr 2>/dev/null || ifconfig'].code === 0 ? 'ok' : 'critical',
        },
      ];
      break;
    }
    case 'file_health': {
      const results = await runMany(target, [
        'dmesg 2>/dev/null | grep -i "error\\|fail" | tail -20 || journalctl -p err -n 20 --no-pager',
      ]);
      const errLines = Object.values(results)[0].stdout.trim().split('\n').filter(Boolean);
      metrics = [
        {
          name: 'Recent kernel/log errors',
          value: errLines.length,
          status: errLines.length > 5 ? 'warning' : 'ok',
        },
      ];
      rawOutput = Object.values(results)[0].stdout;
      break;
    }
    default:
      metrics = [];
  }

  return {
    category,
    target: target.name,
    protocol: 'ssh',
    metrics,
    rootCauseHypothesis: buildHypothesis(category, metrics),
    rawOutput: rawOutput.slice(0, 4000),
  };
}
