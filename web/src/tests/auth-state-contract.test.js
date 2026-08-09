import { describe, expect, it } from 'vitest';
import { authFailureReason, safeReturnPath } from '../hooks/useAuth';

describe('auth transition contract', () => {
  it('classifies authentication and transient failures separately', () => {
    expect(authFailureReason({ status: 401 })).toBe('signed_out');
    expect(authFailureReason({ status: 403 })).toBe('forbidden');
    expect(authFailureReason({ status: 503 })).toBe('server');
    expect(authFailureReason({ name: 'TimeoutError' })).toBe('timeout');
    expect(authFailureReason({ name: 'NetworkError' })).toBe('offline');
  });

  it('allows only internal non-authentication return paths', () => {
    expect(safeReturnPath('/projects?create=true')).toBe('/projects?create=true');
    expect(safeReturnPath('https://attacker.example')).toBe('/dashboard');
    expect(safeReturnPath('//attacker.example')).toBe('/dashboard');
    expect(safeReturnPath('/login')).toBe('/dashboard');
    expect(safeReturnPath('/forgot-password?next=/admin')).toBe('/dashboard');
  });
});
