import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, Socket } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkInfraConnection,
  describeInfraConnectionFailure,
} from '../src/main/mcp/infra-connection-check';
import { InfraConnectionResult } from '../src/renderer/components/settings/InfraConnectionResult';

const snmp = vi.hoisted(() => ({ probe: vi.fn() }));
const winrm = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('../src/main/mcp/infra-drivers/snmp-driver', () => ({ probeSnmp: snmp.probe }));
vi.mock('../src/main/mcp/infra-drivers/winrm-driver', () => ({ probeWinrm: winrm.probe }));
const target = {
  id: 'qa',
  name: 'qa-windows',
  host: '127.0.0.1',
  protocol: 'winrm' as const,
  secret: 'fixture-secret',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  snmp.probe.mockReset();
  winrm.probe.mockReset();
});

describe('Infra RCA connection diagnostics', () => {
  it.each(['EHOSTDOWN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'])(
    'explains %s without asserting the computer is offline',
    (code) => {
      const result = describeInfraConnectionFailure({ code }, target);
      expect(result).toMatchObject({ reachable: false, check: 'tcp', port: 5985, errorCode: code });
      expect(result.nextSteps?.join(' ')).toContain('does not prove');
      expect(result.localChecks).toContain('Get-Service WinRM');
    }
  );

  it('explains refusal and renders the Windows instructions without credentials', () => {
    const result = describeInfraConnectionFailure(
      new Error('connect ECONNREFUSED fixture-secret'),
      target
    );
    expect(result.error).toContain('before login');
    expect(result.nextSteps?.join(' ')).toContain('listening');
    const html = renderToStaticMarkup(
      createElement(InfraConnectionResult, { result, protocol: 'winrm' })
    );
    expect(html).toContain('ECONNREFUSED');
    expect(html).toContain('Windows IT checks (read-only)');
    expect(html).toContain('winrm enumerate winrm/config/listener');
    expect(html).toContain('automatic local Basic/domain NTLM selection');
    expect(html).not.toContain('fixture-secret');
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN', 'EPERM', 'EACCES'])(
    'classifies %s separately from login failures',
    (code) => {
      const result = describeInfraConnectionFailure({ code }, { ...target, protocol: 'ssh' });
      expect(result.errorCode).toBe(code);
      expect(result.localChecks).toBeUndefined();
      expect(result.port).toBe(22);
    }
  );

  it('does not return unclassified driver text', () => {
    const result = describeInfraConnectionFailure(new Error('secret=fixture-secret'), target);
    expect(result.errorCode).toBe('CONNECTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  });

  it('uses the configured custom port in the read-only checks', () => {
    const result = describeInfraConnectionFailure(
      { code: 'ECONNREFUSED' },
      { ...target, port: 12345 }
    );
    expect(result.port).toBe(12345);
    expect(result.localChecks?.join('\n')).toContain('-LocalPort 12345');
  });

  it('defaults WinRM HTTPS targets to the standard 5986 listener', () => {
    const result = describeInfraConnectionFailure(
      { code: 'ECONNREFUSED' },
      { ...target, winrmTransport: 'https' }
    );
    expect(result.port).toBe(5986);
    expect(result.localChecks?.join('\n')).toContain('-LocalPort 5986');
    expect(result.limitation).toContain('over HTTPS');
    expect(result.localChecks?.join('\n')).toContain('Cert:\\LocalMachine\\My');
    expect(result.localChecks).toContain('Get-Service sshd -ErrorAction SilentlyContinue');
  });

  it('connects to a real TCP listener and detects refusal after that listener closes', async () => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
    const endpoint = { ...target, port: address.port };
    try {
      const result = await checkInfraConnection(endpoint);
      expect(result).toMatchObject({ reachable: true, check: 'tcp', port: address.port });
      expect(result.nextSteps?.join(' ')).toContain('have not been tested');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
    const refused = await checkInfraConnection(endpoint);
    expect(refused).toMatchObject({ reachable: false, errorCode: 'ECONNREFUSED' });
  });

  it('runs the authenticated read-only WinRM probe after the configured listener answers', async () => {
    const configuredPort = 61234;
    winrm.probe.mockResolvedValueOnce(undefined);
    const result = await checkInfraConnection(
      { ...target, port: configuredPort, winrmTransport: 'https' },
      250,
      {
        advancedWinrm: true,
        verifyLogin: true,
        inspectNetworkPath: async () => ({
          interface: 'test0',
          sourceAddress: '127.0.0.1',
          vpnInterface: false,
          summary: 'test route',
        }),
        probeTcp: async (_host, port, service) => ({
          port,
          service,
          reachable: port === configuredPort,
          ...(port === configuredPort ? { latencyMs: 1 } : { errorCode: 'ECONNREFUSED' }),
        }),
      }
    );
    expect(result).toMatchObject({
      reachable: true,
      authenticated: true,
      check: 'winrm',
      stage: 'ready',
      port: configuredPort,
    });
    expect(result.probes).toEqual(
      expect.arrayContaining([expect.objectContaining({ port: configuredPort, reachable: true })])
    );
    expect(winrm.probe).toHaveBeenCalledOnce();
  });

  it('distinguishes a reachable Windows host from a missing WinRM listener', async () => {
    const result = await checkInfraConnection({ ...target, winrmTransport: 'https' }, 250, {
      advancedWinrm: true,
      inspectNetworkPath: async () => ({
        interface: 'en0',
        sourceAddress: '127.0.0.1',
        vpnInterface: false,
        summary: 'direct test route',
      }),
      probeTcp: async (_host, port, service) => ({
        port,
        service,
        reachable: port === 135,
        ...(port === 135 ? { latencyMs: 1 } : { errorCode: 'ECONNREFUSED' }),
      }),
    });
    expect(result).toMatchObject({
      reachable: false,
      check: 'winrm',
      stage: 'host',
      errorCode: 'WINRM_LISTENER_UNAVAILABLE',
    });
    expect(result.error).toContain('Windows host is reachable');
    expect(result.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: 5985, reachable: false }),
        expect.objectContaining({ port: 5986, reachable: false }),
      ])
    );
    expect(result.remediationCommands).toContain('Enable-PSRemoting -Force');
    expect(result.remediationCommands).toContain(
      'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0'
    );
    expect(result.remediationCommands?.join('\n')).toContain('winrm quickconfig -transport:https');
  });

  it('times out a stalled socket and destroys it without leaving a timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
      return this;
    });
    const destroy = vi.spyOn(Socket.prototype, 'destroy');
    const resultPromise = checkInfraConnection(target, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await resultPromise).toMatchObject({ reachable: false, errorCode: 'ETIMEDOUT' });
    expect(destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses SNMP, not TCP, for a network device and masks community errors', async () => {
    const connect = vi.spyOn(Socket.prototype, 'connect');
    const device = { ...target, protocol: 'snmp' as const, community: 'fixture-community' };
    snmp.probe.mockResolvedValueOnce(undefined);
    expect(await checkInfraConnection(device)).toMatchObject({
      reachable: true,
      check: 'snmp',
      port: 161,
    });
    expect(snmp.probe).toHaveBeenCalledWith(device);
    snmp.probe.mockRejectedValueOnce(new Error('fixture-community denied'));
    const result = await checkInfraConnection(device);
    expect(result).toMatchObject({
      reachable: false,
      check: 'snmp',
      errorCode: 'SNMP_PROBE_FAILED',
    });
    expect(JSON.stringify(result)).not.toContain('fixture-community');
    expect(connect).not.toHaveBeenCalled();
  });
});
