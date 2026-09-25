import { describe, expect, it, vi } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return import('../lib/initial-route.js');
}

describe('initial login route preload', () => {
  it('resolves the login page before the first render on /login', async () => {
    const { preloadInitialRoute, getPreloadedLogin } = await freshModule();
    const LoginPage = () => null;
    await preloadInitialRoute('/login', async () => ({ default: LoginPage }));
    expect(getPreloadedLogin()).toBe(LoginPage);
  });

  it('keeps every other route on the lazy path', async () => {
    const { preloadInitialRoute, getPreloadedLogin } = await freshModule();
    const load = vi.fn();
    await preloadInitialRoute('/dashboard', load);
    expect(load).not.toHaveBeenCalled();
    expect(getPreloadedLogin()).toBeNull();
  });

  it('falls back to the lazy route when the chunk fails to load', async () => {
    const { preloadInitialRoute, getPreloadedLogin } = await freshModule();
    await expect(preloadInitialRoute('/login', async () => { throw new Error('chunk failed'); })).resolves.toBeUndefined();
    expect(getPreloadedLogin()).toBeNull();
  });
});
