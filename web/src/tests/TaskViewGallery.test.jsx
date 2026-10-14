import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import TaskViewGallery from '../components/TaskViewGallery';

it('renders grouped cards with canonical links, typed values and unassigned/undated recovery', () => {
  render(<MemoryRouter><TaskViewGallery grouped fields={[{ key: 'estimate', name: 'Estimate', type: 'NUMBER' }]} groups={[{ key: 'no', label: 'No', tasks: [{ id: 't1', title: 'Review artwork', status: 'REVIEW', priority: 'HIGH', fieldValues: { estimate: 0 } }] }]} /></MemoryRouter>);
  const gallery = screen.getByRole('region', { name: 'Task gallery' });
  expect(within(gallery).getByRole('heading', { name: 'No (1)' })).toBeInTheDocument();
  expect(within(gallery).getByRole('link', { name: 'Review artwork' })).toHaveAttribute('href', '/task/t1');
  expect(within(gallery).getByText('0')).toBeInTheDocument();
  expect(within(gallery).getByText('Unassigned · No due date')).toBeInTheDocument();
});
