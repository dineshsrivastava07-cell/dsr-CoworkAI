import { describe, expect, it } from 'vitest';
import { parseLinuxRouteOutput, parseMacRouteOutput } from '../src/main/mcp/infra-network-path';

describe('Infra RCA network path parsing', () => {
  it('parses a direct macOS same-subnet route without inventing a gateway', () => {
    expect(
      parseMacRouteOutput(`
   route to: 10.100.6.82
destination: 10.100.6.82
  interface: en0
      flags: <UP,HOST,DONE,LLINFO>
`)
    ).toEqual({ interface: 'en0', gateway: undefined });
  });

  it('parses a macOS routed path through a gateway', () => {
    expect(
      parseMacRouteOutput(`
   route to: 10.100.6.82
destination: 10.100.6.82
    gateway: 192.168.2.1
  interface: en0
`)
    ).toEqual({ interface: 'en0', gateway: '192.168.2.1' });
  });

  it('parses Linux interface, gateway and selected source address', () => {
    expect(
      parseLinuxRouteOutput('10.100.6.82 via 10.10.0.1 dev tun0 src 10.10.0.24 uid 1000')
    ).toEqual({ interface: 'tun0', gateway: '10.10.0.1', sourceAddress: '10.10.0.24' });
  });
});
