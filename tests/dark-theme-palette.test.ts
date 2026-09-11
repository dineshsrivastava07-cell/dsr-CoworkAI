import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses the DSR charcoal-blue palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #161618;');
    expect(source).toContain('--color-surface: #222225;');
    expect(source).toContain('--color-text-primary: #e8e8e8;');
  });

  it('keeps the accent within the DSR blue family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #5b8dde;');
    expect(source).toContain('--color-accent-hover: #4a7dcf;');
  });
});
