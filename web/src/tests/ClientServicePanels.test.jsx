import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientServicePanels from '../components/ClientServicePanels';

const { api, auth } = vi.hoisted(() => ({ api: Object.fromEntries(['getClientServiceCredentials', 'refreshClientServiceReports', 'getClientServicePanels', 'createClientServiceMapping', 'updateClientServiceMapping', 'publishClientServiceSnapshot'].map((name) => [name, vi.fn()])), auth: { user: { id: 'staff', organizationId: 'org', role: 'TEAM' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const report = { id: 'r1', providerReportId: 'source1', title: 'Keyword review', summary: 'Stored source summary', sourceReportedAt: '2026-10-12T10:00:00Z', hubStoredAt: '2026-10-16T12:00:00Z', sourceUrl: 'https://unverified.example/report' };
const mapping = { id: 'm1', provider: 'OPENSEO', providerProjectId: 'openseo1', displayLabel: 'Website SEO', enabled: true, revision: 1, status: 'ready', lastAttemptAt: '2026-10-16T12:00:00Z', lastSuccessAt: '2026-10-16T12:00:00Z', stale: false, sourceFreshness: 'stale', hasMoreReports: false, reports: [report] };
const payload = (projects = [mapping], extra = {}) => ({ clientId: 'client1', source: 'ADMIN_PUBLISHED_SNAPSHOT', staleAfterHours: 24, hasMoreProjects: false, projects, ...extra });
const caches = [];
function setup(clientId = 'client1') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache);
  const view = (id) => <QueryClientProvider client={cache}><MemoryRouter><ClientServicePanels key={id} clientId={id} /></MemoryRouter></QueryClientProvider>;
  return { ...render(view(clientId)), view };
}
async function open() { fireEvent.click(screen.getByText('Saved reports')); return screen.findByText(/Saved reports stored in Hub/); }
beforeEach(() => { vi.resetAllMocks(); auth.user = { id: 'staff', organizationId: 'org', role: 'TEAM' }; api.getClientServicePanels.mockResolvedValue(payload()); api.getClientServiceCredentials.mockResolvedValue({ credentials: [] }); });
afterEach(() => { cleanup(); caches.splice(0).forEach((cache) => cache.clear()); });

describe('saved service reports', () => {
  it('loads lazily without external research and distinguishes source time from Hub storage', async () => {
    setup(); expect(api.getClientServicePanels).not.toHaveBeenCalled(); await open();
    await screen.findByText('Keyword review');
    expect(api.getClientServicePanels).toHaveBeenCalledExactlyOnceWith('client1');
    expect(screen.getByText(/Source reported:/)).toHaveTextContent('Hub stored:');
    expect(screen.getByText(/recent Hub save does not make the source report current/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(api.publishClientServiceSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText('Manage saved reports')).not.toBeInTheDocument();
  });
  it.each(['CLIENT', 'BOT'])('does not offer reports or load their data for %s', (role) => {
    auth.user.role = role; setup(); expect(screen.queryByText('Saved reports')).not.toBeInTheDocument(); expect(api.getClientServicePanels).not.toHaveBeenCalled();
  });
  it('shows empty mappings, never-published, unavailable retained reports and independent stale state', async () => {
    api.getClientServicePanels.mockResolvedValue(payload([
      { ...mapping, id: 'never', displayLabel: 'New project', status: 'never-fetched', lastAttemptAt: null, lastSuccessAt: null, sourceFreshness: 'unknown', reports: [] },
      { ...mapping, id: 'empty', displayLabel: 'Empty project', status: 'empty', sourceFreshness: 'unknown', reports: [] },
      { ...mapping, status: 'unavailable', stale: true },
    ], { hasMoreProjects: true }));
    setup(); await open(); await screen.findByText('Keyword review');
    expect(screen.getByText('No snapshot has been published for this mapping.')).toBeInTheDocument();
    expect(screen.getByText('The last complete snapshot contained no reports.')).toBeInTheDocument();
    expect(screen.getByText(/Showing retained last-good reports/)).toBeInTheDocument();
    expect(screen.getByText(/Saved reports are stale/)).toBeInTheDocument();
    expect(screen.getByText(/first 50 mappings/)).toBeInTheDocument();
  });
  it('marks report truncation and no mapping separately', async () => {
    api.getClientServicePanels.mockResolvedValueOnce(payload([{ ...mapping, hasMoreReports: true, sourceFreshness: 'unknown', sourceObservedAt: null }]));
    setup(); await open(); await screen.findByText('Showing a limited selection of saved reports. Additional reports are omitted.');
    expect(screen.getByText(/newest source date and mapping freshness cannot be verified/)).toBeInTheDocument();
    expect(screen.queryByText(/latest published attempt was unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/source report date is older than/)).not.toBeInTheDocument();
    api.getClientServicePanels.mockResolvedValueOnce(payload([])); fireEvent.click(screen.getByRole('button', { name: 'Reload saved reports' }));
    await screen.findByText('No service project mappings have been saved for this client.');
  });
  it('hides previous report data on a failed refresh and offers retry', async () => {
    setup(); await open(); await screen.findByText('Keyword review');
    api.getClientServicePanels.mockRejectedValueOnce(new Error('private details')); fireEvent.click(screen.getByRole('button', { name: 'Reload saved reports' }));
    await screen.findByText('Saved reports are unavailable. Reload to try again.');
    expect(screen.queryByText('Keyword review')).not.toBeInTheDocument(); expect(screen.queryByText('private details')).not.toBeInTheDocument();
  });
  it('drops old client data and ignores an old in-flight response', async () => {
    let resolve;
    api.getClientServicePanels.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const ui = setup(); await open(); await waitFor(() => expect(api.getClientServicePanels).toHaveBeenCalledTimes(1));
    ui.rerender(ui.view('client2')); await act(async () => resolve(payload()));
    expect(screen.queryByText('Keyword review')).not.toBeInTheDocument();
  });
  it('lets admins explicitly map and publish a bounded additive report with UTC provenance', async () => {
    auth.user.role = 'ADMIN'; api.createClientServiceMapping.mockResolvedValue({ id: 'm2', revision: 1 }); api.publishClientServiceSnapshot.mockResolvedValue({ id: 'm1', revision: 2 });
    setup(); await open(); await screen.findByText('Keyword review');
    fireEvent.click(screen.getByText('Add OpenSEO mapping'));
    fireEvent.change(screen.getByLabelText('New mapping label'), { target: { value: 'Another SEO project' } }); fireEvent.change(screen.getByLabelText('OpenSEO project identifier'), { target: { value: 'source2' } });
    expect(api.createClientServiceMapping).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Save new mapping' }));
    await waitFor(() => expect(api.createClientServiceMapping).toHaveBeenCalledExactlyOnceWith('client1', { provider: 'OPENSEO', providerProjectId: 'source2', displayLabel: 'Another SEO project' }));
    fireEvent.click(screen.getByText('Manage saved reports'));
    fireEvent.change(screen.getByLabelText('Source report identifier'), { target: { value: 'report2' } }); fireEvent.change(screen.getByLabelText('Report title'), { target: { value: 'Verified report' } }); fireEvent.change(screen.getByLabelText('Report summary'), { target: { value: 'Verified summary' } });
    fireEvent.change(screen.getByLabelText('Source reported time (UTC)'), { target: { value: '2026-10-15T15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish saved report' }));
    await waitFor(() => expect(api.publishClientServiceSnapshot).toHaveBeenCalledExactlyOnceWith('client1', 'm1', { mappingRevision: 1, providerProjectIdMatch: 'openseo1', outcome: 'OK', complete: false, failureCode: null, reports: [{ providerReportId: 'report2', title: 'Verified report', summary: 'Verified summary', sourceReportedAt: '2026-10-15T15:30:00.000Z' }] }));
  });
  it('shows a safe mapping conflict without overwriting or repeating the publication', async () => {
    auth.user.role = 'ADMIN'; api.updateClientServiceMapping.mockRejectedValue({ status: 409 });
    setup(); await open(); await screen.findByText('Manage saved reports'); fireEvent.click(screen.getByText('Manage saved reports'));
    fireEvent.change(screen.getByLabelText('Mapping label'), { target: { value: 'New label' } }); fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));
    await screen.findByText('The mapping changed. Reload saved reports before trying again.');
    expect(api.updateClientServiceMapping).toHaveBeenCalledExactlyOnceWith('client1', 'm1', { revision: 1, displayLabel: 'New label', enabled: true });
  });
});


describe('explicit saved-report pull', () => {
  it('reads only storage on load and offers provider refresh only to configured admins', async () => {
    auth.user.role = 'ADMIN';
    api.getClientServicePanels.mockResolvedValue(payload([{ ...mapping, refreshConfigured: true, credentialId: 'credential1' }]));
    api.refreshClientServiceReports.mockResolvedValue({ id: 'm1', revision: 2, outcome: 'EMPTY', partial: true });
    setup(); await open(); await screen.findByText('Keyword review');
    expect(api.refreshClientServiceReports).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Manage saved reports'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved reports from OpenSEO' }));
    await waitFor(() => expect(api.refreshClientServiceReports).toHaveBeenCalledExactlyOnceWith('client1', 'm1', { mappingRevision: 1 }));
    expect(api.publishClientServiceSnapshot).not.toHaveBeenCalled();
  });
  it('disables refresh until bound and keeps provider edit time separate from metrics', async () => {
    auth.user.role = 'ADMIN';
    api.getClientServicePanels.mockResolvedValue(payload([{ ...mapping, refreshConfigured: false, refreshOutcome: 'EMPTY', refreshPartial: true, lastRefreshedAt: '2026-10-16T12:00:00Z', reports: [{ ...report, provenance: 'OPENSEO_SAVED_REPORT_PULL', providerEditedAt: '2026-10-15T12:00:00Z', sourceReportedAt: null }] }]));
    setup(); await open(); await screen.findByText('Keyword review');
    expect(screen.getByRole('button', { name: 'Refresh saved reports from OpenSEO' })).toBeDisabled();
    expect(screen.getByText(/No reports returned; saved reports retained/)).toBeInTheDocument();
    expect(screen.getByText(/Metric observation time unknown/)).toBeInTheDocument();
    expect(api.refreshClientServiceReports).not.toHaveBeenCalled();
  });
});


