import { randomUUID } from 'node:crypto';
import type { InfraRcaImportInput, InfraRcaImportResult } from '../../shared/ipc-types';
import type { TargetCredentials } from './infra-drivers/types';

export const MAX_INFRA_IMPORT_ROWS = 10000;
export const MAX_INFRA_IMPORT_BYTES = 5 * 1024 * 1024;
const fields = [
  'name',
  'protocol',
  'host',
  'port',
  'username',
  'secret',
  'privateKey',
  'passphrase',
  'community',
  'dbEngine',
  'dbName',
  'group',
  'winrmTransport',
  'winrmAuth',
  'winrmRejectUnauthorized',
  'remoteDesktop',
  'remotePort',
] as const;
const headers = new Map(fields.map((field) => [field.toLowerCase(), field]));

/** CSV including quoted commas, escaped quotes, CRLF and multiline SSH keys. */
function parseCsv(content: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(value);
    value = '';
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_INFRA_IMPORT_ROWS + 1)
      throw new Error('Import supports at most 10,000 targets.');
  };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"' && content[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
    } else if (c === ',') cell();
    else if (c === '\n' || c === '\r') {
      line();
      if (c === '\r' && content[i + 1] === '\n') i++;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === '"' || (closed && c.trim()))
      throw new Error('Invalid CSV quoting. Use the CSV template.');
    else if (!closed) value += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (value || row.length || closed) line();
  const header = rows.shift();
  if (!header) throw new Error('Inventory is empty.');
  const keys = header.map((h) => headers.get(h.trim().toLowerCase()));
  if (keys.some((k) => !k) || new Set(keys).size !== keys.length)
    throw new Error('CSV contains unknown or duplicate column names. Use the template headers.');
  if (!keys.includes('name') || !keys.includes('host'))
    throw new Error('CSV requires name and host columns.');
  return rows.map((values, index) => {
    if (values.length !== keys.length)
      throw new Error(`CSV record ${index + 1} has the wrong number of columns.`);
    return Object.fromEntries(keys.map((key, i) => [key!, values[i]]));
  });
}

function pickFields(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Each target must be an object.');
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = headers.get(key.toLowerCase());
    if (!field) throw new Error('Target contains an unknown field. Use the template fields.');
    if (value === undefined || value === null || value === '') continue;
    if (field === 'winrmRejectUnauthorized' && typeof value === 'boolean') {
      result[field] = value;
      continue;
    }
    if (field === 'winrmRejectUnauthorized' && typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'false') {
        result[field] = normalized === 'true';
        continue;
      }
      throw new Error('winrmRejectUnauthorized must be true or false.');
    }
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new Error('Target fields must contain text or numbers.');
    // Keep credentials verbatim. Blank optional cells inherit existing/shared values.
    result[field] = ['secret', 'privateKey', 'passphrase', 'community'].includes(field)
      ? String(value)
      : String(value).trim();
  }
  return result;
}

export function validateTarget(target: TargetCredentials): void {
  if (!target.name || target.name.length > 200)
    throw new Error('Name is required and must be at most 200 characters.');
  if (!target.host || target.host.length > 253 || !/^[\w.:%-]+$/.test(target.host))
    throw new Error('Host must be a hostname or IP address, without a URL or spaces.');
  if (!['ssh', 'winrm', 'snmp', 'db'].includes(target.protocol))
    throw new Error('Protocol must be ssh, winrm, snmp or db.');
  if (
    target.port !== undefined &&
    (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)
  )
    throw new Error('Port must be an integer from 1 to 65535.');
  if (
    target.remotePort !== undefined &&
    (!Number.isInteger(target.remotePort) || target.remotePort < 1 || target.remotePort > 65535)
  )
    throw new Error('Remote desktop port must be an integer from 1 to 65535.');
  if (target.remoteDesktop && !['rdp', 'vnc'].includes(target.remoteDesktop))
    throw new Error('Remote desktop protocol must be rdp or vnc.');
  if (target.group && target.group.length > 100)
    throw new Error('Group must be at most 100 characters.');
  if (target.protocol !== 'snmp' && !target.username)
    throw new Error('Username is required; enter it per row or in shared credentials.');
  if (target.protocol === 'ssh' && !target.secret && !target.privateKey)
    throw new Error('SSH requires a password or private key.');
  if (target.protocol === 'winrm' && target.winrmAuth !== 'kerberos' && !target.secret)
    throw new Error('WinRM requires a password unless Kerberos uses the Windows domain ticket.');
  if (target.protocol === 'winrm') {
    if (target.winrmTransport && !['http', 'https'].includes(target.winrmTransport))
      throw new Error('WinRM transport must be http or https.');
    if (target.winrmAuth && !['basic', 'ntlm', 'kerberos', 'auto'].includes(target.winrmAuth))
      throw new Error('WinRM authentication must be basic, ntlm, kerberos or auto.');
    if (target.winrmAuth === 'basic' && /\\|@/.test(target.username || ''))
      throw new Error(
        'Basic WinRM authentication requires a local username; use ntlm or kerberos for a domain account.'
      );
    if (target.winrmAuth === 'basic' && target.winrmTransport !== 'https' && target.port !== 5986)
      throw new Error(
        'Basic WinRM authentication requires HTTPS; use NTLM/Kerberos or configure an approved HTTPS listener.'
      );
  }
  if (target.protocol === 'snmp' && !target.community)
    throw new Error('SNMP requires a community string.');
  if (target.protocol === 'db' && !['postgres', 'mysql'].includes(target.dbEngine || ''))
    throw new Error('Database engine must be postgres or mysql.');
}

