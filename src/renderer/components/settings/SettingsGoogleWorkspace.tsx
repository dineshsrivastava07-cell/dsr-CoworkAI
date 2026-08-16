import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Loader2, Mail } from 'lucide-react';

interface GoogleConnectionStatus {
  connected: boolean;
  accountEmail: string | null;
  needsReconnect: boolean;
  lastErrorMessage: string | null;
  hasClientCredentials: boolean;
  credentialsAreBundled: boolean;
}

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function SettingsGoogleWorkspace({ isActive }: { isActive: boolean }) {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    if (!isElectron) return;
    try {
      const loaded = await window.electronAPI.google.getStatus();
      setStatus(loaded);
    } catch (err) {
      console.error('Failed to load Google connection status:', err);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadStatus();
  }, [isActive, loadStatus]);

  async function handleSaveCredentials() {
    setError('');
    setIsSavingCredentials(true);
    try {
      const result = await window.electronAPI.google.saveClientCredentials({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      if (!result.success) {
        setError(result.error || 'Failed to save credentials.');
        return;
      }
      setClientId('');
      setClientSecret('');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials.');
    } finally {
      setIsSavingCredentials(false);
    }
  }

  async function handleConnect() {
    setError('');
    setIsConnecting(true);
    try {
      const result = await window.electronAPI.google.connectAccount();
      if (!result.success) {
        setError(result.error || 'Failed to connect Google account.');
        return;
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google account.');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    setError('');
    setIsDisconnecting(true);
    try {
      await window.electronAPI.google.disconnectAccount();
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google account.');
    } finally {
      setIsDisconnecting(false);
    }
  }

  const connected = status?.connected ?? false;
  const needsReconnect = status?.needsReconnect ?? false;
  const hasClientCredentials = status?.hasClientCredentials ?? false;
  const credentialsAreBundled = status?.credentialsAreBundled ?? false;

  // When credentials are bundled (set via env vars) we show a one-click
  // "Sign in with Google" experience. The manual credential form is only
  // shown for self-hosted / bring-your-own-OAuth setups.
  const showCredentialForm = !credentialsAreBundled;

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Mail className="w-4 h-4 text-text-secondary" />
          <div className="text-left">
            <div className="font-medium text-text-primary text-sm">Google Workspace</div>
            <div className="text-xs text-text-muted">
              Read-only access to Gmail, Drive (Docs/Sheets/Slides/PDFs), and Calendar
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected && !needsReconnect && (
            <span className="flex items-center gap-1 text-xs text-success px-2 py-0.5 rounded-md bg-success/10">
              <CheckCircle className="w-3.5 h-3.5" />
              {status?.accountEmail}
            </span>
          )}
          {needsReconnect && (
            <span className="flex items-center gap-1 text-xs text-warning px-2 py-0.5 rounded-md bg-warning/10">
              <AlertCircle className="w-3.5 h-3.5" />
              Needs reconnect
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border-subtle pt-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {status?.lastErrorMessage && needsReconnect && (
            <div className="text-xs text-text-muted">Last error: {status.lastErrorMessage}</div>
          )}

          {/* Manual credential form — hidden when credentials are bundled via env vars */}
          {showCredentialForm && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  OAuth Client ID
                </label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={
                    hasClientCredentials
                      ? '•••••• (saved — re-enter to change)'
                      : 'xxxxx.apps.googleusercontent.com'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  OAuth Client Secret
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={
                    hasClientCredentials ? '•••••• (saved — re-enter to change)' : 'GOCSPX-...'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <button
                onClick={handleSaveCredentials}
                disabled={isSavingCredentials || !clientId.trim() || !clientSecret.trim()}
                className="w-full py-2 px-4 rounded-lg bg-surface-muted text-text-primary text-sm font-medium hover:bg-surface-active disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isSavingCredentials ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save credentials
              </button>
            </>
          )}

          <div className={showCredentialForm ? 'pt-2 border-t border-border-subtle' : undefined}>
            {connected ? (
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="w-full py-2 px-4 rounded-lg bg-error/10 text-error text-sm font-medium hover:bg-error/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Disconnect Google account
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={isConnecting || !hasClientCredentials}
                className="w-full py-2 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isConnecting
                  ? 'Waiting for browser authorization…'
                  : needsReconnect
                    ? 'Reconnect Google account'
                    : 'Sign in with Google'}
              </button>
            )}
            {!hasClientCredentials && !connected && showCredentialForm && (
              <p className="text-xs text-text-muted mt-2">
                Save your Client ID and Client Secret first — see Google Cloud Console setup
                instructions in the docs.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
