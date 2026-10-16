import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientAgentSettings from '../components/ClientAgentSettings';

const { api } = vi.hoisted(() => ({ api: { getClientAgentProfile: vi.fn(), updateClientAgentProfile: vi.fn() } }));
vi.mock('../lib/api', () => ({ api }));
const profile = { clientId: 'a', name: 'Account manager', instructions: '', enabled: true, revision: 0, pluginIds: ['client-work'] };
function setup() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (clientId) => <QueryClientProvider client={cache}><ClientAgentSettings clientId={clientId} /></QueryClientProvider>;
  return { ...render(view('a')), view };
}
beforeEach(() => { vi.resetAllMocks(); api.getClientAgentProfile.mockResolvedValue(profile); });

describe('client agent settings', () => {
  it('loads only when opened and saves the bounded client profile explicitly', async () => {
    api.updateClientAgentProfile.mockResolvedValue({ ...profile, revision: 1, name: 'Acme manager' });
    setup();
    expect(api.getClientAgentProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Account manager settings'));
    await screen.findByLabelText('Agent name');
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Acme manager' } });
    expect(api.updateClientAgentProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(api.updateClientAgentProfile).toHaveBeenCalledWith('a', { revision: 0, name: 'Acme manager', instructions: '', enabled: true, pluginIds: ['client-work'] });
    expect(screen.getByLabelText('Client instructions')).toHaveAttribute('maxlength', '2000');
  });

  it('preserves conflicting edits until an explicit reload of the saved version', async () => {
    api.updateClientAgentProfile.mockRejectedValue({ status: 409, message: 'secret' });
    setup(); fireEvent.click(screen.getByText('Account manager settings'));
    fireEvent.change(await screen.findByLabelText('Agent name'), { target: { value: 'My unsaved manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Agent name')).toHaveValue('My unsaved manager');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    api.getClientAgentProfile.mockResolvedValue({ ...profile, revision: 2, name: 'Team saved manager' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft and reload saved profile' }));
    await waitFor(() => expect(screen.getByLabelText('Agent name')).toHaveValue('Team saved manager'));
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('clears state and ignores the previous client load after a client switch', async () => {
    let resolve;
    api.getClientAgentProfile.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { rerender, view } = setup(); fireEvent.click(screen.getByText('Account manager settings'));
    await waitFor(() => expect(api.getClientAgentProfile).toHaveBeenCalledWith('a'));
    rerender(view('b'));
    await act(async () => resolve({ ...profile, name: 'Private A' }));
    expect(screen.queryByDisplayValue('Private A')).not.toBeInTheDocument();
    expect(api.getClientAgentProfile).toHaveBeenCalledTimes(1);
    api.getClientAgentProfile.mockResolvedValue({ ...profile, clientId: 'b', name: 'B manager' });
    fireEvent.click(screen.getByText('Account manager settings'));
    expect(await screen.findByLabelText('Agent name')).toHaveValue('B manager');
  });

  it('keeps failed saves editable and hides raw service errors', async () => {
    api.updateClientAgentProfile.mockRejectedValue(new Error('private provider token'));
    setup(); fireEvent.click(screen.getByText('Account manager settings'));
    await screen.findByLabelText('Agent name');
    fireEvent.change(screen.getByLabelText('Client instructions'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is preserved');
    expect(screen.getByLabelText('Client instructions')).toHaveValue('Keep this draft');
    expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
  });

  it('preserves a disabled plugin when editing profile details', async () => {
    api.getClientAgentProfile.mockResolvedValue({ ...profile, pluginIds: [] });
    api.updateClientAgentProfile.mockResolvedValue({ ...profile, pluginIds: [], revision: 1 });
    setup(); fireEvent.click(screen.getByText('Account manager settings'));
    fireEvent.change(await screen.findByLabelText('Agent name'), { target: { value: 'Updated name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(api.updateClientAgentProfile).toHaveBeenCalledWith('a', expect.objectContaining({ name: 'Updated name', pluginIds: [] }));
    expect(screen.getByText(/Client work plugin: disabled/)).toBeInTheDocument();
  });

  it('changes the client work plugin only through its explicit control', async () => {
    api.updateClientAgentProfile.mockResolvedValue({ ...profile, pluginIds: [], revision: 1 });
    setup(); fireEvent.click(screen.getByText('Account manager settings'));
    fireEvent.click(await screen.findByLabelText('Enable client work plugin'));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(api.updateClientAgentProfile).toHaveBeenCalledWith('a', expect.objectContaining({ pluginIds: [] }));
    expect(screen.getByLabelText('Enable client work plugin')).not.toBeChecked();
  });
  it('keeps task proposals off until explicitly selected and preserves other plugins', async () => {
    api.updateClientAgentProfile.mockImplementation(async (_, value) => ({ ...value, revision: 1 }));
    setup(); fireEvent.click(screen.getByText('Account manager settings'));
    const proposals = await screen.findByLabelText('Task proposals – requires confirmation');
    expect(proposals).not.toBeChecked();
    fireEvent.click(proposals); fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(api.updateClientAgentProfile).toHaveBeenLastCalledWith('a', expect.objectContaining({ pluginIds: ['client-work', 'client-task-actions'] }));
    fireEvent.click(screen.getByLabelText('Enable client work plugin')); fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(api.updateClientAgentProfile).toHaveBeenLastCalledWith('a', expect.objectContaining({ pluginIds: ['client-task-actions'] })));
  });

});
