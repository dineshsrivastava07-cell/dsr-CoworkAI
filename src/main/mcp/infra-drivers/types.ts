/**
 * Shared types for infra-rca-server.ts diagnostic drivers (SSH, WinRM, SNMP, DB, ONVIF).
 * Every driver's diagnose function returns a DiagnosticResult so infra-rca-server.ts
 * can format tool output uniformly regardless of which protocol answered it.
 */

export type DiagnosticCategory =
  | 'os_health'
  | 'disk_health'
  | 'ram_health'
  | 'network_health'
  | 'db_health'
  | 'printer_health'
  | 'power_health'
  | 'file_health';

export type MetricStatus = 'ok' | 'warning' | 'critical';

export interface DiagnosticMetric {
  name: string;
  value: string | number;
  unit?: string;
  status: MetricStatus;
  threshold?: string;
}

export interface DiagnosticResult {
  category: DiagnosticCategory;
  target: string;
  protocol: 'ssh' | 'winrm' | 'snmp' | 'db';
  metrics: DiagnosticMetric[];
  rootCauseHypothesis: string | null;
  rawOutput?: string;
}

export interface TargetCredentials {
  id: string;
  name: string;
  protocol: 'ssh' | 'winrm' | 'snmp' | 'db';
  host: string;
  port?: number;
  username?: string;
  secret?: string;
  privateKey?: string;
  passphrase?: string;
  community?: string;
  dbEngine?: 'postgres' | 'mysql';
  dbName?: string;
}

export function worstStatus(metrics: DiagnosticMetric[]): MetricStatus {
  if (metrics.some((m) => m.status === 'critical')) return 'critical';
  if (metrics.some((m) => m.status === 'warning')) return 'warning';
  return 'ok';
}
