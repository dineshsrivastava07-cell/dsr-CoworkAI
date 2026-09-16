import { AlertCircle, Check, CheckCircle, Copy } from 'lucide-react';
import { useState } from 'react';
import type { InfraRcaConnectionResult, InfraRcaProtocol } from '../../../shared/ipc-types';

export function InfraConnectionResult({
  result,
  protocol,
}: {
  result: InfraRcaConnectionResult;
  protocol: InfraRcaProtocol;
}) {
  const [copied, setCopied] = useState(false);
  const repairText = result.remediationCommands?.join('\n') || '';
  const copyRepair = async () => {
    if (!repairText) return;
    await navigator.clipboard.writeText(repairText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="text-xs mt-1 space-y-2" role="status">
      <div className={`flex items-start gap-1 ${result.reachable ? 'text-success' : 'text-error'}`}>
        {result.reachable ? (
          <CheckCircle className="w-3 h-3 shrink-0" />
        ) : (
          <AlertCircle className="w-3 h-3 shrink-0" />
        )}
        <span>
          {result.reachable
            ? `${protocol === 'snmp' ? 'SNMP responded' : result.authenticated ? 'WinRM authenticated and ready' : 'TCP reachable (login not tested)'} (${result.latencyMs ?? 0}ms)`
            : result.error || 'Connection failed'}
          {result.port ? ` · Port ${result.port}` : ''}
          {result.errorCode ? ` · ${result.errorCode}` : ''}
        </span>
      </div>
      {result.networkPath && (
        <div className="rounded bg-surface-muted p-2 text-text-secondary">
          <div className="font-medium text-text-primary">Network path</div>
          <div>{result.networkPath.summary}</div>
        </div>
      )}
      {!!result.probes?.length && (
        <details open className="text-text-secondary">
          <summary className="cursor-pointer">Port and service probes</summary>
          <ul className="mt-1 space-y-1">
            {result.probes.map((probe) => (
              <li key={`${probe.service}-${probe.port}`}>
                {probe.service} · TCP {probe.port} ·{' '}
                {probe.reachable
                  ? `reachable (${probe.latencyMs ?? 0}ms)`
                  : probe.errorCode || 'failed'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!result.nextSteps?.length && (
        <ol className="list-decimal pl-4 space-y-1 text-text-secondary">
          {result.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {result.limitation && <p className="text-text-secondary">{result.limitation}</p>}
      {!!result.localChecks?.length && (
        <details className="text-text-secondary">
          <summary className="cursor-pointer">Windows IT checks (read-only)</summary>
          <p className="my-2">
            Run on the affected Windows computer in an administrative PowerShell window. These
            commands inspect configuration; they do not enable WinRM or change firewall policy.
          </p>
          <pre className="whitespace-pre-wrap break-words p-2 rounded bg-surface-muted select-text">
            {result.localChecks.join('\n')}
          </pre>
        </details>
      )}
      {!!result.remediationCommands?.length && (
        <details className="text-text-secondary">
          <summary className="cursor-pointer text-warning">
            Administrator repair (changes the Windows target)
          </summary>
          <p className="my-2">
            Run only through your approved endpoint-management, Group Policy, RDP or local
            administrator process. Test never runs these commands automatically.
          </p>
          <pre className="whitespace-pre-wrap break-words p-2 rounded bg-surface-muted select-text">
            {result.remediationCommands.join('\n')}
          </pre>
          <button
            type="button"
            onClick={() => void copyRepair()}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 mt-2 text-text-primary hover:bg-surface"
            aria-label="Copy administrator repair commands"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy repair commands'}
          </button>
        </details>
      )}
    </div>
  );
}
