import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientAccountManager from '../components/ClientAccountManager';
const { api } = vi.hoisted(() => ({ api: Object.fromEntries(['getClientAccountManagerBrief','getClientAgentProfile','getClientTaskActionByIntent','rejectClientTaskAction','getProjects','prepareClientTaskAction','confirmClientTaskAction','previewClientAssistant'].map(name => [name, vi.fn()])) }));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id:'staff',organizationId:'org',role:'TEAM' } }) }));
const storage = 'ashbi:client-task:org:staff:client:create_client_task';
const intent = { key:'9ecb89b0-f52a-4a4a-ae0d-f579ae61af65', fingerprint:'a'.repeat(64) };
let cache;
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); sessionStorage.setItem(storage, JSON.stringify(intent));
  cache = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  api.getClientAccountManagerBrief.mockResolvedValue({counts:{},rows:[]});
  api.getClientTaskActionByIntent.mockRejectedValue({status:409,data:{code:'TARGET_UNAVAILABLE'}});
});
afterEach(() => { cleanup(); cache.clear(); sessionStorage.clear(); });
it.each([
  {enabled:false,pluginIds:['client-work','client-task-actions']},
  {enabled:true,pluginIds:['client-work']},
])('actual parent retains recovery-only controls after pause/plugin removal: %s', async profile => {
  api.getClientAgentProfile.mockResolvedValue(profile);
  let finish;
  api.rejectClientTaskAction.mockImplementation(() => new Promise(resolve => {finish=resolve;}));
  render(<QueryClientProvider client={cache}><MemoryRouter><ClientAccountManager clientId="client" clientName="Client" role="TEAM" /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Account manager'));
  fireEvent.click(await screen.findByRole('button',{name:'Discard unavailable request'}));
  expect(api.getClientTaskActionByIntent).toHaveBeenCalledWith('client',intent.key);
  expect(api.rejectClientTaskAction).toHaveBeenCalledExactlyOnceWith('client',intent.key);
  expect(sessionStorage.getItem(storage)).toBe(JSON.stringify(intent));
  expect(api.getProjects).not.toHaveBeenCalled(); expect(api.prepareClientTaskAction).not.toHaveBeenCalled(); expect(api.confirmClientTaskAction).not.toHaveBeenCalled();
  expect(screen.queryByRole('region',{name:'Task preview'})).not.toBeInTheDocument(); expect(screen.queryByRole('button',{name:'Confirm create task'})).not.toBeInTheDocument();
  finish({action:{id:'old-action',status:'REJECTED'}});
  fireEvent.click(await screen.findByRole('button',{name:'Clear completed request'}));
  await waitFor(() => expect(sessionStorage.getItem(storage)).toBeNull());
  expect(api.getProjects).not.toHaveBeenCalled(); expect(api.prepareClientTaskAction).not.toHaveBeenCalled();
});
it('does not expose recovery-only controls for a different actor/client intent', async () => {
  sessionStorage.clear(); sessionStorage.setItem('ashbi:client-task:org:other:client:create_client_task',JSON.stringify(intent));
  api.getClientAgentProfile.mockResolvedValue({enabled:false,pluginIds:[]});
  render(<QueryClientProvider client={cache}><MemoryRouter><ClientAccountManager clientId="client" clientName="Client" role="TEAM" /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Account manager')); await waitFor(() => expect(api.getClientAgentProfile).toHaveBeenCalled());
  expect(api.getClientTaskActionByIntent).not.toHaveBeenCalled(); expect(api.getProjects).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Discard unavailable request'})).not.toBeInTheDocument();
});
