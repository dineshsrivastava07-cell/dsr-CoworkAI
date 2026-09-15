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

/** Conservative syntax screening; the database read-only transaction is the enforcement boundary. */
export function assertReadOnlySelect(sql: string): void {
  if (typeof sql !== 'string' || sql.length > 100_000) throw new Error('Invalid or oversized SQL');
  // Strip string/identifier literals before inspecting tokens. Executable MySQL
  // comments and dollar-quoted expressions are deliberately unsupported.
  if (/\/\*!|\$[a-z_]*\$/i.test(sql))
    throw new Error('Executable comments/dollar quoting are unsupported');
  const statement = sql.trim().replace(/;\s*$/, '');
  const tokens = statement
    .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`/g, ' literal ')
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  if (
    tokens.includes(';') ||
    !/^\s*(select|with|show|explain|describe|desc)\b/i.test(tokens) ||
    /\b(insert|update|delete|merge|into|create|drop|alter|truncate|grant|revoke|copy|call|do|execute|lock|set|reset|analyze|analyse)\b/i.test(
      tokens
    )
  ) {
    throw new Error(
      'infra_query_db accepts one read-only statement; mutations require an approved fix'
    );
  }
  // A read-only transaction cannot make arbitrary stored functions safe. Only
  // side-effect-free SQL functions used by supported analytical lookups are allowed.
  const safeFunctions = new Set([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'round',
    'abs',
    'ceil',
    'ceiling',
    'floor',
    'coalesce',
    'nullif',
    'cast',
    'extract',
    'date_trunc',
    'date_part',
    'lower',
    'upper',
    'length',
    'concat',
    'substring',
    'trim',
    'now',
    'current_date',
    'current_timestamp',
    'row_number',
    'rank',
    'dense_rank',
    'lag',
    'lead',
    'first_value',
    'last_value',
    'greatest',
    'least',
    'stddev',
    'stddev_samp',
    'variance',
    'percentile_cont',
    'percentile_disc',
    'json_agg',
    'jsonb_agg',
    'array_agg',
    'string_agg',
    'as',
    'in',
    'exists',
    'over',
    'filter',
    'values',
    'select',
    'with',
    'from',
  ]);
  for (const match of tokens.matchAll(/\b([a-z_][a-z_0-9]*)\s*\(/gi)) {
    if (!safeFunctions.has(match[1].toLowerCase()))
      throw new Error(`Function ${match[1]} is not allowed in read-only queries`);
  }
}

const QUERY_TIMEOUT_MS = 5000;
const QUERY_ROW_LIMIT = 1000;

function boundedQuery(sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, '');
  return /^\s*(select|with)\b/i.test(statement)
    ? `SELECT * FROM (${statement}) AS cowork_readonly LIMIT ${QUERY_ROW_LIMIT + 1}`
    : statement;
}

function formatQueryRows(rows: unknown[]): string {
  return JSON.stringify({
    rowCount: Math.min(rows.length, QUERY_ROW_LIMIT),
    truncated: rows.length > QUERY_ROW_LIMIT,
    rows: rows.slice(0, QUERY_ROW_LIMIT),
  });
}

/** Execute in an enforced read-only transaction, bounded in time and row count. */
export async function dbQuery(
  target: TargetCredentials,
  sql: string,
  signal?: AbortSignal
): Promise<string> {
  assertReadOnlySelect(sql);
  signal?.throwIfAborted();
  if (target.dbEngine === 'mysql') {
    const conn = await mysql.createConnection({
      host: target.host,
      port: target.port || 3306,
      user: target.username,
      password: target.secret,
      database: target.dbName,
      connectTimeout: QUERY_TIMEOUT_MS,
      multipleStatements: false,
    });
    const abort = () => conn.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      await conn.query('SET SESSION MAX_EXECUTION_TIME = 5000');
      await conn.query('START TRANSACTION READ ONLY');
      const [rows] = await conn.query({ sql: boundedQuery(sql), timeout: QUERY_TIMEOUT_MS });
      return formatQueryRows(rows as unknown[]);
    } finally {
      signal?.removeEventListener('abort', abort);
      try {
        await conn.rollback();
      } finally {
        conn.destroy();
      }
    }
  }
  const client = new PgClient({
    host: target.host,
    port: target.port || 5432,
    user: target.username,
    password: target.secret,
    database: target.dbName || 'postgres',
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS + 1000,
  });
  const abort = () => {
    void client.end().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const result = await client.query(boundedQuery(sql));
    return formatQueryRows(result.rows);
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      if (!signal?.aborted) await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
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
