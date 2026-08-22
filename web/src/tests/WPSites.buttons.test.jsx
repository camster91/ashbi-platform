/**
 * WPSites buttons test — PR-E (hub-ui-buttons-wire).
 *
 * Verifies that the WPSites UI:
 *   1. Magic Login row button POSTs /api/wp-bridge/fleet/magic-login with
 *      { targetSites: [siteId] } and opens the returned URL in a
 *      new tab.
 *   2. Delete row button DELETEs /api/wp-bridge/<siteId> (path param, not
 *      query string).
 *   3. Both buttons surface success / error toasts through the existing
 *      setAlert pipeline.
 *
 * The two buttons were broken previously:
 *   - Magic Login: GET /wp-bridge/magic-login?siteId=... (route not defined)
 *   - Delete:      DELETE /wp-bridge?id=... (server route is DELETE /:id)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api module — SitesTab also calls api.listWPSites and
// api.getWPFleetStatus; we only care about the row-button fetches but
// these calls would block the query layer if left unmocked.
vi.mock('../lib/api', () => ({
  api: {
    listWPSites: vi.fn(),
    getWPFleetStatus: vi.fn(),
    postWPFleetDigest: vi.fn(),
    registerWPSite: vi.fn(),
    getWPBackups: vi.fn(),
    getWPReports: vi.fn(),
    getWPAlerts: vi.fn(),
    getWPFleetOps: vi.fn(),
  },
  setUnauthorizedCallback: vi.fn(),
  setApiErrorCallback: vi.fn(),
}));

import { api } from '../lib/api';
import WPSites from '../pages/WPSites';

const SAMPLE_SITE = {
  id: 'site-42',
  url: 'https://example.com',
  name: 'Example Site',
  magicLoginUserId: 9,
};

const SAMPLE_FLEET = {
  totalSites: 1,
  healthy: 1,
  degraded: 0,
  unreachable: 0,
  silent: 0,
  sslExpiringSoon: 0,
  pendingUpdates: 0,
  brokenLinks: 0,
  sites: [
    {
      siteUrl: 'https://example.com',
      siteId: 'site-42',
      lastPingStatus: 'ok',
      sslDaysRemaining: 30,
      pendingUpdates: 0,
      brokenLinks: 0,
      lastPingAt: '2026-07-01T00:00:00Z',
    }
  ],
};

function setup({
  sites = [SAMPLE_SITE],
  fleet = SAMPLE_FLEET,
} = {}) {
  api.listWPSites.mockResolvedValue(sites);
  api.getWPFleetStatus.mockResolvedValue(fleet);
  api.postWPFleetDigest.mockResolvedValue({});
  api.getWPFleetOps.mockResolvedValue({ ops: [] });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WPSites />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe('WPSites row buttons (PR-E: hub-ui-buttons-wire)', () => {
  let fetchMock;
  let windowOpenMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    // window.open is normally not implemented in jsdom — stub it
    windowOpenMock = vi.fn(() => null);
    window.open = windowOpenMock;
  });

  afterEach(() => {
    delete global.fetch;
    delete window.open;
  });

  it('provisions a site without accepting a caller secret and shows the one-time key', async () => {
    api.registerWPSite.mockResolvedValue({
      success: true,
      site: { id: 'site-new', url: 'https://new.example' },
      bridgeSecret: 'one-time-site-secret'
    });
    setup({ sites: [], fleet: { ...SAMPLE_FLEET, totalSites: 0, sites: [] } });

    fireEvent.click(await screen.findByRole('button', { name: 'Add Site' }));
    fireEvent.change(screen.getByPlaceholderText('https://yoursite.com'), {
      target: { value: 'https://new.example' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register Site' }));

    await waitFor(() => expect(api.registerWPSite).toHaveBeenCalledWith({ siteUrl: 'https://new.example' }));
    expect(await screen.findByDisplayValue('one-time-site-secret')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it('Magic Login button POSTs /api/wp-bridge/fleet/magic-login with the configured site target and opens returned URL in a new tab', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        opId: 'op-1',
        total: 1,
        succeeded: 1,
        failed: 0,
        results: [
          { siteUrl: 'https://example.com', url: 'https://example.com/wp-login.php?ashbi_magic=abc123' }
        ]
      })
    });

    setup();

    // Wait for the Sites table to render with our site row.
    const magicBtn = await waitFor(() => screen.getByTestId('magic-login-button'), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(magicBtn);
    });

    // Click should translate into exactly one fetch POST to the fleet endpoint.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/wp-bridge/fleet/magic-login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ targetSites: ['site-42'] });

    // window.open should be called with the magic login URL in a new tab.
    await waitFor(() => expect(windowOpenMock).toHaveBeenCalled());
    const [target, winName, winFeatures] = windowOpenMock.mock.calls[0];
    expect(target).toBe('https://example.com/wp-login.php?ashbi_magic=abc123');
    expect(winName).toBe('_blank');
    // Defense in depth: opener / referer leak protection.
    expect(winFeatures).toContain('noopener');
    expect(winFeatures).toContain('noreferrer');
  });

  it('Delete button DELETEs /api/wp-bridge/<siteId> via path param (not query string)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => undefined,
    });

    setup();

    const deleteBtn = await waitFor(() => screen.getByTestId('delete-site-button'), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove site' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/wp-bridge/site-42');
    // The bug we're fixing: it used to be DELETE /wp-bridge?id=site-42.
    expect(url).not.toContain('?id=');
    expect(url).not.toContain('?');
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
  });

  it('Delete button surfaces an error toast when the server returns an error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden — admin only' })
    });

    setup();

    const deleteBtn = await waitFor(() => screen.getByTestId('delete-site-button'), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove site' }));

    // The shared confirmation retains and announces the server failure.
    expect(await screen.findByText(/Forbidden — admin only/i)).toBeInTheDocument();
  });

  it('Magic Login button surfaces an error toast when the fleet response carries per-site error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        opId: 'op-2',
        total: 1,
        succeeded: 0,
        failed: 1,
        results: [{ siteUrl: 'https://example.com', error: 'plugin response missing url field' }]
      })
    });

    setup();

    const magicBtn = await waitFor(() => screen.getByTestId('magic-login-button'), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(magicBtn);
    });

    // window.open must NOT be called when there is no URL.
    expect(windowOpenMock).not.toHaveBeenCalled();
    // The per-site error is shown inline.
    expect(await screen.findByText(/plugin response missing url field/i)).toBeInTheDocument();
  });
});
