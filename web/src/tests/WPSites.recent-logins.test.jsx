/**
 * Vitest tests for the WPSites "Recent Logins" tab (Plan 11 / PR-F).
 *
 * Verifies the UI surface that drives GET /api/wp-bridge/magic-login/log
 * and POST /api/wp-bridge/magic-login/revoke:
 *   - Tab renders on demand (clicks the tab button)
 *   - Audit log entries render with status pills
 *   - Status filter narrows the result set
 *   - Revoke button calls POST and toasts success/failure
 *   - Empty state renders when log returns []
 *
 * Run: npx vitest run src/tests/WPSites.recent-logins.test.jsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WPSites from '../pages/WPSites';

// ---------------------------------------------------------------------------
// Mock the api module so we can drive the test without a running Fastify
// server. The shape mirrors web/src/lib/api.js.
//
// vi.mock is hoisted to the top of the file, so the factory must be
// self-contained — it cannot reference variables declared below it. We
// therefore declare apiMock via vi.hoisted() and reuse the same reference
// in the mock factory.
// ---------------------------------------------------------------------------
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listWPSites: vi.fn(async () => []),
    registerWPSite: vi.fn(),
    deleteWPSite: vi.fn(),
    getWPFleetStatus: vi.fn(async () => ({ totalSites: 0, healthy: 0, sites: [] })),
    postWPFleetDigest: vi.fn(),
    postWPFleetMagicLogin: vi.fn(),
    getWPFleetOps: vi.fn(async () => ({ ops: [] })),
    getWPMagicLoginLog: vi.fn(),
    postWPMagicLoginRevoke: vi.fn()
  }
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

// Same fetch wrapper that the page uses for delete; for this test we keep
// the apiMock helpers above and only need to confirm the mutate function is
// invoked with the right body.
globalThis.fetch = vi.fn(async () => ({
  status: 204,
  ok: true,
  json: async () => ({}),
  text: async () => ''
}));

function renderWPSites() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={qc}>
      <WPSites />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty log. Each test overrides as needed.
  apiMock.getWPMagicLoginLog.mockResolvedValue({ entries: [], count: 0, limit: 100 });
  apiMock.getWPFleetStatus.mockResolvedValue({ totalSites: 0, healthy: 0, sites: [] });
  apiMock.listWPSites.mockResolvedValue([]);
  apiMock.getWPFleetOps.mockResolvedValue({ ops: [] });
});

describe('WPSites — Recent Logins tab', () => {
  it('renders the tab button', async () => {
    renderWPSites();
    const tab = await screen.findByTestId('recent-logins-tab');
    expect(tab).toBeTruthy();
    expect(tab.textContent).toMatch(/Recent Logins/);
  });

  it('shows empty state when the log is empty', async () => {
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    expect(
      await screen.findByText(/No magic-login events yet/)
    ).toBeTruthy();
  });

  it('renders audit rows with status pills', async () => {
    apiMock.getWPMagicLoginLog.mockResolvedValue({
      entries: [
        { id: 'l1', siteUrl: 'https://a.com', status: 'issued', ts: '2026-07-03T18:00:00Z', userId: 1, hubUserId: 'admin-1', ip: '203.0.113.1', reason: null, tokenHash: 'h1' },
        { id: 'l2', siteUrl: 'https://a.com', status: 'consumed', ts: '2026-07-03T18:00:30Z', userId: 1, hubUserId: null, ip: '203.0.113.5', reason: null, tokenHash: 'h2' },
        { id: 'l3', siteUrl: 'https://b.com', status: 'rejected', ts: '2026-07-03T18:01:00Z', userId: 0, hubUserId: null, ip: '198.51.100.7', reason: 'rate_limited', tokenHash: null }
      ],
      count: 3,
      limit: 100
    });
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    const table = await screen.findByTestId('recent-logins-table');

    expect(within(table).getByText('issued')).toBeTruthy();
    expect(within(table).getByText('consumed')).toBeTruthy();
    expect(within(table).getByText('rejected')).toBeTruthy();
    // Reason label for rate_limited is humanized
    expect(within(table).getByText(/hub-side rate limit/)).toBeTruthy();
  });

  it('forwards the status filter to the api', async () => {
    // Need at least one entry so the table (not the empty state) renders —
    // the filter dropdown is on the card either way, but the test reads
    // from the table-rendered state for stability.
    apiMock.getWPMagicLoginLog.mockResolvedValue({
      entries: [
        { id: 'l1', siteUrl: 'https://a.com', status: 'issued', ts: '2026-07-03T18:00:00Z', userId: 1, hubUserId: 'admin-1', ip: '203.0.113.1', reason: null, tokenHash: 'h1' }
      ],
      count: 1,
      limit: 100
    });
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    await screen.findByTestId('recent-logins-table');
    const statusSelect = screen.getByTestId('status-filter');
    fireEvent.change(statusSelect, { target: { value: 'rejected' } });

    await waitFor(() => {
      const lastCall = apiMock.getWPMagicLoginLog.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ status: 'rejected' });
    });
  });

  it('renders the count when results are present', async () => {
    apiMock.getWPMagicLoginLog.mockResolvedValue({
      entries: [
        { id: 'l1', siteUrl: 'https://a.com', status: 'issued', ts: '2026-07-03T18:00:00Z', userId: 1, hubUserId: 'admin-1', ip: '203.0.113.1', reason: null, tokenHash: 'h1' }
      ],
      count: 1,
      limit: 100
    });
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    expect(await screen.findByText(/1 event$/)).toBeTruthy();
  });

  it('revoke button calls POST and shows success toast (regression: bug #37 sends hash, not token)', async () => {
    // Regression for PR-F verifier FAIL: the UI was passing the sha256 hash
    // as the "token" field, the plugin computed sha256(sha256(raw)) =
    // double-hash, and the revoke silently no-op'd. The fix: the UI sends
    // { siteId, hash } and the plugin uses the hash directly.
    const REAL_HASH = 'a'.repeat(64); // 64-char lowercase hex (matches plugin's strict regex)
    apiMock.getWPMagicLoginLog.mockResolvedValue({
      entries: [
        { id: 'l1', siteId: 'site-42', siteUrl: 'https://a.com', status: 'issued', ts: '2026-07-03T18:00:00Z', userId: 1, hubUserId: 'admin-1', ip: '203.0.113.1', reason: null, tokenHash: REAL_HASH }
      ],
      count: 1,
      limit: 100
    });
    apiMock.postWPMagicLoginRevoke.mockResolvedValue({ ok: true, siteUrl: 'https://a.com', hash: REAL_HASH });
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    const row = await screen.findByTestId('recent-login-row-l1');
    const button = within(row).getByTitle(/Revoke this magic-login token/);
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke token' }));

    // Wire shape: { siteId, hash } — NOT { siteId, token }
    await waitFor(() => {
      expect(apiMock.postWPMagicLoginRevoke).toHaveBeenCalledWith({ siteId: 'site-42', hash: REAL_HASH });
    });
    const lastCall = apiMock.postWPMagicLoginRevoke.mock.calls.at(-1)?.[0];
    expect(lastCall).not.toHaveProperty('token'); // explicit anti-regression

    await waitFor(() => {
      expect(screen.getByText(/Revoked magic login on https:\/\/a\.com/)).toBeTruthy();
    });
  });

  it('does not call POST when user cancels the confirm dialog', async () => {
    const REAL_HASH = 'a'.repeat(64);
    apiMock.getWPMagicLoginLog.mockResolvedValue({
      entries: [
        { id: 'l1', siteId: 'site-42', siteUrl: 'https://a.com', status: 'issued', ts: '2026-07-03T18:00:00Z', userId: 1, hubUserId: 'admin-1', ip: '203.0.113.1', reason: null, tokenHash: REAL_HASH }
      ],
      count: 1,
      limit: 100
    });
    apiMock.postWPMagicLoginRevoke.mockResolvedValue({ ok: true, siteUrl: 'https://a.com' });
    renderWPSites();
    fireEvent.click(screen.getByTestId('recent-logins-tab'));
    const row = await screen.findByTestId('recent-login-row-l1');
    const button = within(row).getByTitle(/Revoke this magic-login token/);
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    // Give React a tick to fire any mutations
    await new Promise((r) => setTimeout(r, 50));
    expect(apiMock.postWPMagicLoginRevoke).not.toHaveBeenCalled();
  });
});
