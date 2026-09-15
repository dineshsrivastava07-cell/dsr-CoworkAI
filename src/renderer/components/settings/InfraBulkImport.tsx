import { useState } from 'react';
import type { InfraRcaImportInput, InfraRcaImportResult } from '../../../shared/ipc-types';

const template =
  'name,protocol,host,port,username,group,dbEngine,dbName,winrmTransport,winrmAuth,winrmRejectUnauthorized\nprod-web-01,ssh,10.0.0.10,22,svc_diagnostics,Production,,,,\nprod-win-01,winrm,10.0.0.20,5986,DOMAIN\\svc_diagnostics,Production,,,https,ntlm,true\n';
const inputClass =
  'w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm';

export function InfraBulkImport({ onImported }: { onImported: () => Promise<void> }) {
  const [input, setInput] = useState<InfraRcaImportInput>({
    format: 'csv',
    content: '',
    duplicates: 'skip',
    defaults: { protocol: 'ssh' },
  });
  const [preview, setPreview] = useState<InfraRcaImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function change(next: InfraRcaImportInput) {
    setInput(next);
    setPreview(null);
    setMessage('');
    setError('');
  }
  function shared(key: string, value: string) {
    change({ ...input, defaults: { ...input.defaults, [key]: value } });
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([template], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'infra-targets-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function check(commit: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await (commit
        ? window.electronAPI.infraRca.importTargets(input)
        : window.electronAPI.infraRca.previewImport(input));
      setPreview(result);
      if (result.error) setError(result.error);
      if (commit && result.success) {
        setMessage(
          `Imported: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`
        );
        setInput({ format: 'csv', content: '', duplicates: 'skip', defaults: { protocol: 'ssh' } });
        setPreview(null);
        await onImported();
      }
    } catch {
      setError('Import could not be completed. Check the saved target list before retrying.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-lg border border-border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">
        Bulk import systems (CSV / JSON)
      </summary>
      <fieldset disabled={busy} className="space-y-3 mt-3 disabled:opacity-60">
        <p className="text-xs text-text-muted">
          Import up to 10,000 systems per batch (5 MB). Export Excel inventories as CSV UTF-8.
          Credentials can be supplied once for this batch; non-empty row values take precedence.
          Import one credential group at a time.
        </p>
        <button type="button" onClick={downloadTemplate} className="text-sm text-accent">
          Download CSV template
        </button>
        <label className="block text-xs text-text-secondary">
          Inventory file
          <input
            type="file"
            accept=".csv,.json"
            className={inputClass}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setError('File exceeds 5 MB.');
                setPreview(null);
                return;
              }
              try {
                change({
                  ...input,
                  format: file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv',
                  content: await file.text(),
                });
              } catch {
                setError('Could not read the inventory file.');
                setPreview(null);
              }
              e.target.value = '';
            }}
          />
        </label>
        <label className="block text-xs text-text-secondary">
          Format
          <select
            className={inputClass}
            value={input.format}
            onChange={(e) => change({ ...input, format: e.target.value as 'csv' | 'json' })}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON array</option>
          </select>
        </label>
        <label className="block text-xs text-text-secondary">
          Inventory content
          <textarea
            aria-label="Inventory content"
            rows={5}
            className={`${inputClass} font-mono`}
            value={input.content}
            onChange={(e) => change({ ...input, content: e.target.value })}
            placeholder={template}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-text-secondary">
            Default protocol
            <select
              className={inputClass}
              value={input.defaults?.protocol || ''}
              onChange={(e) => shared('protocol', e.target.value)}
            >
              <option value="">Use inventory / saved value</option>
              <option value="ssh">SSH</option>
              <option value="winrm">WinRM</option>
              <option value="snmp">SNMP v2c</option>
              <option value="db">Database</option>
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Group / site
            <input
              className={inputClass}
              value={input.defaults?.group || ''}
              onChange={(e) => shared('group', e.target.value)}
              placeholder="Mumbai / Production"
            />
          </label>
          <label className="text-xs text-text-secondary">
            Shared username
            <input
              className={inputClass}
              value={input.defaults?.username || ''}
              onChange={(e) => shared('username', e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="text-xs text-text-secondary">
            Shared password
            <input
              type="password"
              className={inputClass}
              value={input.defaults?.secret || ''}
              onChange={(e) => shared('secret', e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="text-xs text-text-secondary">
            SNMP community
            <input
              type="password"
              className={inputClass}
              value={input.defaults?.community || ''}
              onChange={(e) => shared('community', e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="text-xs text-text-secondary">
            Default database engine
            <select
              className={inputClass}
              value={input.defaults?.dbEngine || ''}
              onChange={(e) => shared('dbEngine', e.target.value)}
            >
              <option value="">Use inventory / saved value</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Default WinRM transport
            <select
              className={inputClass}
              value={input.defaults?.winrmTransport || ''}
              onChange={(e) => shared('winrmTransport', e.target.value)}
            >
              <option value="">Use inventory / saved value</option>
              <option value="http">HTTP (5985)</option>
              <option value="https">HTTPS (5986)</option>
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Default WinRM authentication
            <select
              className={inputClass}
              value={input.defaults?.winrmAuth || ''}
              onChange={(e) => shared('winrmAuth', e.target.value)}
            >
              <option value="">Auto</option>
              <option value="basic">Basic</option>
              <option value="ntlm">NTLM</option>
              <option value="kerberos">Kerberos (Windows ticket)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary col-span-2">
            <input
              type="checkbox"
              checked={input.defaults?.winrmRejectUnauthorized !== false}
              onChange={(e) =>
                shared('winrmRejectUnauthorized', e.target.checked ? 'true' : 'false')
              }
            />
            Verify WinRM HTTPS certificates (recommended)
          </label>
        </div>
        <details>
          <summary className="text-xs text-text-secondary cursor-pointer">
            Shared SSH private key
          </summary>
          <textarea
            aria-label="Shared SSH private key"
            rows={3}
            className={inputClass}
            value={input.defaults?.privateKey || ''}
            onChange={(e) => shared('privateKey', e.target.value)}
          />
          <input
            aria-label="SSH key passphrase"
            type="password"
            placeholder="Key passphrase"
            className={inputClass}
            value={input.defaults?.passphrase || ''}
            onChange={(e) => shared('passphrase', e.target.value)}
          />
        </details>
        <label className="block text-xs text-text-secondary">
          Existing target names
          <select
            className={inputClass}
            value={input.duplicates}
            onChange={(e) => change({ ...input, duplicates: e.target.value as 'skip' | 'update' })}
          >
            <option value="skip">Skip existing targets</option>
            <option value="update">Update existing targets (same host and protocol)</option>
          </select>
        </label>
        <p className="text-xs text-text-muted">
          Blank optional fields preserve saved values on update. Shared credentials are copied into
          each target’s encrypted record. No target is saved if any row is invalid. Preview shows
          the first 100 valid records without credentials.
        </p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-success">
            {message}
          </p>
        )}
        {preview && (
          <div className="space-y-2 text-xs text-text-secondary">
            <p>
              {preview.total} records: {preview.added} add, {preview.updated} update,{' '}
              {preview.skipped} skip, {preview.errors.length} invalid.
            </p>
            {preview.errors.slice(0, 50).map((item) => (
              <p key={item.row} className="text-error">
                Record {item.row}: {item.message}
              </p>
            ))}
            {preview.errors.length > 50 && (
              <p>Showing the first 50 errors. Correct these and validate again.</p>
            )}
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Name</th>
                    <th>Host</th>
                    <th>Protocol</th>
                    <th>Group</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.name}</td>
                      <td>{row.host}</td>
                      <td>{row.protocol}</td>
                      <td>{row.group}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!input.content.trim() || busy}
            onClick={() => void check(false)}
            className="px-3 py-2 rounded bg-surface-muted text-text-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Validate inventory'}
          </button>
          <button
            type="button"
            disabled={busy || !preview?.success}
            onClick={() => void check(true)}
            className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
          >
            Import validated systems
          </button>
        </div>
      </fieldset>
    </details>
  );
}
