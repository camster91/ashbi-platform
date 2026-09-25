import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
const settings = readFileSync(resolve(process.cwd(), 'src/pages/Settings.jsx'), 'utf8');
const hook = readFileSync(resolve(process.cwd(), 'src/hooks/usePushNotifications.js'), 'utf8');
const auth = readFileSync(resolve(process.cwd(), 'src/hooks/useAuth.jsx'), 'utf8');

describe('notification consent policy', () => {
  it('keeps installation independent from notification permission', () => {
    expect(layout).toMatch(/onClick=\{install\}/);
    expect(layout).not.toMatch(/await install\(\)[\s\S]{0,120}subscribe\(/);
  });

  it('offers informed consent and a persistent not-now choice', () => {
    expect(layout).toContain('Get important work updates');
    expect(layout).toContain('assigned work and client activity');
    expect(layout).toContain('Not now');
    expect(layout).toContain('push-prompt-snoozed:');
  });

  it('exposes reversible and actionable settings states', () => {
    for (const copy of [
      'Disable notifications',
      'Enable notifications',
      'browser settings',
      'You are offline',
      'signing out removes its server registration',
    ]) {
      expect(settings).toContain(copy);
    }
    expect(settings).toContain('aria-live="polite"');
    expect(settings).toContain('role="alert"');
  });

  it('models the complete asynchronous lifecycle', () => {
    for (const state of [
      'unsupported',
      'offline',
      'subscribing',
      'subscribed',
      'unsubscribing',
      'error',
    ]) {
      expect(hook).toContain(`'${state}'`);
    }
  });

  it('clears browser registrations on logout and session expiry', () => {
    expect(auth).toContain('clearBrowserPushSubscription({ removeFromServer: true })');
    expect(auth).toContain('await clearBrowserPushSubscription();');
  });

  it('only auto re-subscribes accounts that explicitly opted in (#321)', () => {
    expect(layout).toContain('shouldAutoResubscribe({ userId: user?.id, permission })');
    expect(layout).not.toMatch(/if \(user\?\.id && permission === 'granted'\)/);
    expect(layout).toContain('usePushNotifications({ userId: user?.id })');
    expect(settings).toContain('usePushNotifications({ userId: user?.id })');
  });
});
