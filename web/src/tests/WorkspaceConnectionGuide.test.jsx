import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceConnectionGuide from '../components/WorkspaceConnectionGuide';
import schema from '../../../docs/workspace-actions.openapi.json';

beforeEach(() => {
  window.location = { ...window.location, origin: 'https://hub.ashbi.ca' };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({ writeText: vi.fn() }) });
  URL.createObjectURL = vi.fn();
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('Workspace connection setup', () => {
  it('copies the current host MCP URL without including credentials', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText });
    render(<WorkspaceConnectionGuide />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP endpoint' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/mcp`));
    expect(await screen.findByRole('status')).toHaveTextContent('MCP endpoint copied.');
  });

  it('provides manual recovery when clipboard permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText });
    render(<WorkspaceConnectionGuide />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Tool discovery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('copy it manually');
    expect(screen.getByText(`${window.location.origin}/api/agent/tools`)).toBeInTheDocument();
  });

  it('exports the canonical Actions contract with the active host and preserves write approval flags', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:actions');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = vi.spyOn(window, 'Blob');
    render(<WorkspaceConnectionGuide />);
    fireEvent.click(screen.getByRole('button', { name: 'Download Actions schema' }));
    const exported = JSON.parse(blob.mock.calls[0][0][0]);
    expect(exported.servers).toEqual([{ url: window.location.origin }]);
    expect(exported.paths).toEqual(schema.paths);
    expect(exported.paths['/api/agent/tools/confirm_action'].post['x-openai-isConsequential']).toBe(true);
    expect(exported.security).toEqual(schema.security);
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:actions');
    expect(screen.getByText(/OAuth, which Ashbi does not support yet/)).toBeInTheDocument();
  });
});
