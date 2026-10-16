import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import ConnectChatGPT from '../pages/ConnectChatGPT';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getMcpConsent: vi.fn(), respondMcpConsent: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  api.getMcpConsent.mockResolvedValue({ nonce: 'consent-nonce', accountEmail: 'qa@example.invalid' });
});
const show = () => render(<MemoryRouter initialEntries={['/connect-chatgpt?state=request-ticket']}><ConnectChatGPT /></MemoryRouter>);

it('shows the account, read-only boundaries and revocation instructions before consent', async () => {
  show();
  expect(await screen.findByText('qa@example.invalid')).toBeInTheDocument();
  expect(api.getMcpConsent).toHaveBeenCalledWith('request-ticket');
  expect(screen.getByText(/cannot create, change, send or delete/)).toBeInTheDocument();
  expect(screen.getByText(/Revoke/)).toHaveTextContent('30 days');
  expect(screen.getByText(/Revoke/)).toHaveTextContent('Signing out of Ashbi');
  expect(api.respondMcpConsent).not.toHaveBeenCalled();
});

it('offers recovery for expired requests without presenting an approval button', async () => {
  api.getMcpConsent.mockRejectedValue(new Error('expired'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  expect(screen.queryByRole('button', { name: 'Allow read-only access' })).not.toBeInTheDocument();
});

it('submits explicit denial and refuses an unexpected redirect destination', async () => {
  api.respondMcpConsent.mockResolvedValue({ redirect: 'https://attacker.invalid/' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel connection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be completed');
  expect(api.respondMcpConsent).toHaveBeenCalledWith({ state: 'request-ticket', nonce: 'consent-nonce', approved: false });
});

it('recovers when password confirmation is cancelled', async () => {
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Allow read-only access' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('password confirmation');
  expect(screen.getByRole('button', { name: 'Allow read-only access' })).toBeEnabled();
});

const taskScope = 'workspace:client-tasks:write';
const reportScope = 'workspace:service-reports:publish';
const taskLabel = 'Create client task proposals and confirm them';
const reportLabel = 'Publish saved client reports, including replacement or removal';
function scopedPreview(scopes = [taskScope, reportScope]) {
  return { nonce: 'scoped-nonce', accountEmail: 'qa@example.invalid', scopes: ['workspace:read'],
    requestedScopes: ['workspace:read', ...scopes], optionalScopes: scopes.map(scope => ({ scope })) };
}

it('keeps requested optional actions unchecked and submits an explicit read-only downscope', async () => {
  api.getMcpConsent.mockResolvedValue(scopedPreview());
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  show();
  expect(await screen.findByRole('checkbox', { name: taskLabel })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: reportLabel })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Allow read-only access' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(api.respondMcpConsent).toHaveBeenCalledWith({ state: 'request-ticket', nonce: 'scoped-nonce', approved: true, scopes: ['workspace:read'] });
});

it('submits only checked requested capabilities and explains API confirmation', async () => {
  api.getMcpConsent.mockResolvedValue(scopedPreview());
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  show();
  fireEvent.click(await screen.findByRole('checkbox', { name: taskLabel }));
  expect(screen.getByText(/does not require a new human click/)).toBeInTheDocument();
  expect(screen.getByText(/Revoke/)).toHaveTextContent('ChatGPT (scoped MCP actions)');
  fireEvent.click(screen.getByRole('button', { name: 'Allow selected access' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(api.respondMcpConsent).toHaveBeenCalledWith({ state: 'request-ticket', nonce: 'scoped-nonce', approved: true, scopes: ['workspace:read', taskScope] });
  expect(screen.getByRole('checkbox', { name: taskLabel })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Allow selected access' })).toBeEnabled();
});

it('explains report replacement/removal and permits selecting that capability alone', async () => {
  api.getMcpConsent.mockResolvedValue(scopedPreview([reportScope]));
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  show();
  expect(screen.queryByRole('checkbox', { name: taskLabel })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('checkbox', { name: reportLabel }));
  fireEvent.click(screen.getByRole('button', { name: 'Allow selected access' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(api.respondMcpConsent).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['workspace:read', reportScope] }));
});

it('never offers an unrequested or unknown optional scope', async () => {
  api.getMcpConsent.mockResolvedValue({ ...scopedPreview([]), optionalScopes: [{ scope: taskScope }, { scope: 'workspace:admin', label: 'Admin' }] });
  show();
  await screen.findByText('qa@example.invalid');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow read-only access' })).toBeInTheDocument();
});

it('denies without granting selected scopes and blocks duplicate submissions while pending', async () => {
  api.getMcpConsent.mockResolvedValue(scopedPreview());
  api.respondMcpConsent.mockReturnValue(new Promise(() => {}));
  show();
  fireEvent.click(await screen.findByRole('checkbox', { name: taskLabel }));
  const cancel = screen.getByRole('button', { name: 'Cancel connection' });
  fireEvent.click(cancel); fireEvent.click(cancel);
  expect(api.respondMcpConsent).toHaveBeenCalledTimes(1);
  expect(api.respondMcpConsent).toHaveBeenCalledWith({ state: 'request-ticket', nonce: 'scoped-nonce', approved: false });
  expect(screen.getByRole('checkbox', { name: taskLabel })).toBeDisabled();
});

function SwitchRequest() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/connect-chatgpt?state=second-ticket')}>Switch request</button><ConnectChatGPT /></>;
}

it('resets selection and binds approval to the new request nonce after navigation', async () => {
  api.getMcpConsent.mockResolvedValueOnce(scopedPreview()).mockResolvedValueOnce({ ...scopedPreview(), nonce: 'second-nonce' });
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  render(<MemoryRouter initialEntries={['/connect-chatgpt?state=request-ticket']}><SwitchRequest /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('checkbox', { name: taskLabel }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch request' }));
  expect(await screen.findByRole('checkbox', { name: taskLabel })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Allow read-only access' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(api.respondMcpConsent).toHaveBeenCalledWith({ state: 'second-ticket', nonce: 'second-nonce', approved: true, scopes: ['workspace:read'] });
});

it('excludes a previously selected capability after it is unchecked', async () => {
  api.getMcpConsent.mockResolvedValue(scopedPreview());
  api.respondMcpConsent.mockRejectedValue(new Error('cancelled'));
  show();
  fireEvent.click(await screen.findByRole('checkbox', { name: taskLabel }));
  fireEvent.click(screen.getByRole('checkbox', { name: reportLabel }));
  fireEvent.click(screen.getByRole('checkbox', { name: taskLabel }));
  fireEvent.click(screen.getByRole('button', { name: 'Allow selected access' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(api.respondMcpConsent).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['workspace:read', reportScope] }));
});

it('ignores an older consent preview arriving after the request changes', async () => {
  let resolveFirst;
  api.getMcpConsent.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ nonce: 'new-read-nonce', accountEmail: 'new-qa@example.invalid', requestedScopes: ['workspace:read'], optionalScopes: [] });
  render(<MemoryRouter initialEntries={['/connect-chatgpt?state=request-ticket']}><SwitchRequest /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Switch request' }));
  expect(await screen.findByText('new-qa@example.invalid')).toBeInTheDocument();
  await act(async () => { resolveFirst(scopedPreview()); });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText('new-qa@example.invalid')).toBeInTheDocument();
});
