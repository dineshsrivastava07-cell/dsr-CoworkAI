import { Monitor, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MCPServerConfig, MCPServerStatus } from './shared';
import { RpaWorkflowSetup } from './RpaWorkflowSetup';

export function SettingsRPA({
  server,
  status,
  toolCount,
  isLoading,
  onToggle,
}: {
  server?: MCPServerConfig;
  status?: MCPServerStatus;
  toolCount: number;
  isLoading: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const enabled = server?.enabled === true;

  return (
    <section
      aria-labelledby="rpa-settings-title"
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-accent" />
          <h3 id="rpa-settings-title" className="font-medium text-text-primary">
            {t('rpa.title')}
          </h3>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={t('rpa.title')}
          aria-checked={enabled}
          disabled={isLoading}
          onClick={onToggle}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-sm disabled:opacity-50"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {enabled ? t('rpa.disable') : t('rpa.enable')}
        </button>
      </div>
      <p className="text-sm text-text-secondary">{t('rpa.description')}</p>
      <p role="status" className="text-sm text-text-secondary">
        {!enabled
          ? t('rpa.disabled')
          : status?.status === 'connected'
            ? t('rpa.connected', { count: toolCount })
            : status?.status === 'failed'
              ? t('mcp.failed')
              : status?.status === 'connecting'
                ? t('mcp.connecting')
                : t('rpa.notConnected')}
      </p>
      <p className="text-xs text-text-muted">{t('rpa.permissions')}</p>
      <p className="text-xs text-text-muted">{t('rpa.tryIt')}</p>
      <RpaWorkflowSetup connected={enabled && status?.status === 'connected'} />
    </section>
  );
}