it('binds only an explicitly selected metadata-only credential choice', async () => {
  auth.user.role = 'ADMIN';
  api.getClientServiceCredentials.mockResolvedValue({ credentials: [{ id: 'credential1', label: 'Public OpenSEO proxy', usernamePresent: true }] });
  api.updateClientServiceMapping.mockResolvedValue({ id: 'm1', revision: 2 });
  setup(); await open();
  await screen.findByRole('option', { name: 'Public OpenSEO proxy' });
  fireEvent.click(screen.getByText('Manage saved reports'));
  fireEvent.change(screen.getByLabelText('OpenSEO public proxy Basic credential'), { target: { value: 'credential1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));
  await waitFor(() => expect(api.updateClientServiceMapping).toHaveBeenCalledExactlyOnceWith('client1', 'm1', { revision: 1, displayLabel: 'Website SEO', enabled: true, credentialId: 'credential1' }));
});

it('allows disabling a mapping without changing its binding when credential metadata is unavailable', async () => {
  auth.user.role = 'ADMIN';
  api.getClientServicePanels.mockResolvedValue(payload([{ ...mapping, credentialId: 'existing-bound-credential' }]));
  api.getClientServiceCredentials.mockRejectedValue(new Error('private vault details'));
  api.updateClientServiceMapping.mockResolvedValue({ id: 'm1', revision: 2 });
  setup(); await open();
  await screen.findByText('Credential choices are unavailable. Reload before changing the binding.');
  fireEvent.click(screen.getByText('Manage saved reports'));
  fireEvent.click(screen.getByLabelText('Show this mapping to staff'));
  fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));
  await waitFor(() => expect(api.updateClientServiceMapping).toHaveBeenCalledExactlyOnceWith('client1', 'm1', { revision: 1, displayLabel: 'Website SEO', enabled: false }));
  expect(screen.queryByText('private vault details')).not.toBeInTheDocument();
});


it('reports unavailable provider outcomes honestly across the mapping revision remount', async () => {
  auth.user.role = 'ADMIN';
  api.getClientServicePanels.mockResolvedValueOnce(payload([{ ...mapping, refreshConfigured: true }])).mockResolvedValue(payload([{ ...mapping, revision: 2, refreshConfigured: true, status: 'unavailable', refreshOutcome: 'UNAVAILABLE', refreshPartial: true, lastRefreshedAt: '2026-10-16T12:00:00Z' }]));
  api.refreshClientServiceReports.mockResolvedValue({ id: 'm1', revision: 2, outcome: 'UNAVAILABLE', partial: true });
  setup(); await open(); await screen.findByText('Keyword review');
  fireEvent.click(screen.getByText('Manage saved reports'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved reports from OpenSEO' }));
  await screen.findByText(/Unavailable; saved reports retained/);
  expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  expect(screen.queryByText(/Reports read\./)).not.toBeInTheDocument();
  expect(screen.getByText('Keyword review')).toBeInTheDocument();
});
