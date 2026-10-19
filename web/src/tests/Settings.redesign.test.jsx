import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getApiKeys = vi.fn();
const deleteApiKey = vi.fn();
const auth = { user: { id: 'u1', role: 'ADMIN', email: 'admin@example.com', name: 'Admin', skills: ['design'], capacity: 100 }, checkAuth: vi.fn() };

vi.mock('../lib/api', () => ({
  api: {
    getApiKeys: (...args) => getApiKeys(...args),
    deleteApiKey: (...args) => deleteApiKey(...args),
    createApiKey: vi.fn(),
    getMcpOAuthStatus: vi.fn(async () => ({ enabled: false })),
    getGoogleCalendarConnection: vi.fn(async () => ({ connection: null })),
    getSlackInstallations: vi.fn(async () => ({ installations: [] })),
    getProjects: vi.fn(async () => ({ projects: [] })),
    getOnboardingProgress: vi.fn(async () => ({ supported: true, state: 'completed', completedCount: 3, totalCount: 3 })),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    googleCalendarOAuthStartUrl: () => '/api/google-calendar/oauth/start',
    slackOAuthStartUrl: () => '/api/slack/oauth/start',
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ permission: 'default', subscribed: false, status: 'idle', error: null, supported: true, offline: false, cleanupPending: false, subscribe: vi.fn(), unsubscribe: vi.fn() }),
}));
// Security panels have their own tests; here they only need to be present.
vi.mock('../components/TwoFactorSettings', () => ({ default: () => <p>Two-factor panel</p> }));
vi.mock('../components/OrganizationMfaPolicy', () => ({ default: () => <p>Organization MFA panel</p> }));
vi.mock('../components/ActivityLog', () => ({ default: () => <p>Activity log panel</p> }));

const { default: Settings } = await import('../pages/Settings');

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.search}</output>;
}

function renderSettings(path = '/settings') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/settings" element={<><Settings /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const KEYS = [
  { id: 'k1', name: 'Claude desktop', scopes: ['workspace:read'], createdAt: '2026-09-01T12:00:00Z', lastUsedAt: '2026-10-18T12:00:00Z', expiresAt: '2026-12-01T12:00:00Z' },
  { id: 'k2', name: 'Codex', scopes: ['workspace:read', 'workspace:actions'], createdAt: '2026-09-02T12:00:00Z', expiresAt: '2026-12-02T12:00:00Z' },
];

beforeEach(() => {
  auth.user = { id: 'u1', role: 'ADMIN', email: 'admin@example.com', name: 'Admin', skills: ['design'], capacity: 100 };
  getApiKeys.mockReset().mockResolvedValue({ keys: KEYS });
  deleteApiKey.mockReset().mockResolvedValue({ success: true });
});

