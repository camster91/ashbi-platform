import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentSaveRecovery from '../components/DocumentSaveRecovery';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { getNote: vi.fn() } }));

describe('Document save recovery', () => {
  it('retains a rejected draft during an offline reload and only replaces it after a successful fresh read', async () => {
    const onReload = vi.fn();
    api.getNote.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'note', revision: 2, content: 'Team update' });
    render(<DocumentSaveRecovery noteId="note" draft={{ content: 'My draft', revision: 0 }} error={new Error('Document changed')} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
    await screen.findByText('The document could not be reloaded. Your draft is still retained.');
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledWith({ id: 'note', revision: 2, content: 'Team update' }));
    expect(api.getNote).toHaveBeenCalledWith('note');
  });
});
