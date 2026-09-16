import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Infra RCA Windows bootstrap', () => {
  const script = readFileSync(
    resolve(process.cwd(), 'resources/windows/Infra-RCA-Windows-Bootstrap.ps1'),
    'utf8'
  );

  it('is administrator guarded and idempotently configures SSH and WinRM', () => {
    expect(script).toContain('WindowsBuiltInRole]::Administrator');
    expect(script).toContain('OpenSSH.Server~~~~0.0.1.0');
    expect(script).toContain('Set-Service -Name sshd -StartupType Automatic');
    expect(script).toContain("Ensure-FirewallRule -Name 'OpenSSH-Server-In-TCP'");
    expect(script).toContain('Set-Service -Name WinRM -StartupType Automatic');
    expect(script).toContain('Enable-PSRemoting -Force');
  });

  it('supports approved HTTPS certificate provisioning and verifies both transports', () => {
    expect(script).toContain('Server Authentication certificate');
    expect(script).toContain('New-Item -Path WSMan:\\localhost\\Listener -Transport HTTPS');
    expect(script).toContain('Test-WSMan -ComputerName localhost -UseSSL');
    expect(script).toContain('RemoteAddress $RemoteAddress');
  });
});
