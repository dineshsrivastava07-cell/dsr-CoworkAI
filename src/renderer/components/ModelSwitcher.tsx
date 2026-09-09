import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { useAppConfig } from '../store/selectors';
import { useAppStore } from '../store';
import { API_PROVIDER_PRESETS, type SharedProviderType } from '../../shared/api-model-presets';
import type { ProviderModelInfo } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// 'custom' is intentionally excluded — its base URL/protocol are too open-ended
// for a quick switcher; that stays a Settings-only flow. Excluding it from the
// type (not just the array contents) lets appConfig.profiles[provider] index
// safely below, since ProviderProfileKey has no 'custom' member either.
type SwitchableProvider = Exclude<SharedProviderType, 'custom'>;

const SWITCHABLE_PROVIDERS: SwitchableProvider[] = [
  'ollama',
  'gemini',
  'openai',
  'anthropic',
  'openrouter',
];

export function ModelSwitcher() {
  const appConfig = useAppConfig();
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);

  const [open, setOpen] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<ProviderModelInfo[] | null>(null);
  const [isLoadingOllama, setIsLoadingOllama] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !isElectron || ollamaModels !== null) return;
    setIsLoadingOllama(true);
    window.electronAPI.config
      .listModels({ provider: 'ollama', apiKey: '', baseUrl: undefined })
      .then((models) => setOllamaModels(models))
      .catch(() => setOllamaModels([]))
      .finally(() => setIsLoadingOllama(false));
  }, [open, ollamaModels]);

  if (!appConfig) return null;

  async function selectModel(provider: SwitchableProvider, model: string) {
    setOpen(false);
    if (!isElectron) return;
    try {
      await window.electronAPI.config.save({ provider, model });
    } catch (err) {
      console.error('Failed to switch model:', err);
    }
  }

  function openApiSettings() {
    setOpen(false);
    setShowSettings(true);
    setSettingsTab('api');
  }

  const activeProvider = appConfig.provider;
  const activeModel = appConfig.model;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted hover:bg-surface-hover hover:text-text-secondary transition-colors"
      >
        {activeModel || 'No model'}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg z-50 py-1">
          {SWITCHABLE_PROVIDERS.map((provider) => {
            const preset = API_PROVIDER_PRESETS[provider];
            const profile = appConfig.profiles?.[provider];
            const isReady = provider === 'ollama' || Boolean(profile?.apiKey?.trim());
            const models = provider === 'ollama' ? (ollamaModels ?? []) : preset.models;

            return (
              <div key={provider} className="px-2 py-1.5">
                <div className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted flex items-center gap-1.5">
                  {preset.name}
                  {!isReady && <Lock className="w-3 h-3" />}
                </div>
                {!isReady ? (
                  <button
                    type="button"
                    onClick={openApiSettings}
                    className="w-full text-left px-2 py-1.5 rounded-md text-xs text-accent hover:bg-surface-hover transition-colors"
                  >
                    Add API key in Settings
                  </button>
                ) : provider === 'ollama' && isLoadingOllama ? (
                  <div className="px-2 py-1.5 text-xs text-text-muted">Loading local models…</div>
                ) : models.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-text-muted">No models found</div>
                ) : (
                  models.map((m) => {
                    const isActive = activeProvider === provider && activeModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selectModel(provider, m.id)}
                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                          isActive
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-text-secondary hover:bg-surface-hover'
                        }`}
                      >
                        {m.name}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
