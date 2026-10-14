import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import TaskFieldFilters from '../components/TaskFieldFilters';

vi.mock('../lib/api', () => ({ api: { getProjectTaskFieldOptions: vi.fn(async () => ({ items: [{ id: 'client-a', name: 'Canonical client' }] })) } }));
const fields = [{ key: 'estimate', name: 'Estimate', type: 'NUMBER' }, { key: 'approved', name: 'Approved', type: 'BOOLEAN' }, { key: 'client', name: 'Related client', type: 'RELATION' }];
function Harness({ initial }) {
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);
  return <><TaskFieldFilters projectId="p1" fields={fields} value={value} onChange={setValue} onDirtyChange={setDirty} /><button disabled={dirty}>Save view</button><output aria-label="Applied criteria">{JSON.stringify(value)}</output></>;
}
function setup(initial = []) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness initial={initial} /></QueryClientProvider>);
}
it('preserves zero and false, applying all criteria before enabling view save', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Add field filter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field filter' }));
  fireEvent.change(screen.getByLabelText('Field filter 2 field'), { target: { value: 'approved' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save view' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Apply field filters' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled());
  expect(JSON.parse(screen.getByLabelText('Applied criteria').textContent)).toEqual([{ key: 'estimate', operator: 'EQ', value: 0 }, { key: 'approved', operator: 'EQ', value: false }]);
});
it('chooses a relation by name and lets unavailable saved criteria be removed', async () => {
  setup([{ key: 'archived', operator: 'EQ', value: 'Preserve' }]);
  expect(screen.getByRole('option', { name: 'Unavailable field — remove this criterion' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove field filter 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field filter' }));
  fireEvent.change(screen.getByLabelText('Field filter 1 field'), { target: { value: 'client' } });
  await screen.findByRole('option', { name: 'Canonical client' }, { timeout: 5000 });
  fireEvent.change(screen.getByLabelText('Field filter 1 value'), { target: { value: 'client-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply field filters' }));
  expect(JSON.parse(screen.getByLabelText('Applied criteria').textContent)).toEqual([{ key: 'client', operator: 'EQ', value: 'client-a' }]);
});
