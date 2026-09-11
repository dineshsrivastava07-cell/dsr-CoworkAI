# Internationalization (i18n) Guide

This project uses `react-i18next` for internationalization. Currently only English (`en`) is wired up (see `config.ts`) — the setup below is structured so additional locales can be added later without touching component code.

## Why this structure

✅ **Only English keys in code** - no if-else branching, code stays clean
✅ **Centralized translations** - all copy lives in JSON files
✅ **Type-safe** - TypeScript support
✅ **Persisted** - language selection can be saved to localStorage once multiple locales exist

## Basic usage

### 1. Use translations in a component

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('welcome.title')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 2. Translations with variables

```tsx
// en.json
{
  "welcome": {
    "greeting": "Hello, {{name}}!"
  }
}

// Usage
{t('welcome.greeting', { name: 'John' })}
```

### 3. Plural forms

```tsx
// en.json
{
  "mcp": {
    "toolsAvailable": "{{count}} tool available",
    "toolsAvailable_plural": "{{count}} tools available"
  }
}

// Usage
{t('mcp.toolsAvailable', { count: 1 })} // "1 tool available"
{t('mcp.toolsAvailable', { count: 5 })} // "5 tools available"
```

## Adding a new locale

1. Add a `src/renderer/i18n/locales/<lang>.json` file mirroring the structure of `en.json`.
2. Register it in `config.ts`'s `resources` map and add it to `supportedLngs`.
3. Add a language switcher UI component if you want users to pick a locale at runtime (none exists yet — `config.ts` currently pins `lng: 'en'`).

## Translation file structure

Organize by feature area:

```json
{
  "common": { ... },      // shared vocabulary
  "welcome": { ... },     // welcome screen
  "settings": { ... },    // settings screen
  "mcp": { ... },         // MCP-related
  "credentials": { ... }  // credentials-related
}
```

## Best practices

1. **Use meaningful keys** - `welcome.title` rather than `text1`
2. **Keep structure consistent** - if you add more locale files, their JSON structure should match `en.json` exactly
3. **Avoid hardcoding** - all user-visible text should go through the `t()` function
4. **Namespacing** - use dot-separated hierarchical keys to organize translations