/** Preserve encrypted credentials when a same-protocol UI edit leaves secret fields blank. */
export function mergeInfraTargetUpdate(
  existing: TargetCredentials | undefined,
  target: Omit<TargetCredentials, 'id'> & { id?: string },
  id: string
): TargetCredentials {
  const canPreserve = existing?.protocol === target.protocol;
  const preserveWhenBlank = <K extends keyof TargetCredentials>(key: K) => {
    const incoming = target[key];
    return incoming === undefined || incoming === ''
      ? canPreserve
        ? existing?.[key]
        : undefined
      : incoming;
  };
  const merged = {
    ...(canPreserve ? existing : undefined),
    ...target,
    id,
    username: preserveWhenBlank('username') as string | undefined,
    secret: preserveWhenBlank('secret') as string | undefined,
    privateKey: preserveWhenBlank('privateKey') as string | undefined,
    passphrase: preserveWhenBlank('passphrase') as string | undefined,
    community: preserveWhenBlank('community') as string | undefined,
    dbName: preserveWhenBlank('dbName') as string | undefined,
  } as TargetCredentials;
  for (const key of [
    'username',
    'secret',
    'privateKey',
    'passphrase',
    'community',
    'dbName',
  ] as const) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}

/** Pure plan: credentials stay in nextTargets, never in the public preview/result. */
export function planInfraImport(
  input: InfraRcaImportInput,
  existing: TargetCredentials[]
): {
  result: InfraRcaImportResult;
  nextTargets: TargetCredentials[];
} {
  const result: InfraRcaImportResult = {
    success: false,
    added: 0,
    updated: 0,
    skipped: 0,
    total: 0,
    errors: [],
    preview: [],
  };
  try {
    if (
      !input ||
      typeof input.content !== 'string' ||
      Buffer.byteLength(input.content) > MAX_INFRA_IMPORT_BYTES
    )
      throw new Error('Inventory must be text of at most 5 MB.');
    if (!['skip', 'update'].includes(input.duplicates))
      throw new Error('Choose skip or update for existing targets.');
    const content = input.content.replace(/^\uFEFF/, '');
    let rows: unknown;
    if (input.format === 'csv') rows = parseCsv(content);
    else if (input.format === 'json') {
      try {
        rows = JSON.parse(content);
      } catch {
        throw new Error('Invalid JSON inventory. Expected an array of target objects.');
      }
    } else
      throw new Error('Supported formats are CSV and JSON. Export Excel inventories as CSV UTF-8.');
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_INFRA_IMPORT_ROWS)
      throw new Error('Inventory must contain 1 to 10,000 targets.');
    result.total = rows.length;
    const shared = pickFields(input.defaults || {});
    delete shared.name;
    delete shared.host;
    const nextTargets = [...existing];
    const indices = new Map<string, number>();
    const ambiguous = new Set<string>();
    existing.forEach((t, index) => {
      const key = t.name.trim().toLowerCase();
      if (indices.has(key)) ambiguous.add(key);
      indices.set(key, index);
    });
    const seen = new Set<string>();
    rows.forEach((raw, index) => {
      const row = index + 1;
      try {
        const fields = pickFields(raw);
        const key = String(fields.name || '').toLowerCase();
        if (seen.has(key)) throw new Error('Duplicate name within this inventory.');
        seen.add(key);
        if (ambiguous.has(key))
          throw new Error('Multiple saved targets have this name. Resolve them before importing.');
        const oldIndex = indices.get(key);
        const old = oldIndex === undefined ? undefined : existing[oldIndex];
        const action = old ? (input.duplicates === 'skip' ? 'skip' : 'update') : 'add';
        if (action === 'skip') {
          result.skipped++;
        } else {
          const merged = { ...old, ...shared, ...fields };
          // Do not carry old protocol-specific credentials to a different endpoint/protocol.
          if (old && (merged.protocol !== old.protocol || merged.host !== old.host))
            throw new Error('Updating host or protocol requires a new target name.');
          const target = {
            ...merged,
            id: old?.id || randomUUID(),
            port: merged.port === undefined ? undefined : Number(merged.port),
          } as TargetCredentials;
          validateTarget(target);
          if (oldIndex === undefined) {
            nextTargets.push(target);
            result.added++;
          } else {
            nextTargets[oldIndex] = target;
            result.updated++;
          }
        }
        if (result.preview.length < 100)
          result.preview.push({
            row,
            name: String(fields.name || ''),
            host: String(fields.host || old?.host || ''),
            protocol: String(fields.protocol || shared.protocol || old?.protocol || ''),
            group: String(fields.group || shared.group || old?.group || ''),
            action,
          });
      } catch (error) {
        result.errors.push({
          row,
          message: error instanceof Error ? error.message : 'Invalid target.',
        });
      }
    });
    result.success = result.errors.length === 0;
    return { result, nextTargets: result.success ? nextTargets : existing };
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Inventory validation failed.';
    return { result, nextTargets: existing };
  }
}