describe('settings layout', () => {
  it('opens on Agents and MCP with every section an admin can use', async () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Agents and MCP');
    const list = screen.getByRole('tablist', { name: 'Settings sections' });
    expect(list).toHaveAttribute('aria-orientation', 'vertical');
    expect(within(list).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(
      ['Profile', 'Business', 'Payments', 'Agents and MCP', 'Team', 'Security', 'Alerts', 'Integrations'],
    );
    expect(screen.getByRole('tab', { name: 'Agents and MCP' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Claude desktop')).toBeInTheDocument();
  });

  it('keeps the chosen section in the address and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('tab', { name: 'Security' }));
    expect(screen.getByLabelText('location')).toHaveTextContent('?section=security');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Security and sign-in');
    expect(screen.getByText('Two-factor panel')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Browser notifications' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Agents and MCP' }));
    expect(screen.getByLabelText('location')).toBeEmptyDOMElement();
  });

  it('opens a section from a link, and Integrations after an OAuth return', async () => {
    renderSettings('/settings?section=profile');
    expect(screen.getByLabelText('Capacity (%)')).toHaveValue(100);
    expect(screen.getByRole('button', { name: 'Save Profile' })).toBeInTheDocument();
  });

  it.each(['?googleCalendar=connected', '?slack=connected'])('lands on Integrations for %s', async (search) => {
    renderSettings(`/settings${search}`);
    expect(screen.getByRole('tab', { name: 'Integrations' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Google Calendar is not connected.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Slack workspace' })).toBeInTheDocument();
  });

  it('puts accounting and billing tools under Payments, with the planned report not linked', () => {
    renderSettings('/settings?section=payments');
    const accounting = screen.getByRole('region', { name: 'Accounting Integrations' });
    expect(within(accounting).getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Invoice Chaser/ })).toHaveAttribute('href', '/invoice-chaser');
    expect(screen.getByText('Reports (planned)').closest('[aria-disabled="true"]')).not.toBeNull();
  });
});

describe('settings for team members', () => {
  beforeEach(() => {
    auth.user = { id: 'u2', role: 'TEAM', email: 'terry@example.com', name: 'Terry', skills: [], capacity: 100 };
  });

  it('hides the admin-only sections and panels', async () => {
    renderSettings('/settings?section=business');
    const tabs = within(screen.getByRole('tablist', { name: 'Settings sections' })).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Profile', 'Agents and MCP', 'Security', 'Alerts', 'Integrations']);
    // An admin-only section in the address falls back to the default.
    expect(screen.getByRole('tab', { name: 'Agents and MCP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Brand Settings')).not.toBeInTheDocument();
    expect(await screen.findByText('Claude desktop')).toBeInTheDocument();
  });

  it('shows only their own security and integration panels', async () => {
    const user = userEvent.setup();
    renderSettings('/settings?section=security');
    expect(screen.getByText('Two-factor panel')).toBeInTheDocument();
    expect(screen.queryByText('Organization MFA panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity log panel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Integrations' }));
    expect(await screen.findByText('Google Calendar is not connected.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Slack workspace' })).not.toBeInTheDocument();
  });
});

describe('agents and MCP', () => {
  it('lists each connected agent with its access level and revokes only after confirming', async () => {
    const user = userEvent.setup();
    renderSettings();
    const agents = await screen.findByRole('list', { name: 'Connected agents' });
    const [claude, codex] = within(agents).getAllByRole('listitem');
    expect(claude).toHaveTextContent('Read only');
    expect(claude).toHaveTextContent('Scopes: Read workspace');
    expect(codex).toHaveTextContent('Can prepare changes');

    await user.click(within(codex).getByRole('button', { name: 'Revoke Codex' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke API key' });
    expect(deleteApiKey).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke API key' }));
    await waitFor(() => expect(deleteApiKey).toHaveBeenCalledWith('k2'));
  });

  it('moves to the key form from Connect an agent and copies the MCP address', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Connect an agent' }));
    expect(screen.getByLabelText('API key name')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Copy MCP address' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/mcp`);
    expect(await screen.findByText('MCP address copied.')).toHaveAttribute('role', 'status');
    // The setup guide does not repeat the address.
    expect(screen.queryByRole('button', { name: 'Copy MCP endpoint' })).not.toBeInTheDocument();
  });

  it('says what each scope allows, in a scrollable region a keyboard can reach', () => {
    renderSettings();
    const table = screen.getByRole('region', { name: 'Agent access by scope' });
    expect(table).toHaveAttribute('tabindex', '0');
    const row = within(table).getByRole('row', { name: /Workspace actions/ });
    expect(row).toHaveTextContent('Yes, as a preview');
    expect(row).toHaveTextContent('Never');
    expect(within(table).getByRole('row', { name: /Client site logins/ })).toHaveTextContent('Never shared with agents');
    expect(screen.getByRole('region', { name: 'Safety rules' })).toHaveTextContent('Creating a key asks for your password or two-factor code.');
  });

  it('shows a retryable error rather than an empty list when keys fail to load', async () => {
    getApiKeys.mockRejectedValue(new Error('Network down'));
    renderSettings();
    expect(await screen.findByText('Failed to load API keys')).toBeInTheDocument();
    expect(screen.queryByText(/No agents are connected yet/)).not.toBeInTheDocument();
  });
});
