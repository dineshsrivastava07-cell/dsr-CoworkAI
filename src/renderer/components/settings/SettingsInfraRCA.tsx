import { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Server,
  Trash2,
} from 'lucide-react';
import type {
  InfraRcaProtocol,
  InfraRcaTargetInput,
  InfraRcaTargetPublic,
  InfraRcaConnectionResult,
} from '../../../shared/ipc-types';
import type { MCPServerConfig, MCPServerStatus } from './shared';
import { InfraBulkImport } from './InfraBulkImport';
import { InfraConnectionResult } from './InfraConnectionResult';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const PROTOCOL_LABELS: Record<InfraRcaProtocol, string> = {
  ssh: 'SSH (Linux/Unix)',
  winrm: 'WinRM (Windows, advanced)',
  snmp: 'SNMP (network gear/printers/UPS)',
  db: 'Database (Postgres/MySQL)',
};

const emptyForm: InfraRcaTargetInput = {
  name: '',
  protocol: 'ssh',
  host: '',
  port: undefined,
  username: '',
  secret: '',
  dbEngine: 'postgres',
  dbName: '',
  community: '',
  winrmTransport: 'https',
  winrmAuth: 'auto',
  winrmRejectUnauthorized: true,
  remoteDesktop: 'vnc',
};

export function SettingsInfraRCA({
  isActive,
  connector,
  connectorStatus,
  connectorBusy,
  onToggleConnector,
}: {
  isActive: boolean;
  connector?: MCPServerConfig;
  connectorStatus?: MCPServerStatus;
  connectorBusy?: boolean;
  onToggleConnector?: () => void;
}) {
  const [targets, setTargets] = useState<InfraRcaTargetPublic[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<InfraRcaTargetInput>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [remoteId, setRemoteId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, InfraRcaConnectionResult>>({});
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filteredTargets = targets.filter((target) =>
    `${target.name} ${target.host} ${target.protocol} ${target.group || ''}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const lastPage = Math.max(0, Math.ceil(filteredTargets.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);

  const loadTargets = useCallback(async () => {
    if (!isElectron) return;
    try {
      const loaded = await window.electronAPI.infraRca.listTargets();
      setTargets(loaded);
    } catch (err) {
      console.error('Failed to load Infra RCA targets:', err);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadTargets();
  }, [isActive, loadTargets]);

  async function handleSaveTarget() {
    setError('');
    if (!form.name.trim() || !form.host.trim()) {
      setError('Name and host are required.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await window.electronAPI.infraRca.saveTarget(form);
      if (!result.success) {
        setError(result.error || 'Failed to save target.');
        return;
      }
      setForm(emptyForm);
      setShowAddForm(false);
      await loadTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save target.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await window.electronAPI.infraRca.deleteTarget(id);
      await loadTargets();
    } catch (err) {
      console.error('Failed to delete target:', err);
    }
  }

  async function handleOpenNativeRemote(target: InfraRcaTargetPublic) {
    setError('');
    setRemoteId(target.id);
    try {
      const result = await window.electronAPI.infraRca.openNativeRemote(target.id);
      if (!result.launched) setError(result.error || 'Native remote desktop could not be opened.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Native remote desktop could not be opened.');
    } finally {
      setRemoteId(null);
    }
  }

  function handleEdit(target: InfraRcaTargetPublic) {
    setError('');
    setForm({
      ...emptyForm,
      id: target.id,
      name: target.name,
      protocol: target.protocol,
      host: target.host,
      port: target.port,
      group: target.group || '',
      winrmTransport: target.winrmTransport || 'https',
      winrmAuth: target.winrmAuth || 'auto',
      winrmRejectUnauthorized: target.winrmRejectUnauthorized !== false,
      remoteDesktop: target.remoteDesktop || (target.protocol === 'winrm' ? 'rdp' : 'vnc'),
      remotePort: target.remotePort,
    });
    setShowAddForm(true);
  }

  async function handleTestConnection(id: string) {
    setTestingId(id);
    try {
      const result = await window.electronAPI.infraRca.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { reachable: false, error: err instanceof Error ? err.message : 'Test failed.' },
      }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Server className="w-4 h-4 text-text-secondary" />
          <div className="text-left">
            <div className="font-medium text-text-primary text-sm">Infra RCA</div>
            <div className="text-xs text-text-muted">
              Remote diagnostics for servers, network gear, printers, UPS, and databases
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {targets.length > 0 && (
            <span className="text-xs text-text-muted px-2 py-0.5 rounded-md bg-surface-muted">
              {targets.length} target{targets.length === 1 ? '' : 's'}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <div className="flex items-center justify-between gap-3 px-4 pb-3 text-xs text-text-secondary">
        <span role="status">
          {!connector?.enabled
            ? 'Disabled'
            : connectorStatus?.status === 'connected'
              ? `Connected · ${connectorStatus.toolCount} tools`
              : connectorStatus?.status === 'failed'
                ? 'Connection failed'
                : 'Enabled · connecting / not connected'}
        </span>
        <button
          type="button"
          disabled={connectorBusy || !connector}
          onClick={onToggleConnector}
          className="px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50"
        >
          {connectorBusy
            ? 'Working…'
            : connector?.enabled
              ? 'Disable Infra RCA'
              : 'Enable Infra RCA'}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border-subtle pt-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <p className="text-xs text-text-muted">
            Configure targets here, then request diagnostics in chat. Any proposed fix requires your
            explicit approval in the conversation before it executes — nothing here is ever
            auto-applied.
          </p>

          <InfraBulkImport onImported={loadTargets} />
          <label className="block text-xs text-text-secondary">
            Search systems by name, host, protocol or group
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="w-full mt-1 px-3 py-2 rounded bg-background border border-border text-text-primary"
            />
          </label>
          <div className="flex justify-between items-center text-xs text-text-secondary">
            <span>
              {filteredTargets.length} matching systems · page {currentPage + 1} of {lastPage + 1}
            </span>
            <div className="flex gap-2">
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                Previous
              </button>
              <button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>
                Next
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {filteredTargets.slice(currentPage * 50, (currentPage + 1) * 50).map((target) => {
              const testResult = testResults[target.id];
              return (
                <div
                  key={target.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-primary">{target.name}</div>
                    <div className="text-xs text-text-muted">
                      {PROTOCOL_LABELS[target.protocol]} · {target.host}{' '}
                      {target.port ? `:${target.port} ` : ''}
                      {target.group ? `· ${target.group}` : ''}
                      {target.protocol === 'winrm'
                        ? ` · ${(target.winrmAuth || 'auto').toUpperCase()} / ${(target.winrmTransport || 'http').toUpperCase()}`
                        : ''}
                    </div>
                    {testResult && (
                      <InfraConnectionResult result={testResult} protocol={target.protocol} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-start ml-2">
                    <button
                      onClick={() => handleTestConnection(target.id)}
                      disabled={testingId === target.id}
                      className="text-xs px-2 py-1 rounded-md bg-surface-muted hover:bg-surface-active text-text-secondary disabled:opacity-50"
                    >
                      {testingId === target.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </button>
                    {target.protocol !== 'snmp' && target.protocol !== 'db' && (
                      <button
                        onClick={() => void handleOpenNativeRemote(target)}
                        disabled={remoteId === target.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-surface-muted hover:bg-surface-active text-text-secondary disabled:opacity-50"
                        title="Open the operating system's native RDP or VNC client"
                      >
                        {remoteId === target.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Monitor className="w-3 h-3" />
                        )}
                        Remote
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(target)}
                      className="p-1 rounded-md hover:bg-surface-active text-text-muted hover:text-text-primary"
                      aria-label={`Edit ${target.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(target.id)}
                      className="p-1 rounded-md hover:bg-error/10 text-text-muted hover:text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {showAddForm ? (
            <div className="space-y-3 pt-2 border-t border-border-subtle">
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="prod-web-01"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">Protocol</label>
                <select
                  value={form.protocol}
                  disabled={Boolean(form.id)}
                  onChange={(e) =>
                    setForm({ ...form, protocol: e.target.value as InfraRcaProtocol })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">Host</label>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="10.0.0.5"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1">
                  Port (optional)
                </label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, port: e.target.value ? Number(e.target.value) : undefined })
                  }
                  placeholder={
                    form.protocol === 'winrm'
                      ? form.winrmTransport === 'https'
                        ? '5986'
                        : '5985'
                      : 'Protocol default'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              {form.protocol === 'snmp' ? (
                <div>
                  <label className="block text-xs font-medium text-text-primary mb-1">
                    SNMP community string
                  </label>
                  <input
                    type="text"
                    value={form.community}
                    onChange={(e) => setForm({ ...form, community: e.target.value })}
                    placeholder="public"
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-text-primary">
                      Native remote
                      <select
                        value={form.remoteDesktop || (form.protocol === 'winrm' ? 'rdp' : 'vnc')}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            remoteDesktop: e.target.value as InfraRcaTargetInput['remoteDesktop'],
                            remotePort: undefined,
                          })
                        }
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm"
                      >
                        <option value="rdp">RDP</option>
                        <option value="vnc">VNC / Screen Sharing</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium text-text-primary">
                      Remote port
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={form.remotePort ?? ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            remotePort: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder={form.remoteDesktop === 'rdp' ? '3389' : '5900'}
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-primary mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-primary mb-1">
                      Password{' '}
                      {form.protocol === 'ssh'
                        ? '(or leave blank if using a key)'
                        : form.protocol === 'winrm' && form.winrmAuth === 'kerberos'
                          ? '(not used; current Windows ticket is used)'
                          : form.id
                            ? '(leave blank to keep the existing encrypted password)'
                            : ''}
                    </label>
                    <input
                      type="password"
                      value={form.secret}
                      onChange={(e) => setForm({ ...form, secret: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                  {form.protocol === 'winrm' && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-text-primary">
                        Authentication
                        <select
                          value={form.winrmAuth || 'auto'}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              winrmAuth: e.target.value as InfraRcaTargetInput['winrmAuth'],
                              ...(e.target.value === 'basic'
                                ? { winrmTransport: 'https', port: undefined }
                                : {}),
                            })
                          }
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm"
                        >
                          <option value="auto">Auto (local Basic / domain NTLM)</option>
                          <option value="basic">Basic</option>
                          <option value="ntlm">NTLM</option>
                          <option value="kerberos">Kerberos (Windows domain ticket)</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-text-primary">
                        Transport
                        <select
                          value={form.winrmTransport || 'http'}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              winrmTransport: e.target
                                .value as InfraRcaTargetInput['winrmTransport'],
                              port: undefined,
                            })
                          }
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm"
                        >
                          <option value="http" disabled={form.winrmAuth === 'basic'}>
                            HTTP · 5985
                          </option>
                          <option value="https">HTTPS · 5986</option>
                        </select>
                      </label>
                      <label className="col-span-2 flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={form.winrmRejectUnauthorized !== false}
                          onChange={(e) =>
                            setForm({ ...form, winrmRejectUnauthorized: e.target.checked })
                          }
                        />
                        Verify the HTTPS certificate (recommended; disable only for an approved test
                        certificate)
                      </label>
                      <p className="col-span-2 text-xs text-text-muted">
                        NTLM requires DOMAIN\\user or user@domain. Kerberos uses the logged-in
                        Windows domain ticket and is unavailable from macOS/Linux. Basic is allowed
                        only over HTTPS; selecting Basic automatically selects HTTPS.
                      </p>
                    </div>
                  )}
                </>
              )}
              {form.protocol === 'db' && (
                <div>
                  <label className="block text-xs font-medium text-text-primary mb-1">
                    Database engine
                  </label>
                  <select
                    value={form.dbEngine}
                    onChange={(e) =>
                      setForm({ ...form, dbEngine: e.target.value as 'postgres' | 'mysql' })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveTarget}
                  disabled={isSaving}
                  className="flex-1 py-2 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {form.id ? 'Update target' : 'Save target'}
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setForm(emptyForm);
                  }}
                  className="py-2 px-4 rounded-lg bg-surface-muted text-text-secondary text-sm font-medium hover:bg-surface-active transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2 px-4 rounded-lg bg-surface-muted text-text-primary text-sm font-medium hover:bg-surface-active transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add target
            </button>
          )}
        </div>
      )}
    </div>
  );
}
