import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Both ocr-tools-server.ts and weather-tools-server.ts call serveStdio(...)
// unconditionally at module load (standalone MCP stdio server entry points),
// so they cannot be imported directly in a unit test without spinning up a
// real server process. Following the same convention as
// tests/office-tools-source-driven.test.ts and tests/gui-operate-safety.test.ts,
// these tests assert on the source text itself.
const ocrPath = path.resolve(process.cwd(), 'src/main/mcp/ocr-tools-server.ts');
const ocrContent = readFileSync(ocrPath, 'utf8');

const weatherPath = path.resolve(process.cwd(), 'src/main/mcp/weather-tools-server.ts');
const weatherContent = readFileSync(weatherPath, 'utf8');

describe('OCR tools server', () => {
  it('exposes the ocr_extract_text tool with image_path required', () => {
    expect(ocrContent).toContain("name: 'ocr_extract_text'");
    expect(ocrContent).toContain("required: ['image_path']");
  });

  it('resolves the Node worker script, not the browser dist bundle', () => {
    // Regression pin: dist/worker.min.js is tesseract.js's BROWSER worker bundle
    // (expects `addEventListener`, which doesn't exist in Node — throws
    // "r.g.addEventListener is not a function" when loaded via worker_threads).
    // The correct path is the unbuilt Node worker script under src/worker-script/node.
    expect(ocrContent).toContain("'worker-script', 'node', 'index.js'");
    expect(ocrContent).not.toContain("'dist', 'worker.min.js'");
  });

  it('resolves tesseract asset paths via require.resolve against the real package, not a hardcoded/relative guess', () => {
    expect(ocrContent).toContain("require.resolve('tesseract.js/package.json')");
    expect(ocrContent).toContain("require.resolve('tesseract.js-core/package.json')");
  });

  it('passes the resolved workerPath/corePath explicitly to createWorker', () => {
    const getWorkerStart = ocrContent.indexOf('async function getWorker(');
    expect(getWorkerStart).toBeGreaterThan(-1);
    const slice = ocrContent.slice(getWorkerStart, getWorkerStart + 800);
    expect(slice).toContain('resolveTesseractAssetPaths()');
    expect(slice).toContain('createWorker(language, undefined, { workerPath, corePath })');
  });

  it('validates the input file extension before attempting OCR', () => {
    expect(ocrContent).toContain('SUPPORTED_EXTENSIONS');
    expect(ocrContent).toContain('.png');
    expect(ocrContent).toContain('.pdf');
    expect(ocrContent).toContain('Unsupported file type');
  });

  it('reuses a cached worker across calls instead of recreating it every time', () => {
    expect(ocrContent).toContain('let cachedWorker: Worker | null = null');
    expect(ocrContent).toContain('cachedWorkerLanguage === language');
  });
});

describe('bundle-mcp.js externalizes tesseract.js for the OCR server', () => {
  const bundleScriptPath = path.resolve(process.cwd(), 'scripts/bundle-mcp.js');
  const bundleScriptContent = readFileSync(bundleScriptPath, 'utf8');

  it('marks tesseract.js and tesseract.js-core as extraExternals', () => {
    // Regression pin: without this, esbuild inlines require.resolve('tesseract.js/...')
    // as a build-machine-specific absolute path string, which breaks on any other
    // machine and in packaged builds (esbuild warns "should be marked as external").
    const ocrEntryStart = bundleScriptContent.indexOf("name: 'ocr-tools-server'");
    expect(ocrEntryStart).toBeGreaterThan(-1);
    const slice = bundleScriptContent.slice(ocrEntryStart, ocrEntryStart + 700);
    expect(slice).toContain("extraExternals: ['tesseract.js', 'tesseract.js-core']");
  });

  it('merges per-server extraExternals into the esbuild external list', () => {
    expect(bundleScriptContent).toContain('server.extraExternals');
    expect(bundleScriptContent).toContain('...NODE_EXTERNALS, ...server.extraExternals');
  });
});

describe('Weather tools server', () => {
  it('exposes the get_weather tool', () => {
    expect(weatherContent).toContain("name: 'get_weather'");
  });

  it('uses Open-Meteo (free, no API key) for geocoding and forecast', () => {
    expect(weatherContent).toContain('https://geocoding-api.open-meteo.com/v1/search');
    expect(weatherContent).toContain('https://api.open-meteo.com/v1/forecast');
  });

  it('geocodes a place name when explicit coordinates are not provided', () => {
    expect(weatherContent).toContain('geocodeLocation(location)');
    expect(weatherContent).toContain('lat === undefined || lon === undefined');
  });

  it("clamps forecast_days into Open-Meteo's supported range", () => {
    expect(weatherContent).toContain('Math.min(Math.max(forecastDays, 1), 16)');
  });

  it('maps WMO weather codes to human-readable descriptions', () => {
    expect(weatherContent).toContain('WEATHER_CODE_DESCRIPTIONS');
    expect(weatherContent).toContain("0: 'Clear sky'");
    expect(weatherContent).toContain('describeWeatherCode');
  });
});

describe('mcp-manager.ts registers OCR_Tools and Weather_Tools as built-in servers', () => {
  const mcpManagerPath = path.resolve(process.cwd(), 'src/main/mcp/mcp-manager.ts');
  const mcpManagerContent = readFileSync(mcpManagerPath, 'utf8');

  it('resolves the OCR and Weather server file paths', () => {
    expect(mcpManagerContent).toContain('getOcrToolsServerPath');
    expect(mcpManagerContent).toContain("this.getMcpServerPath('ocr-tools-server.ts')");
    expect(mcpManagerContent).toContain('getWeatherToolsServerPath');
    expect(mcpManagerContent).toContain("this.getMcpServerPath('weather-tools-server.ts')");
  });

  it('resolves the {OCR_TOOLS_SERVER_PATH} and {WEATHER_TOOLS_SERVER_PATH} placeholders', () => {
    expect(mcpManagerContent).toContain("arg === '{OCR_TOOLS_SERVER_PATH}'");
    expect(mcpManagerContent).toContain("arg === '{WEATHER_TOOLS_SERVER_PATH}'");
  });

  it('includes OCR_Tools and Weather_Tools in the built-in server allowlist', () => {
    const isBuiltinStart = mcpManagerContent.indexOf('const isBuiltinServer =');
    expect(isBuiltinStart).toBeGreaterThan(-1);
    const slice = mcpManagerContent.slice(isBuiltinStart, isBuiltinStart + 600);
    expect(slice).toContain("config.name === 'OCR_Tools'");
    expect(slice).toContain("config.name === 'Weather_Tools'");
  });
});
