import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const login = readFileSync(resolve(process.cwd(), 'src/pages/Login.jsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
const theme = readFileSync(resolve(process.cwd(), 'src/hooks/useTheme.jsx'), 'utf8');
const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');
const themeLibrary = readFileSync(resolve(process.cwd(), 'src/lib/theme.js'), 'utf8');

describe('authentication theme contract', () => {
  it('uses semantic theme surfaces and statuses throughout the auth gateway', () => {
    expect(login).not.toMatch(/bg-white\b(?!\/)/);
    expect(login).toContain('bg-card');
    expect(login).toContain('text-card-foreground');
    expect(login).toContain('bg-warning/10');
    expect(login).toContain('focus:ring-ring');
    expect(login).toContain('bg-primary text-primary-foreground');
    expect(app).not.toMatch(/text-slate-|bg-amber-50|text-amber-950/);
  });

  it('stores staff theme preferences under an account-specific key', () => {
    expect(layout).toContain('useTheme(user?.id)');
    expect(themeLibrary).toContain('`theme:${scopeId}`');
    expect(theme).not.toContain("localStorage.getItem('theme')");
    expect(theme).not.toContain("localStorage.setItem('theme', theme)");
    expect(main).toContain('applyTheme(getInitialTheme())');
    expect(themeLibrary).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });
});
