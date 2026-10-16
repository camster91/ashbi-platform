import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import PortalAssistantSettings from '../components/PortalAssistantSettings';
const { api, auth } = vi.hoisted(() => ({ api: { getPortalAssistantConfig: vi.fn(), updatePortalAssistantConfig: vi.fn() }, auth: { user: { id: 'admin', organizationId: 'org1', role: 'ADMIN' } } }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const config = { enabled: false, name: 'Client guide', instructions: '', revision: 0 };
beforeEach(() => { vi.resetAllMocks(); auth.user = { id: 'admin', organizationId: 'org1', role: 'ADMIN' }; api.getPortalAssistantConfig.mockResolvedValue(config); });
it('ADMIN explicitly loads and publishes separate disabled-default client instructions with CAS', async () => {
  api.updatePortalAssistantConfig.mockResolvedValue({ ...config, revision: 1, instructions: 'Explain visible project status.' });
  render(<PortalAssistantSettings clientId="client1" />); expect(api.getPortalAssistantConfig).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Client portal AI settings'));
  const instructions = await screen.findByLabelText('Portal assistant instructions'); expect(instructions).toHaveValue(''); expect(screen.getByLabelText('Enable client portal AI assistant')).not.toBeChecked();
  fireEvent.change(instructions, { target: { value: 'Explain visible project status.' } }); expect(api.updatePortalAssistantConfig).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Save portal AI settings'));
  await screen.findByText(/settings saved/); expect(api.updatePortalAssistantConfig).toHaveBeenCalledWith('client1', { ...config, instructions: 'Explain visible project status.' });
});
it('TEAM cannot read or edit the ADMIN-only portal configuration', () => {
  auth.user.role = 'TEAM'; render(<PortalAssistantSettings clientId="client1" />); expect(screen.queryByText('Client portal AI settings')).toBeNull(); expect(api.getPortalAssistantConfig).not.toHaveBeenCalled();
});
it('loads normally under the application StrictMode effect lifecycle', async () => {
  render(<StrictMode><PortalAssistantSettings clientId="client1" /></StrictMode>); fireEvent.click(screen.getByText('Client portal AI settings')); await screen.findByLabelText('Portal assistant instructions');
});
it('CAS conflict retains draft and blocks repeat save until explicit fresh reload', async () => {
  api.updatePortalAssistantConfig.mockRejectedValue({ status: 409, message: 'private' }); render(<PortalAssistantSettings clientId="client1" />); fireEvent.click(screen.getByText('Client portal AI settings'));
  fireEvent.change(await screen.findByLabelText('Portal assistant instructions'), { target: { value: 'Unsaved portal draft' } }); fireEvent.click(screen.getByText('Save portal AI settings'));
  await screen.findByText(/Settings changed/); expect(screen.getByLabelText('Portal assistant instructions')).toHaveValue('Unsaved portal draft'); expect(screen.getByText('Save portal AI settings')).toBeDisabled();
  api.getPortalAssistantConfig.mockResolvedValue({ ...config, revision: 2 }); fireEvent.click(screen.getByText('Discard draft and reload portal settings')); await waitFor(() => expect(screen.getByLabelText('Portal assistant instructions')).toHaveValue(''));
});
it('failed fresh read hides saved private instructions', async () => {
  api.getPortalAssistantConfig.mockResolvedValueOnce({ ...config, instructions: 'Private setup' }).mockRejectedValueOnce({ status: 403 }); render(<PortalAssistantSettings clientId="client1" />); fireEvent.click(screen.getByText('Client portal AI settings'));
  await screen.findByDisplayValue('Private setup'); fireEvent.click(screen.getByText('Reload portal settings')); await screen.findByText(/Cached instructions are hidden/); expect(screen.queryByDisplayValue('Private setup')).toBeNull();
});
it('client/principal role switch removes config and ignores old async result', async () => {
  let resolve; api.getPortalAssistantConfig.mockImplementation(() => new Promise(done => { resolve = done; })); const view = render(<PortalAssistantSettings clientId="client1" />); fireEvent.click(screen.getByText('Client portal AI settings'));
  await waitFor(() => expect(api.getPortalAssistantConfig).toHaveBeenCalledTimes(1)); auth.user.role = 'TEAM'; view.rerender(<PortalAssistantSettings clientId="client2" />); await act(async () => resolve({ ...config, instructions: 'Old client' })); expect(screen.queryByDisplayValue('Old client')).toBeNull();
});
