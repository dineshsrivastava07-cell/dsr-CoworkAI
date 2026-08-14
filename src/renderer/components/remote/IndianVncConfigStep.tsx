/**
 * IndianVncConfigStep — India-focused remote desktop/VNC provider setup.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { IndianVncConfig } from './types';

interface Props {
  config: IndianVncConfig;
  onChange: (config: IndianVncConfig) => void;
}

export function IndianVncConfigStep({ config, onChange }: Props) {
  const { t } = useTranslation();

  const providers: Array<{
    value: IndianVncConfig['provider'];
    label: string;
    desc: string;
    portal: string;
  }> = [
    {
      value: 'zoho-assist',
      label: 'Zoho Assist',
      desc: t('remote.indianVncProviderZohoDesc'),
      portal: 'https://assist.zoho.in',
    },
    {
      value: 'manageengine-remote-access-plus',
      label: 'ManageEngine Remote Access Plus',
      desc: t('remote.indianVncProviderManageEngineDesc'),
      portal: 'https://www.manageengine.com/remote-desktop-management/',
    },
  ];

  const selectedProvider = providers.find((provider) => provider.value === config.provider);

  function update(patch: Partial<IndianVncConfig>) {
    onChange({ ...config, ...patch });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">{t('remote.indianVncTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.indianVncDesc')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <button
            key={provider.value}
            type="button"
            onClick={() =>
              update({
                provider: provider.value,
                portalUrl: config.portalUrl || provider.portal,
              })
            }
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              config.provider === provider.value
                ? 'border-accent bg-accent/5'
                : 'border-border hover:border-accent/50'
            }`}
          >
            <div className="font-medium text-text-primary text-sm">{provider.label}</div>
            <div className="text-xs text-text-muted mt-1">{provider.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.indianVncPortalUrl')}
          </label>
          <input
            type="url"
            value={config.portalUrl ?? ''}
            onChange={(event) => update({ portalUrl: event.target.value })}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
            placeholder={selectedProvider?.portal}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('remote.indianVncOrganizationId')}
            </label>
            <input
              type="text"
              value={config.organizationId ?? ''}
              onChange={(event) => update({ organizationId: event.target.value })}
              className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
              placeholder="VMART-IT"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('remote.indianVncOperatorEmail')}
            </label>
            <input
              type="email"
              value={config.operatorEmail ?? ''}
              onChange={(event) => update({ operatorEmail: event.target.value })}
              className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
              placeholder="it.support@company.in"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.indianVncAccessMode')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['attended', 'unattended'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => update({ accessMode: mode })}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  config.accessMode === mode
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="font-medium text-text-primary text-sm">
                  {t(`remote.indianVncMode${mode === 'attended' ? 'Attended' : 'Unattended'}`)}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {t(`remote.indianVncMode${mode === 'attended' ? 'Attended' : 'Unattended'}Desc`)}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          <label className="flex items-start gap-3 p-3 rounded-xl border border-border bg-surface-hover">
            <input
              type="checkbox"
              checked={config.requireUserConsent}
              onChange={(event) => update({ requireUserConsent: event.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">
                {t('remote.indianVncRequireConsent')}
              </span>
              <span className="block text-xs text-text-muted mt-0.5">
                {t('remote.indianVncRequireConsentDesc')}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 p-3 rounded-xl border border-border bg-surface-hover">
            <input
              type="checkbox"
              checked={config.auditLogging}
              onChange={(event) => update({ auditLogging: event.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">
                {t('remote.indianVncAuditLogging')}
              </span>
              <span className="block text-xs text-text-muted mt-0.5">
                {t('remote.indianVncAuditLoggingDesc')}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={selectedProvider?.portal ?? 'https://assist.zoho.in'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <ExternalLink className="w-4 h-4" />
          {t('remote.openIndianVnc')}
        </a>
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t('remote.indianVncComplianceHint')}
        </span>
      </div>
    </div>
  );
}
