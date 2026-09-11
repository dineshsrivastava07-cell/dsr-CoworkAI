import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Loader2, Plus, Server, Trash2 } from 'lucide-react';
import type {
  InfraRcaProtocol,
  InfraRcaTargetInput,
  InfraRcaTargetPublic,
} from '../../../shared/ipc-types';

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

export function SettingsInfraRCA({ isActive }: { isActive: boolean }) {
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

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border-subtle pt-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <p className="text-xs text-text-muted">
            Diagnostics (health checks) run automatically. Any proposed fix always requires your
            explicit approval in the conversation before it executes — nothing here is ever
            auto-applied.
          </p>

          <div className="space-y-2">
            {targets.map((target) => {
              const testResult = testResults[target.id];
              return (
                <div
                  key={target.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border-subtle"
                >
                  <div>
                    <div className="text-sm font-medium text-text-primary">{target.name}</div>
                    <div className="text-xs text-text-muted">
                      {PROTOCOL_LABELS[target.protocol]} · {target.host}
                    </div>
                    {testResult && (
                      <div
                        className={`text-xs mt-1 flex items-center gap-1 ${testResult.reachable ? 'text-success' : 'text-error'}`}
                      >
                        {testResult.reachable ? (
                          <>
                            <CheckCircle className="w-3 h-3" /> Reachable ({testResult.latencyMs}ms)
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
