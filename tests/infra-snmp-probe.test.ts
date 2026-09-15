import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn(), close: vi.fn(), createSession: vi.fn() }));
vi.mock('net-snmp', () => ({
  Version2c: 1,
  createSession: mock.createSession,
  isVarbindError: (value: { type?: string }) => value.type === 'error',
}));
import { probeSnmp } from '../src/main/mcp/infra-drivers/snmp-driver';
const target = {
  id: 'switch',
  name: 'switch',
  protocol: 'snmp' as const,
  host: 'switch.test',
  community: 'fixture-community',
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.createSession.mockReturnValue({ get: mock.get, close: mock.close });
});
describe('SNMP connection probe', () => {
  it('uses a read-only SNMP request with the configured community and closes the session', async () => {
    mock.get.mockImplementation((_oids, callback) => callback(null, [{ value: 'Test switch' }]));
    await probeSnmp(target);
    expect(mock.createSession).toHaveBeenCalledWith(
      'switch.test',
      'fixture-community',
      expect.objectContaining({ port: 161, version: 1 })
    );
    expect(mock.get).toHaveBeenCalledWith(['1.3.6.1.2.1.1.1.0'], expect.any(Function));
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('rejects protocol errors instead of reporting reachable', async () => {
    mock.get.mockImplementation((_oids, callback) => callback(null, [{ type: 'error' }]));
    await expect(probeSnmp(target)).rejects.toThrow('did not return');
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('closes the session when the network request fails', async () => {
    mock.get.mockImplementation((_oids, callback) => callback(new Error('Timeout')));
    await expect(probeSnmp(target)).rejects.toThrow('Timeout');
    expect(mock.close).toHaveBeenCalledOnce();
  });
});
