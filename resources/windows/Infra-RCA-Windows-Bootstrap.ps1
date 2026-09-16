<#
  Infra RCA Windows bootstrap
  Run in an elevated PowerShell window on the target or through approved endpoint management.
  This script changes services, listeners and firewall rules. Review the organization's
  remote-management policy before deployment.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$ConfigureHttps,
  [string]$CertificateThumbprint,
  [string]$RemoteAddress = 'LocalSubnet'
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell window.'
}

function Ensure-FirewallRule {
  param([string]$Name, [string]$DisplayName, [int]$Port)
  $rule = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if (-not $rule) {
    New-NetFirewallRule -Name $Name -DisplayName $DisplayName -Enabled True -Direction Inbound `
      -Profile Domain,Private -Action Allow -Protocol TCP -LocalPort $Port `
      -RemoteAddress $RemoteAddress | Out-Null
  } else {
    Enable-NetFirewallRule -Name $Name | Out-Null
    Set-NetFirewallRule -Name $Name -Profile Domain,Private -RemoteAddress $RemoteAddress
  }
}

if ($PSCmdlet.ShouldProcess('Windows target', 'Install and start OpenSSH Server')) {
  $sshCapability = Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  if ($sshCapability.State -ne 'Installed') {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Host
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service -Name sshd
  Ensure-FirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Port 22
}

if ($PSCmdlet.ShouldProcess('Windows target', 'Enable WinRM service and remoting')) {
  Set-Service -Name WinRM -StartupType Automatic
  Start-Service -Name WinRM
  Enable-PSRemoting -Force
}

if ($ConfigureHttps) {
  if (-not $CertificateThumbprint) {
    $hostNames = @([System.Net.Dns]::GetHostName(), $env:COMPUTERNAME)
    $certificate = Get-ChildItem Cert:\LocalMachine\My |
      Where-Object {
        $_.HasPrivateKey -and
        $_.NotAfter -gt (Get-Date) -and
        ($_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1') -and
        ($_.DnsNameList.Unicode -match ($hostNames -join '|'))
      } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1
    if (-not $certificate) {
      throw 'No valid Server Authentication certificate matching the target hostname was found. Install an approved certificate or pass -CertificateThumbprint.'
    }
    $CertificateThumbprint = $certificate.Thumbprint
  }
  if ($PSCmdlet.ShouldProcess('WinRM HTTPS listener', "Create listener with certificate $CertificateThumbprint")) {
    $listener = Get-ChildItem WSMan:\localhost\Listener -ErrorAction SilentlyContinue |
      Where-Object { $_.Keys -match 'Transport=HTTPS' }
    if (-not $listener) {
      New-Item -Path WSMan:\localhost\Listener -Transport HTTPS -Address * `
        -CertificateThumbprint $CertificateThumbprint -Force | Out-Null
    }
    Ensure-FirewallRule -Name 'WINRM-HTTPS-In-TCP' -DisplayName 'Windows Remote Management (HTTPS-In)' -Port 5986
  }
} else {
  Ensure-FirewallRule -Name 'WINRM-HTTP-In-TCP' -DisplayName 'Windows Remote Management (HTTP-In)' -Port 5985
}

Write-Host '--- Infra RCA bootstrap verification ---'
Get-Service sshd,WinRM | Select-Object Name,Status,StartType | Format-Table
Get-NetTCPConnection -State Listen -LocalPort 22,5985,5986 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table
winrm enumerate winrm/config/listener
Test-WSMan -ComputerName localhost
if ($ConfigureHttps) { Test-WSMan -ComputerName localhost -UseSSL }
Test-NetConnection -ComputerName localhost -Port 22
