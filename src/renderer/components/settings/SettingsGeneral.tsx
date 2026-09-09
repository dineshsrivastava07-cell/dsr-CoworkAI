import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useAppConfig } from '../../store/selectors';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const appConfig = useAppConfig();
  const autoApproveTools = appConfig?.autoApproveTools ?? false;
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [appVer, setAppVer] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [{ code: 'en', nativeName: 'English' }];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* Autonomous Mode */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t('general.autonomousMode', 'Autonomous Mode')}
        </h4>
        <label className="flex items-start gap-3 p-3 rounded-lg border-2 border-border bg-surface cursor-pointer hover:border-accent/50 transition-all">
          <input
            type="checkbox"
            checked={autoApproveTools}
            onChange={(e) => updateSettings({ autoApproveTools: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm text-text-secondary">
            {t(
              'general.autonomousModeDescription',
              "Auto-approve tool calls that would otherwise wait for your click — useful for scheduled or unattended tasks. Doesn't override explicit deny rules or irreversible-action confirmations."
            )}
          </span>
        </label>
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">V-Coworker v{appVer} · Developed by DSR AI Lab</p>
        </div>
      )}
    </div>
  );
}
