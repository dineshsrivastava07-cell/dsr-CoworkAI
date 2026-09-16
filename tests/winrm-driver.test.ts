import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ runPowershell: vi.fn() }));
vi.mock('winrm-client', () => ({ runPowershell: mock.runPowershell }));
import {
  diagnoseWinrm,
  getWinrmConnectionSettings,
} from '../src/main/mcp/infra-drivers/winrm-driver';

const base = {
  id: 'w1',
  name: 'win',
  protocol: 'winrm' as const,
  host: 'server.test',
  username: 'CONTOSO\\svc',
  secret: 'fixture',
};

describe('advanced WinRM transport', () => {
  it('selects NTLM and HTTPS with certificate verification for a domain target', () => {
    expect(
      getWinrmConnectionSettings({
        ...base,
        port: 5986,
        winrmTransport: 'https',
        winrmAuth: 'ntlm',
      })
    ).toEqual({ auth: 'ntlm', useHttps: true, port: 5986, rejectUnauthorized: true });
  });

  it('auto-detects NTLM for a UPN and preserves an explicit insecure-test certificate setting', () => {
    expect(
      getWinrmConnectionSettings({
        ...base,
        username: 'svc@contoso.test',
        winrmRejectUnauthorized: false,
      })
    ).toEqual({ auth: 'ntlm', useHttps: false, port: 5985, rejectUnauthorized: false });
  });

  it('rejects contradictory Basic/domain and NTLM/local configurations', () => {
    expect(() => getWinrmConnectionSettings({ ...base, winrmAuth: 'basic' })).toThrow('domain/UPN');
    expect(() =>
      getWinrmConnectionSettings({ ...base, username: 'localadmin', winrmAuth: 'ntlm' })
    ).toThrow('DOMAIN');
  });

  it('blocks Basic authentication over unencrypted HTTP', () => {
    expect(() =>
      getWinrmConnectionSettings({
        ...base,
        username: 'localadmin',
        winrmAuth: 'basic',
        winrmTransport: 'http',
      })
    ).toThrow('requires HTTPS');
  });

  it('passes HTTPS and auth-compatible credentials to the maintained client', async () => {
    mock.runPowershell.mockResolvedValueOnce('[{"CookedValue":12,"InstanceName":"_Total"}]');
    const result = await diagnoseWinrm(
      { ...base, port: 5986, winrmTransport: 'https', winrmAuth: 'ntlm' },
      'cpu_health'
    );
    expect(mock.runPowershell).toHaveBeenCalledWith(
      expect.any(String),
      'server.test',
      'CONTOSO\\svc',
      'fixture',
      5986,
      true,
      true
    );
    expect(result.metrics[0]).toMatchObject({
      name: 'CPU utilization',
      value: 12,
      unit: '%',
      status: 'ok',
    });
  });

  it('uses the native Windows ticket path for Kerberos and gives a safe cross-platform error', async () => {
    await expect(diagnoseWinrm({ ...base, winrmAuth: 'kerberos' }, 'os_health')).rejects.toThrow(
      'requires a Windows V-Coworker host'
    );
    expect(mock.runPowershell).not.toHaveBeenCalled();
  });

  it('supports expert service, process, storage and security categories', async () => {
    mock.runPowershell
      .mockResolvedValueOnce('[{"Name":"Spooler","Status":1}]')
      .mockResolvedValueOnce('[{"ProcessName":"sqlservr","CPU":20}]')
      .mockResolvedValueOnce('[{"DeviceID":"C:","Size":100,"FreeSpace":10}]')
      .mockResolvedValueOnce('[{"AMServiceEnabled":true,"AntivirusEnabled":true}]');
    expect((await diagnoseWinrm(base, 'service_health')).metrics[0]).toMatchObject({
      name: 'Non-running services',
      value: 1,
    });
    expect((await diagnoseWinrm(base, 'process_health')).metrics[0]).toMatchObject({
      name: 'Top process sample rows',
      value: 1,
    });
    expect((await diagnoseWinrm(base, 'storage_health')).metrics[0]).toMatchObject({
      name: 'Storage usage (C:)',
      value: 90,
      status: 'critical',
    });
    expect((await diagnoseWinrm(base, 'security_health')).metrics[0]).toMatchObject({
      name: 'Diagnostic output length',
      status: 'ok',
    });
  });
});
