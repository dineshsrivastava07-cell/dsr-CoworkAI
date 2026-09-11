import * as snmp from 'net-snmp';
import type {
  DiagnosticCategory,
  DiagnosticMetric,
  DiagnosticResult,
  TargetCredentials,
} from './types';

// Standard IETF MIB OIDs — chosen because most vendors implement these,
// avoiding any vendor-specific integration.
const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  // HOST-RESOURCES-MIB hrStorageTable (RFC 2790)
  hrStorageTable: '1.3.6.1.2.1.25.2.3',
  // IF-MIB ifTable (RFC 2863)
  ifTable: '1.3.6.1.2.1.2.2',
  // UPS-MIB (RFC 1628)
  upsBatteryStatus: '1.3.6.1.2.1.33.1.2.1.0',
  upsEstimatedMinutesRemaining: '1.3.6.1.2.1.33.1.2.3.0',
  upsEstimatedChargeRemaining: '1.3.6.1.2.1.33.1.2.4.0',
  upsOutputSource: '1.3.6.1.2.1.33.1.4.1.0',
} as const;

const UPS_BATTERY_STATUS_LABELS: Record<number, string> = {
  1: 'unknown',
  2: 'normal',
  3: 'low',
  4: 'depleted',
};

interface RawTable {
  [rowIndex: string]: { [column: string]: unknown };
}

function createSession(target: TargetCredentials): snmp.Session {
  return snmp.createSession(target.host, target.community || 'public', {
    port: target.port || 161,
    retries: 1,
    timeout: 5000,
    version: snmp.Version2c,
  });
}

function snmpGet(session: snmp.Session, oids: string[]): Promise<snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(varbinds || []);
    });
  });
}

function snmpTable(session: snmp.Session, oid: string): Promise<RawTable> {
  return new Promise((resolve, reject) => {
    session.table(oid, (error, table) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((table as unknown as RawTable) || {});
    });
  });
}

function buildHypothesis(category: DiagnosticCategory, metrics: DiagnosticMetric[]): string | null {
  const bad = metrics.filter((m) => m.status !== 'ok');
  if (bad.length === 0) return null;
  const worst = bad.find((m) => m.status === 'critical') || bad[0];
  switch (category) {
    case 'power_health':
      return `UPS reports ${worst.name} = ${worst.value}${worst.unit || ''} — likely a mains power issue or aging battery; check the utility feed and battery age.`;
    case 'printer_health':
      return `${worst.name} = ${worst.value} — the printer is reporting a fault (check for paper jam, low toner/ink, or offline status physically).`;
    case 'network_health':
      return `${worst.name} — one or more interfaces are down or showing errors; check physical cabling and switch port status.`;
    case 'disk_health':
      return `${worst.name} is at ${worst.value}${worst.unit || ''} — approaching capacity on this device.`;
    default:
      return `${worst.name} is ${worst.value}${worst.unit || ''}, outside the healthy range.`;
  }
}

export async function diagnoseSnmp(
  target: TargetCredentials,
  category: DiagnosticCategory
): Promise<DiagnosticResult> {
  const session = createSession(target);
  let metrics: DiagnosticMetric[] = [];
  let rawOutput = '';

  try {
    switch (category) {
      case 'power_health': {
        const varbinds = await snmpGet(session, [
          OID.upsBatteryStatus,
          OID.upsEstimatedChargeRemaining,
          OID.upsEstimatedMinutesRemaining,
        ]);
        const [batteryStatus, charge, minutesRemaining] = varbinds.map((v) =>
          snmp.isVarbindError(v) ? null : v.value
        );
        const statusNum = typeof batteryStatus === 'number' ? batteryStatus : Number(batteryStatus);
        metrics = [
          {
            name: 'UPS battery status',
            value: UPS_BATTERY_STATUS_LABELS[statusNum] || String(batteryStatus),
            status:
              statusNum === 2
                ? 'ok'
                : statusNum === 3
                  ? 'warning'
                  : statusNum === 4
                    ? 'critical'
                    : 'ok',
          },
        ];
        if (charge !== null && charge !== undefined) {
          const chargeNum = Number(charge);
          metrics.push({
            name: 'UPS charge remaining',
            value: chargeNum,
            unit: '%',
            status: chargeNum < 20 ? 'critical' : chargeNum < 50 ? 'warning' : 'ok',
          });
        }
        if (minutesRemaining !== null && minutesRemaining !== undefined) {
          metrics.push({
            name: 'UPS estimated runtime',
            value: Number(minutesRemaining),
            unit: 'min',
            status: 'ok',
          });
        }
        rawOutput = JSON.stringify(varbinds);
        break;
      }
      case 'printer_health':
      case 'os_health': {
        const varbinds = await snmpGet(session, [OID.sysDescr, OID.sysUpTime]);
        const [descr, upTime] = varbinds.map((v) =>
          snmp.isVarbindError(v) ? 'unknown' : String(v.value)
        );
        metrics = [
          { name: 'Device description', value: descr, status: 'ok' },
          { name: 'System uptime (ticks)', value: upTime, status: 'ok' },
        ];
        rawOutput = JSON.stringify(varbinds);
        break;
      }
      case 'network_health': {
        const table = await snmpTable(session, OID.ifTable);
        const rows = Object.values(table);
        // Column 8 = ifOperStatus (1=up, 2=down), 14 = ifInErrors, 20 = ifOutErrors
        const down = rows.filter((r) => Number(r['8']) === 2).length;
        const totalInErrors = rows.reduce((sum, r) => sum + (Number(r['14']) || 0), 0);
        metrics = [
          { name: 'Interfaces down', value: down, status: down > 0 ? 'warning' : 'ok' },
          {
            name: 'Total inbound errors',
            value: totalInErrors,
            status: totalInErrors > 1000 ? 'warning' : 'ok',
          },
        ];
        rawOutput = JSON.stringify(table).slice(0, 2000);
        break;
      }
      case 'disk_health': {
        const table = await snmpTable(session, OID.hrStorageTable);
        const rows = Object.values(table);
        // Column 3 = hrStorageDescr, 4 = hrStorageAllocationUnits, 5 = hrStorageSize, 6 = hrStorageUsed
        for (const row of rows) {
          const size = Number(row['5']);
          const used = Number(row['6']);
          if (!size) continue;
          const pct = Math.round((used / size) * 100);
          metrics.push({
            name: `Storage usage (${row['3'] ?? 'unknown'})`,
            value: pct,
            unit: '%',
            status: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
          });
        }
        rawOutput = JSON.stringify(table).slice(0, 2000);
        break;
      }
      default:
        metrics = [];
    }
  } finally {
    session.close();
  }

  return {
    category,
    target: target.name,
    protocol: 'snmp',
    metrics,
    rootCauseHypothesis: buildHypothesis(category, metrics),
    rawOutput: rawOutput.slice(0, 4000),
  };
}
