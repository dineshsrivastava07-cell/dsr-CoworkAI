import { AlertCircle, CheckCircle } from 'lucide-react';
import type { InfraRcaConnectionResult, InfraRcaProtocol } from '../../../shared/ipc-types';

export function InfraConnectionResult({
  result,
  protocol,
}: {
  result: InfraRcaConnectionResult;
  protocol: InfraRcaProtocol;
}) {
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
            ? `${protocol === 'snmp' ? 'SNMP responded' : 'TCP reachable (login not tested)'} (${result.latencyMs ?? 0}ms)`
            : result.error || 'Connection failed'}
          {result.port ? ` · Port ${result.port}` : ''}
          {result.errorCode ? ` · ${result.errorCode}` : ''}
        </span>
      </div>
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
    </div>
  );
}
