import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import TaskRecurrence from '../components/TaskRecurrence';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { saveTaskRecurrence: vi.fn(async () => ({})) } }));
const rule = { frequency: 'MONTHLY', interval: 1, startDate: '2026-01-31', timeZone: 'America/Toronto' };
function setup(task = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TaskRecurrence task={{ id: 't1', recurrenceRevision: 4, ...task }} /></MemoryRouter></QueryClientProvider>);
}
describe('task recurrence', () => {
  it('saves an explicit calendar schedule and observed revision', async () => {
    setup({ recurrenceRule: rule });
    fireEvent.click(screen.getByRole('button', { name: 'Configure recurrence' }));
    fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
    await waitFor(() => expect(api.saveTaskRecurrence).toHaveBeenCalledWith('t1', { revision: 4, rule: { ...rule, interval: 2 } }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Recurring task settings' })).not.toBeInTheDocument());
  });
  it('stops repeats without deleting prior occurrences', async () => {
    setup({ recurrenceRule: rule });
    fireEvent.click(screen.getByRole('button', { name: 'Configure recurrence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop repeating' }));
    await waitFor(() => expect(api.saveTaskRecurrence).toHaveBeenCalledWith('t1', { revision: 4, rule: null }));
  });
  it('retains input after failure and offers reload', async () => {
    api.saveTaskRecurrence.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { data: { message: 'Recurrence changed since you opened it.' } }));
    setup({ recurrenceRule: rule });
    fireEvent.click(screen.getByRole('button', { name: 'Configure recurrence' }));
    fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Recurrence changed');
    expect(screen.getByLabelText('Repeat interval')).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Reload settings' })).toBeInTheDocument();
  });
  it('links generated tasks to their original schedule instead of enabling nested recurrence', () => {
    setup({ recurrenceSourceId: 'source-1' });
    expect(screen.getByRole('link', { name: 'a recurring task' })).toHaveAttribute('href', '/task/source-1');
    expect(screen.queryByRole('button', { name: 'Configure recurrence' })).not.toBeInTheDocument();
  });
});
