import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import type {
  DiagnosticCategory,
  DiagnosticMetric,
  DiagnosticResult,
  TargetCredentials,
} from './types';

function buildHypothesis(metrics: DiagnosticMetric[]): string | null {
  const bad = metrics.filter((m) => m.status !== 'ok');
  if (bad.length === 0) return null;
  const worst = bad.find((m) => m.status === 'critical') || bad[0];
  return `${worst.name} is at ${worst.value}${worst.unit || ''} — likely cause of slow queries, connection refusals, or replication issues on this database.`;
}

async function diagnosePostgres(target: TargetCredentials): Promise<DiagnosticMetric[]> {
  const client = new PgClient({
    host: target.host,
    port: target.port || 5432,
    user: target.username,
    password: target.secret,
    database: target.dbName || 'postgres',
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const metrics: DiagnosticMetric[] = [];

    const conns = await client.query(
      "SELECT count(*)::int AS current, (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max FROM pg_stat_activity"
    );
    const current = conns.rows[0]?.current ?? 0;
    const max = conns.rows[0]?.max ?? 100;
    const pct = Math.round((current / max) * 100);
    metrics.push({
      name: 'Connection pool usage',
      value: pct,
      unit: '%',
      status: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
      threshold: `${current}/${max} connections`,
    });

    const longQueries = await client.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '30 seconds'"
    );
    const longCount = longQueries.rows[0]?.n ?? 0;
    metrics.push({
      name: 'Queries running > 30s',
      value: longCount,
      status: longCount > 0 ? 'warning' : 'ok',
    });

    const dbSize = await client.query(
      'SELECT pg_database_size(current_database())::bigint AS bytes'
    );
    metrics.push({
      name: 'Database size',
      value: Math.round(Number(dbSize.rows[0]?.bytes ?? 0) / 1024 / 1024),
      unit: 'MB',
      status: 'ok',
    });

    return metrics;
  } finally {
    await client.end();
  }
}

async function diagnoseMysql(target: TargetCredentials): Promise<DiagnosticMetric[]> {
  const conn = await mysql.createConnection({
    host: target.host,
    port: target.port || 3306,
    user: target.username,
    password: target.secret,
    database: target.dbName,
    connectTimeout: 8000,
  });
  try {
    const metrics: DiagnosticMetric[] = [];

    const [threadsRows] = await conn.query("SHOW STATUS LIKE 'Threads_connected'");
    const [maxConnRows] = await conn.query("SHOW VARIABLES LIKE 'max_connections'");
    const current = Number((threadsRows as Array<{ Value: string }>)[0]?.Value ?? 0);
    const max = Number((maxConnRows as Array<{ Value: string }>)[0]?.Value ?? 151);
    const pct = Math.round((current / max) * 100);
    metrics.push({
      name: 'Connection pool usage',
      value: pct,
      unit: '%',
      status: pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'ok',
      threshold: `${current}/${max} connections`,
    });

    const [slowRows] = await conn.query("SHOW STATUS LIKE 'Slow_queries'");
    const slowCount = Number((slowRows as Array<{ Value: string }>)[0]?.Value ?? 0);
    metrics.push({
      name: 'Slow queries (cumulative)',
      value: slowCount,
      status: slowCount > 0 ? 'warning' : 'ok',
    });

    const [uptimeRows] = await conn.query("SHOW STATUS LIKE 'Uptime'");
    metrics.push({
      name: 'Server uptime',
      value: Number((uptimeRows as Array<{ Value: string }>)[0]?.Value ?? 0),
      unit: 's',
      status: 'ok',
    });

    return metrics;
  } finally {
    await conn.end();
  }
}

export async function diagnoseDb(
  target: TargetCredentials,
  category: DiagnosticCategory
): Promise<DiagnosticResult> {
  if (category !== 'db_health') {
    return {
      category,
      target: target.name,
      protocol: 'db',
      metrics: [],
      rootCauseHypothesis: `${category} is not a database diagnostic category — use db_health for this target.`,
    };
  }

  const metrics =
    target.dbEngine === 'mysql' ? await diagnoseMysql(target) : await diagnosePostgres(target);

  return {
    category,
    target: target.name,
    protocol: 'db',
    metrics,
    rootCauseHypothesis: buildHypothesis(metrics),
  };
}

/**
 * Rejects anything but a single read-only statement. Deliberately simple (not a
 * full SQL parser) — good enough to stop the obvious cases (writes, DDL,
 * statement-stacking) for a tool that's auto-allowed without human confirmation;
 * anything that actually mutates data still has to go through the gated
 * infra_propose_fix / infra_execute_fix flow.
 */
export function assertReadOnlySelect(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    throw new Error('infra_query_db only accepts a single statement — remove the extra ";".');
  }
  if (!/^\s*(select|with|show|explain|describe|desc)\b/i.test(trimmed)) {
    throw new Error(
      'infra_query_db only accepts read-only statements (SELECT/WITH/SHOW/EXPLAIN/DESCRIBE). Use infra_propose_fix + infra_execute_fix for anything that writes data.'
    );
  }
}

/** Runs a read-only SQL query for ad-hoc auditing/lookups. Auto-allowed — see assertReadOnlySelect. */
export async function dbQuery(target: TargetCredentials, sql: string): Promise<string> {
  assertReadOnlySelect(sql);
  if (target.dbEngine === 'mysql') {
    const conn = await mysql.createConnection({
      host: target.host,
      port: target.port || 3306,
      user: target.username,
      password: target.secret,
      database: target.dbName,
      connectTimeout: 8000,
    });
    try {
      const [rows] = await conn.query(sql);
      return JSON.stringify(rows).slice(0, 2000);
    } finally {
      await conn.end();
    }
  }

  const client = new PgClient({
    host: target.host,
    port: target.port || 5432,
    user: target.username,
    password: target.secret,
    database: target.dbName || 'postgres',
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    return JSON.stringify({ rowCount: result.rowCount, rows: result.rows.slice(0, 20) }).slice(
      0,
      2000
    );
  } finally {
    await client.end();
  }
}

/** Runs an exact, already-proposed SQL remediation statement. Used only by infra_execute_fix. */
export async function dbExecuteFix(target: TargetCredentials, sql: string): Promise<string> {
  if (target.dbEngine === 'mysql') {
    const conn = await mysql.createConnection({
      host: target.host,
      port: target.port || 3306,
      user: target.username,
      password: target.secret,
      database: target.dbName,
      connectTimeout: 8000,
    });
    try {
      const [result] = await conn.query(sql);
      return JSON.stringify(result).slice(0, 2000);
    } finally {
      await conn.end();
    }
  }

  const client = new PgClient({
    host: target.host,
    port: target.port || 5432,
    user: target.username,
    password: target.secret,
    database: target.dbName || 'postgres',
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    return JSON.stringify({ rowCount: result.rowCount, rows: result.rows.slice(0, 20) }).slice(
      0,
      2000
    );
  } finally {
    await client.end();
  }
}
