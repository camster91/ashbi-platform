import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const login = readFileSync(resolve(process.cwd(), 'src/pages/Login.jsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

describe('authentication action contract', () => {
  it('keeps sign-in fields identifiable and the submit state announced', () => {
    expect(login).toContain('autoComplete="email"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain('aria-busy={isLoading}');
    expect(login).toContain('w-full min-h-11 flex items-center');
    expect(login).toContain('focus-visible:outline-none focus-visible:ring-2');
  });

  it('keeps transient session recovery actionable and keyboard-visible', () => {
    expect(app).toContain('role="alert"');
    expect(app).toContain('min-h-11 rounded-full');
    expect(app).toContain('onRetry={checkAuth}');
  });
});
