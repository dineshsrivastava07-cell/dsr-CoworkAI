/**
 * Shared types for RemoteControlPanel sub-components
 */

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: string;
  pairedAt: number;
  lastActiveAt: number;
}

export interface PairingRequest {
  code: string;
  channelType: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    indianVnc?: IndianVncConfig;
    tunnel?: {
      enabled: boolean;
      type: 'ngrok' | 'cloudflare' | 'frp';
      ngrok?: {
        authToken: string;
        region?: string;
      };
    };
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    slack?: Record<string, unknown>;
  };
}

export interface IndianVncConfig {
  enabled: boolean;
  provider: 'zoho-assist' | 'manageengine-remote-access-plus';
  portalUrl?: string;
  organizationId?: string;
  operatorEmail?: string;
  accessMode: 'attended' | 'unattended';
  requireUserConsent: boolean;
  auditLogging: boolean;
}

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

export type ConfigStep = 'indianVnc' | 'connection' | 'advanced';

export type LocalizedBanner = { key?: string; text?: string | null };
