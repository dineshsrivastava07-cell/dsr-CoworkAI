import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Loader2, Plus, Server, Trash2 } from 'lucide-react';
import type {
  InfraRcaProtocol,
  InfraRcaTargetInput,
  InfraRcaTargetPublic,
} from '../../../shared/ipc-types';
import type { MCPServerConfig, MCPServerStatus } from './shared';
import { InfraBulkImport } from './InfraBulkImport';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const PROTOCOL_LABELS: Record<InfraRcaProtocol, string> = {
  ssh: 'SSH (Linux/Unix)',
  winrm: 'WinRM (Windows, best-effort)',
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
  const [testResults, setTestResults] = useState<
    Record<string, { reachable: boolean; error?: string; latencyMs?: number }>
  >({});
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
                  <div>
                    <div className="text-sm font-medium text-text-primary">{target.name}</div>
                    <div className="text-xs text-text-muted">
                      {PROTOCOL_LABELS[target.protocol]} · {target.host}{' '}
                      {target.group ? `· ${target.group}` : ''}
                    </div>
                    {testResult && (
                      <div
                        className={`text-xs mt-1 flex items-center gap-1 ${testResult.reachable ? 'text-success' : 'text-error'}`}
                      >
                        {testResult.reachable ? (
                          <>
                            <CheckCircle className="w-3 h-3" />{' '}
                            {target.protocol === 'snmp'
                              ? 'SNMP responded'
                              : 'TCP reachable (login not tested)'}{' '}
                            ({testResult.latencyMs}ms)
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3" /> {testResult.error || 'Unreachable'}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
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
                      Password {form.protocol === 'ssh' ? '(or leave blank if using a key)' : ''}
                    </label>
                    <input
                      type="password"
                      value={form.secret}
                      onChange={(e) => setForm({ ...form, secret: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
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
                  Save target
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
