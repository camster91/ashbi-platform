import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
