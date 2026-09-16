import { describe, expect, it } from 'vitest';
import { mergeInfraTargetUpdate, planInfraImport } from '../src/main/mcp/infra-rca-import';
import { selectInfraTargetPage } from '../src/main/mcp/infra-target-page';
import type { InfraRcaImportInput } from '../src/shared/ipc-types';
import type { TargetCredentials } from '../src/main/mcp/infra-drivers/types';

const defaults = {
  protocol: 'ssh' as const,
  username: 'operator',
  secret: 'test-secret',
  group: 'Mumbai',
};
const input = (content: string, extra: Partial<InfraRcaImportInput> = {}): InfraRcaImportInput => ({
  format: 'csv',
  content,
  defaults,
  duplicates: 'skip',
  ...extra,
});
const old: TargetCredentials = {
  id: 'existing-id',
  name: 'server-1',
  protocol: 'ssh',
  host: '10.0.0.1',
  username: 'existing-user',
  secret: 'existing-secret',
};

describe('bulk infrastructure import', () => {
  it('plans more than 1,000 systems and redacts every credential from preview', () => {
    const content =
      'name,host\n' +
      Array.from({ length: 1200 }, (_, i) => `system-${i},host-${i}.example.test`).join('\n');
    const { result, nextTargets } = planInfraImport(input(content), []);
    expect(result).toMatchObject({
      success: true,
      total: 1200,
      added: 1200,
      updated: 0,
      skipped: 0,
    });
    expect(nextTargets).toHaveLength(1200);
    expect(new Set(nextTargets.map((t) => t.id)).size).toBe(1200);
    expect(nextTargets[1199]).toMatchObject(defaults);
    expect(result.preview).toHaveLength(100);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(JSON.stringify(result)).not.toContain('operator');
  });

  it('handles Excel BOM/CRLF, quoted commas, escaped quotes and multiline private keys', () => {
    const { result, nextTargets } = planInfraImport(
      input('\uFEFFname,host,privateKey\r\n"Server, ""A""",host-a,"line1\r\nline2"\r\n'),
      []
    );
    expect(result.success).toBe(true);
    expect(nextTargets[0]).toMatchObject({ name: 'Server, "A"', privateKey: 'line1\r\nline2' });
  });

  it('does not return any modified targets when one row is invalid', () => {
    const existing = [old];
    const { result, nextTargets } = planInfraImport(
      input('name,host,port\nvalid,host-a,22\nbad,host-b,65536'),
      existing
    );
    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      { row: 2, message: 'Port must be an integer from 1 to 65535.' },
    ]);
    expect(nextTargets).toBe(existing);
    expect(old.secret).toBe('existing-secret');
  });

  it('skips existing names case-insensitively without changing credentials', () => {
    const { result, nextTargets } = planInfraImport(input('name,host\nSERVER-1,10.0.0.1'), [old]);
    expect(result).toMatchObject({ success: true, skipped: 1, added: 0 });
    expect(nextTargets).toEqual([old]);
  });

  it('updates the existing ID and keeps credentials for blank optional cells', () => {
    const { result, nextTargets } = planInfraImport(
      input('name,host,secret,group\nserver-1,10.0.0.1,,Delhi', {
        duplicates: 'update',
        defaults: {},
      }),
      [old]
    );
    expect(result).toMatchObject({ success: true, updated: 1 });
    expect(nextTargets).toEqual([{ ...old, group: 'Delhi', port: undefined }]);
  });

  it('keeps encrypted credentials when the same-protocol edit leaves them blank', () => {
    expect(
      mergeInfraTargetUpdate(
        old,
        {
          ...old,
          id: undefined,
          host: '10.0.0.2',
          username: '',
          secret: '',
          port: 2222,
        },
        old.id
      )
    ).toEqual({ ...old, host: '10.0.0.2', port: 2222 });
  });

  it('does not carry credentials into a protocol change', () => {
    expect(
      mergeInfraTargetUpdate(
        old,
        { name: old.name, host: old.host, protocol: 'snmp', community: '' },
        old.id
      )
    ).not.toHaveProperty('secret');
  });

  it('uses explicit row credentials ahead of shared credentials', () => {
    const { nextTargets } = planInfraImport(input('name,host,secret\nnew,host-a,row-secret'), []);
    expect(nextTargets[0].secret).toBe('row-secret');
  });

  it('rejects duplicate inventory names and ambiguous saved names', () => {
    expect(
      planInfraImport(input('name,host\nnew,host-a\nNEW,host-b'), []).result.errors[0].row
    ).toBe(2);
    expect(
      planInfraImport(input('name,host\nserver-1,10.0.0.1'), [old, { ...old, id: 'duplicate' }])
        .result.success
    ).toBe(false);
  });

  it('requires a new name when updating would redirect stored credentials', () => {
    const { result } = planInfraImport(
      input('name,host\nserver-1,another-host', { duplicates: 'update' }),
      [old]
    );
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('new target name');
  });

  it.each([
    'name,host,protocol\nnew,host-a,rdp',
    'name,host\nnew,https://host-a',
    'name,host,port\nnew,host-a,1.5',
    'name,host,port\nnew,host-a,0',
    'name,host\n"new,host-a',
    'name,host,unknown\nnew,host-a,value',
    'name,host,host\nnew,host-a,host-b',
    'name,host\nnew,host-a,unexpected',
  ])('rejects invalid CSV without committing: %s', (content) => {
    expect(planInfraImport(input(content), []).result.success).toBe(false);
  });

  it('parses JSON, requires credentials, and keeps parse errors free of input secrets', () => {
    expect(
      planInfraImport(input('[{"name":"new","host":"host-a"}]', { format: 'json' }), []).result
        .success
    ).toBe(true);
    expect(
      planInfraImport(input('name,host,protocol\nnew,host-a,ssh', { defaults: {} }), []).result
        .success
    ).toBe(false);
    const result = planInfraImport(
      input('[{"secret":"highly-sensitive-secret" BROKEN', { format: 'json' }),
      []
    ).result;
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('highly-sensitive-secret');
  });

  it('enforces file and row limits', () => {
    expect(planInfraImport(input('x'.repeat(5 * 1024 * 1024 + 1)), []).result.success).toBe(false);
    const rows = Array.from({ length: 10001 }, (_, i) => ({
      name: `host-${i}`,
      host: `host-${i}`,
    }));
    expect(
      planInfraImport(input(JSON.stringify(rows), { format: 'json' }), []).result.success
    ).toBe(false);
  });
});

describe('fleet discovery pages', () => {
  const targets = Array.from({ length: 1200 }, (_, i) => ({
    name: `system-${i}`,
    host: `host-${i}`,
    protocol: 'ssh',
    group: i < 1050 ? 'Mumbai' : 'Delhi',
  }));
  it('does not truncate a fleet silently; returns a continuation offset', () => {
    const first = selectInfraTargetPage(targets);
    expect(first).toMatchObject({ total: 1200, offset: 0, nextOffset: 50 });
    expect(first.targets).toHaveLength(50);
    expect(selectInfraTargetPage(targets, { offset: 1150 }).nextOffset).toBeNull();
  });
  it('filters group/site and query before paging', () => {
    expect(selectInfraTargetPage(targets, { group: 'delhi', query: 'host-11' }).total).toBe(100);
    expect(selectInfraTargetPage(targets, { group: 'missing' }).targets).toEqual([]);
    expect(() => selectInfraTargetPage(targets, { limit: 1000 })).toThrow();
  });
});
