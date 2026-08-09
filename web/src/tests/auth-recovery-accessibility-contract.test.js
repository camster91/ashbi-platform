import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const login = readFileSync(resolve(process.cwd(), 'src/pages/Login.jsx'), 'utf8');
const forgot = readFileSync(resolve(process.cwd(), 'src/pages/ForgotPassword.jsx'), 'utf8');

describe('authentication recovery accessibility contract', () => {
  it('keeps password visibility controls touch-sized and visibly focused', () => {
    expect(login).toContain('aria-label={showPassword ?');
    expect(login).toContain('min-h-11 min-w-11');
    expect(login).toContain('focus-visible:outline-none');
  });

  it('keeps recovery navigation actions explicit and visibly focused', () => {
    expect(forgot).toContain('type="button"');
    expect(forgot).toContain('focus-visible:ring-2');
  });
});
